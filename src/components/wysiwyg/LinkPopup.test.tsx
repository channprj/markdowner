import { Editor, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  publishEditorEvent,
  subscribeEditorEvent,
} from '@/lib/editorEvents';
import { WYSIWYG_LINK_OPTIONS } from '@/lib/wysiwygLinkOptions';

import { LinkPopup } from './LinkPopup';

function linkAt(editor: Editor): { text: string; href: string } | null {
  let found: { text: string; href: string } | null = null;
  editor.state.doc.descendants(node => {
    const mark = node.marks.find(candidate => candidate.type.name === 'link');
    if (mark && !found) {
      found = {
        text: node.text ?? '',
        href: typeof mark.attrs.href === 'string' ? mark.attrs.href : '',
      };
    }
  });
  return found;
}

async function flushPopupFrame() {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  });
}

describe('LinkPopup', () => {
  let editor: Editor;
  let host: HTMLDivElement;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    host.setAttribute('data-testid', 'editor-host');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ link: WYSIWYG_LINK_OPTIONS, codeBlock: false }),
      ],
      content: '<p><a href="https://old.example">docs</a> tail</p>',
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      top: 100,
      bottom: 116,
      left: 40,
      right: 80,
    });
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    editor.destroy();
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function replaceContent(content: Content, position: number) {
    editor.commands.setContent(content);
    editor.commands.setTextSelection(position);
  }

  async function openInspection(position = 3) {
    render(<LinkPopup editor={editor} enabled />);
    act(() => publishEditorEvent('link:inspect-request', { position }));
    return screen.findByRole('dialog', { name: 'Link details' });
  }

  async function openEditor() {
    const dialog = await openInspection();
    const url = screen.getByRole('textbox', { name: 'Link URL' });
    act(() => url.focus());
    await screen.findByRole('button', { name: 'Save link' });
    return dialog;
  }

  async function openCreator(position = 8) {
    editor.commands.setTextSelection(position);
    render(<LinkPopup editor={editor} enabled />);
    act(() => publishEditorEvent('link:edit-request', {}));
    return screen.findByRole('dialog', { name: 'Add link' });
  }

  it('does not open from caret movement or hover', async () => {
    render(<LinkPopup editor={editor} enabled />);
    await act(async () => editor.commands.setTextSelection(3));
    fireEvent.mouseOver(host.querySelector('a')!);
    await flushPopupFrame();

    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it('opens a create form without changing the document', async () => {
    replaceContent('<p>Before after</p>', 8);
    const before = editor.getHTML();

    await openCreator();

    expect(screen.getByRole('textbox', { name: 'Display text (optional)' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toHaveValue('');
    expect(editor.getHTML()).toBe(before);
  });

  it('opens an inspection card only from an explicit event', async () => {
    await openInspection();

    const url = screen.getByRole('textbox', { name: 'Link URL' });
    expect(url).toHaveValue('https://old.example');
    expect(url).not.toHaveAttribute('data-editing');
    expect(url).not.toHaveFocus();
    expect(
      screen.getAllByRole('button').map(button => button.getAttribute('aria-label')),
    ).toEqual(['Open link', 'Copy URL', 'Remove link']);
    expect(screen.getByRole('toolbar', { name: 'Link actions' })).toBeInTheDocument();
    expect(editor.state.selection).toMatchObject({ from: 1, to: 5 });
  });

  it('announces itself so the formatting toolbar yields to the link card', async () => {
    const visibility: boolean[] = [];
    const unsubscribe = subscribeEditorEvent('link:popup-visibility', ({ open }) => {
      visibility.push(open);
    });
    await openInspection();
    expect(visibility[visibility.length - 1]).toBe(true);

    fireEvent.mouseDown(document.body);
    expect(visibility[visibility.length - 1]).toBe(false);
    unsubscribe();
  });

  it('publishes the inspected URL only from Open link', async () => {
    const opened = vi.fn();
    const unsubscribe = subscribeEditorEvent('link:open', opened);
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));

    expect(opened).toHaveBeenCalledWith({
      href: 'https://old.example',
      openInNewTab: false,
    });
    unsubscribe();
  });

  it('does not publish an unsafe stored URL from Open link', async () => {
    const linkType = editor.state.schema.marks.link;
    editor.view.dispatch(
      editor.state.tr.addMark(
        1,
        5,
        linkType.create({ href: 'javascript:alert(1)' }),
      ),
    );
    const opened = vi.fn();
    const unsubscribe = subscribeEditorEvent('link:open', opened);
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));

    expect(opened).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This link URL cannot be opened',
    );
    expect(screen.getByRole('dialog', { name: 'Link details' })).toBeInTheDocument();
    unsubscribe();
  });

  it('copies the URL and announces success', async () => {
    await openInspection();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('https://old.example');
    expect(screen.getByRole('status')).toHaveTextContent('URL copied');

    act(() => vi.advanceTimersByTime(1200));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the card open and announces a clipboard failure', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not copy URL',
    );
    expect(screen.getByRole('dialog', { name: 'Link details' })).toBeInTheDocument();
  });

  it('selects the whole URL for editing when the field is focused', async () => {
    await openEditor();

    const url = screen.getByRole('textbox', { name: 'Link URL' }) as HTMLInputElement;
    expect(url).toHaveAttribute('data-editing', 'true');
    expect(url).toHaveValue('https://old.example');
    expect([url.selectionStart, url.selectionEnd]).toEqual([0, 'https://old.example'.length]);
    expect(screen.queryByRole('textbox', { name: 'Display text (optional)' })).toBeNull();
  });

  it('moves into the URL field with ArrowUp from the editor', async () => {
    await openInspection();
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });

    act(() => {
      editor.view.dom.dispatchEvent(event);
    });

    const url = screen.getByRole('textbox', { name: 'Link URL' }) as HTMLInputElement;
    expect(event.defaultPrevented).toBe(true);
    expect(url).toHaveFocus();
    expect(url).toHaveAttribute('data-editing', 'true');
    expect([url.selectionStart, url.selectionEnd]).toEqual([0, url.value.length]);
    expect(screen.getByRole('button', { name: 'Save link' })).toBeInTheDocument();
    expect(editor.state.selection).toMatchObject({ from: 1, to: 5 });
  });

  it('applies a new link using the URL when display text is blank', async () => {
    replaceContent(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Before  after' }],
          },
        ],
      },
      8,
    );
    await openCreator();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: ' https://example.com ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(linkAt(editor)).toEqual({
      text: 'https://example.com',
      href: 'https://example.com',
    });
    expect(editor.getText()).toBe('Before https://example.com after');
    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it.each([
    ['Enter', () => fireEvent.submit(screen.getByRole('textbox', { name: 'Link URL' }).closest('form')!)],
    ['Save', () => fireEvent.click(screen.getByRole('button', { name: 'Save link' }))],
  ])('saves an edited URL with %s and keeps the link text', async (_label, save) => {
    await openEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: 'https://new.example/guides' },
    });

    save();

    expect(linkAt(editor)).toEqual({
      text: 'docs',
      href: 'https://new.example/guides',
    });
    expect(editor.getText()).toBe('docs tail');
    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it('removes the link without removing its text', async () => {
    await openInspection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    expect(linkAt(editor)).toBeNull();
    expect(editor.getText()).toBe('docs tail');
  });

  it.each([
    ['Escape', 'escape'],
    ['outside click', 'outside'],
    ['blur', 'blur'],
  ])('preserves the source byte-for-byte on %s', async (_label, action) => {
    const before = editor.getHTML();
    await openEditor();
    const url = screen.getByRole('textbox', { name: 'Link URL' });
    fireEvent.change(url, { target: { value: 'https://unsaved.example' } });

    if (action === 'escape') {
      fireEvent.keyDown(url, { key: 'Escape' });
    } else if (action === 'outside') {
      fireEvent.mouseDown(document.body);
    } else {
      fireEvent.blur(url, { relatedTarget: document.body });
    }

    expect(screen.queryByTestId('link-popup')).toBeNull();
    expect(editor.getHTML()).toBe(before);
  });

  it('keeps drafts visible and shows an inline invalid URL error', async () => {
    await openEditor();
    const url = screen.getByRole('textbox', { name: 'Link URL' });
    fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    expect(screen.getByRole('status')).toHaveTextContent('Enter a valid link URL');
    expect(url).toHaveValue('javascript:alert(1)');
    expect(linkAt(editor)).toEqual({ text: 'docs', href: 'https://old.example' });
  });

  it('keeps the form open and asks for an empty URL', async () => {
    const before = editor.getHTML();
    await openCreator(8);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('status')).toHaveTextContent('Enter a link URL');
    expect(screen.getByRole('dialog', { name: 'Add link' })).toBeInTheDocument();
    expect(editor.getHTML()).toBe(before);
  });

  it('closes instead of applying after a document-changing transaction', async () => {
    await openEditor();
    act(() => editor.view.dispatch(editor.state.tr.insertText('new ', 1)));

    expect(screen.queryByTestId('link-popup')).toBeNull();
    expect(linkAt(editor)).toEqual({ text: 'docs', href: 'https://old.example' });
  });

  it('closes immediately when disabled', async () => {
    const view = render(<LinkPopup editor={editor} enabled />);
    act(() => publishEditorEvent('link:inspect-request', { position: 3 }));
    expect(await screen.findByTestId('link-popup')).toBeInTheDocument();

    view.rerender(<LinkPopup editor={editor} enabled={false} />);

    expect(screen.queryByTestId('link-popup')).toBeNull();
  });

  it('places the card above when there is enough room', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(48);
    await openInspection();

    expect(screen.getByTestId('link-popup')).toHaveAttribute(
      'data-placement',
      'above',
    );
  });

  it('places the card below when there is not enough room above', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
    vi.mocked(editor.view.coordsAtPos).mockReturnValue({
      top: 10,
      bottom: 26,
      left: 40,
      right: 80,
    });
    await openInspection();

    expect(screen.getByTestId('link-popup')).toHaveAttribute(
      'data-placement',
      'below',
    );
  });

  it.each([
    ['Tab', false],
    ['Shift+Tab', true],
  ])('closes without mutation when %s leaves the form', async (_label, shiftKey) => {
    const before = editor.getHTML();
    await openEditor();
    const target = shiftKey
      ? screen.getByRole('textbox', { name: 'Link URL' })
      : screen.getByRole('button', { name: 'Remove link' });
    target.focus();

    fireEvent.keyDown(target, { key: 'Tab', shiftKey });

    expect(screen.queryByTestId('link-popup')).toBeNull();
    expect(editor.getHTML()).toBe(before);
  });

  it.each([
    [
      'Escape',
      () =>
        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Link URL' }), {
          key: 'Escape',
        }),
    ],
    [
      'Tab past the final control',
      () => {
        const remove = screen.getByRole('button', { name: 'Remove link' });
        remove.focus();
        fireEvent.keyDown(remove, { key: 'Tab' });
      },
    ],
  ])('returns focus to the captured link boundary after %s', async (_label, dismiss) => {
    await openEditor();
    await flushPopupFrame();

    dismiss();
    await flushPopupFrame();

    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.state.selection).toMatchObject({ from: 5, to: 5 });
  });
});
