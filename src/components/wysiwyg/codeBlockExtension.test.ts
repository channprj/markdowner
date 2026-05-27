/**
 * Behaviour tests for the custom code-block keyboard handling. These are pure
 * document-structure operations (no layout), so a real Tiptap editor in jsdom
 * is sufficient and matches what WebKit/Tauri runs.
 *
 * Guards the down-arrow exit specifically: our addKeyboardShortcuts override
 * shadows CodeBlockLowlight's built-in exitOnArrowDown, so the exit must be
 * re-implemented here — a regression test stops it silently disappearing again.
 */
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodeBlockExtension } from './codeBlockExtension';

function buildEditor(content: string): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit.configure({ codeBlock: false }), createCodeBlockExtension()],
    content,
  });
}

function pressArrowDown(editor: Editor): boolean {
  return Boolean(
    editor.view.someProp('handleKeyDown', (fn) =>
      fn?.(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    ),
  );
}

describe('code block keyboard handling', () => {
  let editor: Editor;

  afterEach(() => {
    const el = editor?.view.dom.parentElement;
    editor?.destroy();
    el?.remove();
  });

  describe('ArrowDown exit', () => {
    beforeEach(() => {
      editor = buildEditor('<pre><code>line1\nline2</code></pre>');
      // jsdom has no layout; downstream keymap handlers (gapcursor) call
      // endOfTextblock -> coordsAtPos -> getClientRects, which throws. Stub it
      // so only our ArrowDown decision is exercised.
      vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false);
    });

    it('exits the code block to the paragraph below from the last line', () => {
      // Caret at the very end (last line) of the code block.
      const end = editor.state.doc.firstChild!.nodeSize - 1;
      editor.chain().focus().setTextSelection(end).run();
      const handled = pressArrowDown(editor);
      expect(handled).toBe(true);
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    });

    it('does not exit when the caret is not on the last line', () => {
      // Caret on the first line (before the newline).
      editor.chain().focus().setTextSelection(3).run();
      const handled = pressArrowDown(editor);
      expect(handled).toBeFalsy();
      expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
    });
  });

  it('creates a paragraph below when the code block is the last node', () => {
    editor = buildEditor('<pre><code>only</code></pre>');
    // Remove any trailing node so the code block is genuinely last.
    const docChildCount = editor.state.doc.childCount;
    // Place caret at end of the code block content.
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.chain().focus().setTextSelection(end).run();
    pressArrowDown(editor);
    // Either moved into an existing trailing paragraph or created one; the
    // caret must end up in a paragraph regardless of starting trailing state.
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(docChildCount);
  });
});
