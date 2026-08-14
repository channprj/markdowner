import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeEditorEvent } from '@/lib/editorEvents';

import { SelectionToolbar } from './SelectionToolbar';

function createSelectionEditor({
  inCodeBlock = false,
  empty = false,
}: { inCodeBlock?: boolean; empty?: boolean } = {}) {
  const handlers = new Map<string, Set<() => void>>();
  const dom = document.createElement('div');
  const chain = {
    focus: vi.fn(),
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleStrike: vi.fn(),
    toggleCode: vi.fn(),
    extendMarkRange: vi.fn(),
    insertContent: vi.fn(),
    setLink: vi.fn(),
    unsetLink: vi.fn(),
    run: vi.fn().mockReturnValue(true),
  };
  for (const command of [
    chain.focus,
    chain.toggleBold,
    chain.toggleItalic,
    chain.toggleStrike,
    chain.toggleCode,
    chain.extendMarkRange,
    chain.insertContent,
    chain.setLink,
    chain.unsetLink,
  ]) {
    command.mockReturnValue(chain);
  }

  const editor: any = {
    commandSpies: chain,
    isActive: vi.fn((name: string) => (name === 'codeBlock' ? inCodeBlock : false)),
    state: {
      selection: {
        from: 2,
        to: empty ? 2 : 6,
        empty,
      },
    },
    view: {
      dom,
      hasFocus: () => true,
      coordsAtPos: () => ({ top: 80, bottom: 100, left: 40, right: 60 }),
    },
    chain: vi.fn(() => chain),
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

describe('SelectionToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the formatting toolbar for an inline selection outside a code block', async () => {
    const editor = createSelectionEditor({ inCodeBlock: false });

    render(<SelectionToolbar editor={editor} />);
    act(() => {
      editor.emit('selectionUpdate');
    });

    expect(
      await screen.findByRole('toolbar', { name: /text formatting/i }),
    ).toBeInTheDocument();
  });

  it('hides the toolbar when the selection is inside a code block', async () => {
    // Bold / italic / strike / inline-code / link cannot be applied inside
    // a code block — the schema rejects them. Showing buttons that silently
    // do nothing on click would read as "the editor is broken".
    const editor = createSelectionEditor({ inCodeBlock: true });

    render(<SelectionToolbar editor={editor} />);
    act(() => {
      editor.emit('selectionUpdate');
    });

    // Wait a microtask + RAF for the toolbar to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: /text formatting/i })).toBeNull();
    });
  });

  it('hides the toolbar when the selection collapses', async () => {
    const editor = createSelectionEditor({ empty: true });

    render(<SelectionToolbar editor={editor} />);
    act(() => {
      editor.emit('selectionUpdate');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('toolbar', { name: /text formatting/i })).toBeNull();
  });

  it('opens AI for the exact ProseMirror text range', async () => {
    const editor = createSelectionEditor();
    const onAiSelection = vi.fn();

    render(
      <SelectionToolbar editor={editor} onAiSelection={onAiSelection} />,
    );
    act(() => {
      editor.emit('selectionUpdate');
    });

    fireEvent.click(await screen.findByRole('button', { name: 'AI actions' }));

    expect(onAiSelection).toHaveBeenCalledWith({ from: 2, to: 6 });
  });

  it('announces the effective shortcut on the AI action', async () => {
    const editor = createSelectionEditor();

    render(
      <SelectionToolbar
        editor={editor}
        onAiSelection={vi.fn()}
        aiShortcut="⌘⇧K"
      />,
    );
    act(() => {
      editor.emit('selectionUpdate');
    });

    const button = await screen.findByRole('button', { name: 'AI actions (⌘⇧K)' });
    expect(button).toHaveAttribute('title', 'AI actions (⌘⇧K)');
  });

  it('retains the exact Tiptap range when the live selection collapses before click', async () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit],
      content: '<p>alpha beta</p>',
    });
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      top: 80,
      bottom: 100,
      left: 40,
      right: 60,
    });
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    const onAiSelection = vi.fn();

    render(
      <SelectionToolbar editor={editor} onAiSelection={onAiSelection} />,
    );
    act(() => {
      editor.commands.setTextSelection({ from: 2, to: 6 });
    });

    const button = await screen.findByRole('button', { name: 'AI actions' });
    fireEvent.mouseDown(button);
    act(() => {
      editor.commands.setTextSelection(6);
    });
    fireEvent.click(button);

    expect(onAiSelection).toHaveBeenCalledWith({ from: 2, to: 6 });
    editor.destroy();
  });

  it('requests explicit link editing without applying a placeholder mark', async () => {
    const editor = createSelectionEditor();
    const requested = vi.fn();
    const unsubscribe = subscribeEditorEvent('link:edit-request', requested);
    render(<SelectionToolbar editor={editor} />);
    act(() => editor.emit('selectionUpdate'));

    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));

    expect(requested).toHaveBeenCalledOnce();
    expect(requested).toHaveBeenCalledWith({});
    expect(editor.commandSpies.setLink).not.toHaveBeenCalled();
    expect(editor.commandSpies.insertContent).not.toHaveBeenCalled();
    expect(editor.commandSpies.unsetLink).not.toHaveBeenCalled();
    unsubscribe();
  });
});
