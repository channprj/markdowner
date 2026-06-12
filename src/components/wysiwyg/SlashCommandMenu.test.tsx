import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishEditorEvent } from '@/lib/editorEvents';

const openDialogMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));

const importImageAssetMock = vi.fn();
vi.mock('@/lib/desktop', () => ({
  importImageAsset: (...args: unknown[]) => importImageAssetMock(...args),
}));

import { SlashCommandMenu } from './SlashCommandMenu';

function createSlashEditor(
  coords: { top: number; bottom: number; left: number; right: number } = {
    top: 24,
    bottom: 42,
    left: 18,
    right: 18,
  },
) {
  const handlers = new Map<string, Set<() => void>>();
  const dom = document.createElement('div');

  const editor: any = {
    state: {
      selection: {
        from: 2,
        to: 2,
        empty: true,
        $from: {
          depth: 1,
          start: () => 1,
        },
      },
      doc: {
        textBetween: () => '/',
      },
    },
    view: {
      dom,
      coordsAtPos: () => coords,
    },
    on: vi.fn((name: string, handler: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(handler);
    }),
    off: vi.fn((name: string, handler: () => void) => {
      handlers.get(name)?.delete(handler);
    }),
    emit: (name: string) => {
      handlers.get(name)?.forEach((handler) => handler());
    },
  };

  return editor;
}

function setSlashTextBefore(editor: any, textBefore: string) {
  const from = 1 + textBefore.length;
  editor.state.selection = {
    from,
    to: from,
    empty: true,
    $from: {
      depth: 1,
      start: () => 1,
    },
  };
  editor.state.doc.textBetween = () => textBefore;
}

describe('SlashCommandMenu', () => {
  const scrollCalls: Array<{ text: string; options: ScrollIntoViewOptions | boolean | undefined }> =
    [];
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    scrollCalls.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(function scrollIntoView(
        this: HTMLElement,
        options?: ScrollIntoViewOptions | boolean,
      ) {
        scrollCalls.push({ text: this.textContent ?? '', options });
      }),
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it('scrolls the newly active item into view while navigating with arrow keys', async () => {
    const editor = createSlashEditor();

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    expect(await screen.findByRole('menu', { name: /insert block/i })).toBeInTheDocument();

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    }

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /table/i })).toHaveAttribute(
        'data-active',
        'true',
      );
    });

    const lastScrollCall = scrollCalls[scrollCalls.length - 1];
    expect(lastScrollCall?.text).toMatch(/table/i);
    expect(lastScrollCall?.options).toEqual({ block: 'nearest' });
  });

  it('does not open for API route slashes after an HTTP method', async () => {
    const editor = createSlashEditor();
    setSlashTextBefore(editor, 'DELETE /api');

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /insert block/i })).not.toBeInTheDocument();
    });
  });

  it('flips the menu above the caret when there is no room below', async () => {
    // Caret near the bottom of the viewport: ~12px of space below, ~744px above.
    // jsdom defaults innerHeight=768; the menu needs the room above to avoid clipping.
    const editor = createSlashEditor({ top: 740, bottom: 756, left: 18, right: 18 });

    // jsdom doesn't compute layout; stub offsetHeight so the placement effect
    // sees a non-zero menu height.
    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(360);

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    const menu = await screen.findByRole('menu', { name: /insert block/i });
    await waitFor(() => {
      expect(menu).toHaveAttribute('data-placement', 'above');
    });
    expect(menu.style.bottom).not.toBe('');
    expect(menu.style.top).toBe('');

    // Item order should be preserved — Text is still first, not reversed.
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent(/text/i);

    offsetHeightSpy.mockRestore();
  });

  it('keeps the menu below the caret when there is room', async () => {
    const editor = createSlashEditor({ top: 24, bottom: 42, left: 18, right: 18 });
    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(360);

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    const menu = await screen.findByRole('menu', { name: /insert block/i });
    await waitFor(() => {
      expect(menu).toHaveAttribute('data-placement', 'below');
    });
    expect(menu.style.top).not.toBe('');
    expect(menu.style.bottom).toBe('');

    offsetHeightSpy.mockRestore();
  });

  it('opens an inline image URL input when the Image from URL item is activated', async () => {
    // window.prompt is unreliable inside Tauri's WKWebView — the slash menu
    // must collect the URL itself instead of calling prompt(). The form keeps
    // focus inside the editor surface and inserts the image only on submit.
    const setImage = vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue(true) });
    const deleteRangeChain = {
      setImage,
      run: vi.fn().mockReturnValue(true),
    };
    const chain = {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnValue(deleteRangeChain),
      run: vi.fn().mockReturnValue(true),
    };
    const editor = createSlashEditor();
    editor.chain = vi.fn().mockReturnValue(chain);
    editor.commands = { focus: vi.fn() };

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /image from url/i }));

    const form = await screen.findByTestId('slash-command-image-form');
    const input = form.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: 'https://example.com/cat.png' } });
    fireEvent.submit(form);

    expect(chain.deleteRange).toHaveBeenCalledTimes(1);
    expect(setImage).toHaveBeenCalledWith({ src: 'https://example.com/cat.png' });

    await waitFor(() => {
      expect(screen.queryByTestId('slash-command-image-form')).not.toBeInTheDocument();
    });
  });

  it('cancels the image URL prompt without inserting an image when the input is empty', async () => {
    const setImage = vi.fn();
    const chain = {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnValue({ setImage, run: vi.fn().mockReturnValue(true) }),
      run: vi.fn().mockReturnValue(true),
    };
    const editor = createSlashEditor();
    editor.chain = vi.fn().mockReturnValue(chain);
    editor.commands = { focus: vi.fn() };

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /image from url/i }));

    const form = await screen.findByTestId('slash-command-image-form');
    fireEvent.click(form.querySelector('button[type="button"]') as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByTestId('slash-command-image-form')).not.toBeInTheDocument();
    });
    expect(setImage).not.toHaveBeenCalled();
  });

  it('opens at the caret when the slash:open-at-cursor event fires (Mod+/ shortcut)', async () => {
    // Mod+/ is the discoverable, position-agnostic equivalent of typing `/`
    // at block start. The shortcut publishes the event; the menu must open
    // even though no slash character is present in the document.
    const editor = createSlashEditor();

    render(<SlashCommandMenu editor={editor} />);

    // Drain initial useEffect setup so the subscription is registered.
    await act(async () => {});

    expect(screen.queryByRole('menu', { name: /insert block/i })).toBeNull();

    act(() => {
      publishEditorEvent('slash:open-at-cursor', {});
    });

    expect(
      await screen.findByRole('menu', { name: /insert block/i }),
    ).toBeInTheDocument();
  });

  it('repositions the menu when the editor pane scrolls beneath the slash caret', async () => {
    // The WYSIWYG pane uses overflow:auto, so its scroll never bubbles to
    // window. We listen with capture=true to catch it — otherwise the menu
    // floats away from the slash character on scroll.
    let coords = { top: 100, bottom: 118, left: 18, right: 18 };
    const editor = createSlashEditor(coords);
    editor.view.coordsAtPos = () => coords;

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    const menu = await screen.findByRole('menu', { name: /insert block/i });
    const beforeTop = menu.style.top;

    // Simulate inner pane scrolling: the slash character moves up by 40px.
    coords = { top: 60, bottom: 78, left: 18, right: 18 };
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      expect(menu.style.top).not.toBe(beforeTop);
    });
  });

  it('opens the Turn-into menu over a selection and hides non-convertible items', async () => {
    const editor = createSlashEditor();
    editor.state.selection = { from: 2, to: 10, empty: false, $from: { depth: 1, start: () => 1 } };
    editor.state.doc.nodesBetween = vi.fn();

    render(<SlashCommandMenu editor={editor} />);
    await act(async () => {});

    act(() => {
      publishEditorEvent('slash:open-at-cursor', { mode: 'convert' });
    });

    expect(await screen.findByRole('menu', { name: /turn into/i })).toBeInTheDocument();
    // h1–h5 are offered as conversion targets.
    expect(screen.getByRole('menuitem', { name: /heading 4/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /heading 5/i })).toBeInTheDocument();
    // Insert-only blocks are not conversion targets.
    expect(screen.queryByRole('menuitem', { name: /^table$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /divider/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /image/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /link/i })).toBeNull();
  });

  it('converts without deleting the selection in Turn-into mode', async () => {
    const chain: any = {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      setNode: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true),
    };
    const editor = createSlashEditor();
    editor.chain = vi.fn().mockReturnValue(chain);
    editor.state.selection = { from: 2, to: 10, empty: false, $from: { depth: 1, start: () => 1 } };
    editor.state.doc.nodesBetween = vi.fn();

    render(<SlashCommandMenu editor={editor} />);
    await act(async () => {});

    act(() => {
      publishEditorEvent('slash:open-at-cursor', { mode: 'convert' });
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /heading 1/i }));

    expect(chain.setNode).toHaveBeenCalledWith('heading', { level: 1 });
    expect(chain.deleteRange).not.toHaveBeenCalled();
  });

  it('filters the Turn-into list from its own input without touching the document', async () => {
    const chain: any = {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      setNode: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true),
    };
    const editor = createSlashEditor();
    editor.chain = vi.fn().mockReturnValue(chain);
    editor.commands = { focus: vi.fn() };
    editor.state.selection = { from: 2, to: 10, empty: false, $from: { depth: 1, start: () => 1 } };
    editor.state.doc.nodesBetween = vi.fn();

    render(<SlashCommandMenu editor={editor} />);
    await act(async () => {});

    act(() => {
      publishEditorEvent('slash:open-at-cursor', { mode: 'convert' });
    });

    const input = await screen.findByTestId('slash-command-filter-input');
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'h4' } });

    // Only Heading 4 survives the fuzzy filter as the top hit.
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent(/heading 4/i);

    // Enter runs the top item against the untouched selection.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chain.setNode).toHaveBeenCalledWith('heading', { level: 4 });
    expect(chain.deleteRange).not.toHaveBeenCalled();
  });

  it('refuses to open the Turn-into menu when the selection touches a table', async () => {
    const editor = createSlashEditor();
    editor.state.selection = { from: 2, to: 10, empty: false, $from: { depth: 1, start: () => 1 } };
    editor.state.doc.nodesBetween = (
      _from: number,
      _to: number,
      callback: (node: { type: { name: string } }) => boolean | void,
    ) => {
      callback({ type: { name: 'table' } });
    };

    render(<SlashCommandMenu editor={editor} />);
    await act(async () => {});

    act(() => {
      publishEditorEvent('slash:open-at-cursor', { mode: 'convert' });
    });

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /turn into/i })).toBeNull();
    });
  });

  it('picks an image file and inserts the imported asset path', async () => {
    openDialogMock.mockResolvedValue('/tmp/photos/cat.png');
    importImageAssetMock.mockResolvedValue('assets/cat.png');
    const setImage = vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue(true) });
    const chain: any = {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      setImage,
      run: vi.fn().mockReturnValue(true),
    };
    const editor = createSlashEditor();
    editor.chain = vi.fn().mockReturnValue(chain);
    editor.commands = { focus: vi.fn() };

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /insert an image file/i }));

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          multiple: false,
          directory: false,
          filters: [expect.objectContaining({ name: 'Image' })],
        }),
      );
      expect(importImageAssetMock).toHaveBeenCalledWith('/tmp/photos/cat.png');
      expect(setImage).toHaveBeenCalledWith({ src: 'assets/cat.png' });
    });
  });

  it('falls back to the absolute path when the asset import fails (unsaved doc)', async () => {
    openDialogMock.mockResolvedValue('/tmp/photos/cat.png');
    importImageAssetMock.mockRejectedValue(new Error('Save the document first'));
    const setImage = vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue(true) });
    const chain: any = {
      focus: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      setImage,
      run: vi.fn().mockReturnValue(true),
    };
    const editor = createSlashEditor();
    editor.chain = vi.fn().mockReturnValue(chain);
    editor.commands = { focus: vi.fn() };

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /insert an image file/i }));

    await waitFor(() => {
      expect(setImage).toHaveBeenCalledWith({ src: '/tmp/photos/cat.png' });
    });
  });

  it('matches a Korean keyword query ("/테이블" → Table)', async () => {
    const editor = createSlashEditor();
    setSlashTextBefore(editor, '/테이블');

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    expect(await screen.findByRole('menuitem', { name: /table/i })).toBeInTheDocument();
    // Unrelated commands are filtered out by the Korean keyword.
    expect(screen.queryByRole('menuitem', { name: /heading 1/i })).toBeNull();
  });

  it('matches English mistyped under the Korean IME ("/ㅅ뮤ㅣㄷ" → table → Table)', async () => {
    const editor = createSlashEditor();
    // "table" typed on a dubeolsik layout with the IME left in Korean mode.
    setSlashTextBefore(editor, '/ㅅ뮤ㅣㄷ');

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    expect(await screen.findByRole('menuitem', { name: /table/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /heading 1/i })).toBeNull();
  });
});
