import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, describe, expect, it } from 'vitest';

import { applyWysiwygSelectionReplacement, captureWysiwygSelection, captureWysiwygEditorSelection } from './selection';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

describe('inline AI replacement in the real Markdown editor', () => {
  it.each([
    ['alpha beta gamma', 'beta', 'BETA'],
    ['alpha beta gamma', 'beta', '**BETA**'],
    ['앞 문장과 수정할 내용 그리고 뒷문장', '수정할 내용', '개선한 내용'],
    ['alpha **beta** gamma', 'beta', 'BETA'],
    ['alpha **beta** gamma', 'et', 'ET'],
    ['alpha [beta](https://example.test) gamma', 'et', 'ET'],
    ['- alpha beta gamma\n- untouched', 'beta', 'BETA'],
  ])('replaces only the captured text and undoes in one step: %s', (source, selected, replacement) => {
    editor = new Editor({
      extensions: [StarterKit, Markdown],
      content: source,
      contentType: 'markdown',
    });
    // Let StarterKit append its trailing editable paragraph before capture.
    editor.commands.setTextSelection(1);
    source = editor.getMarkdown();
    const historyDepth = undoDepth(editor.state);
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      const offset = node.isText ? node.text!.indexOf(selected) : -1;
      if (offset >= 0) from = pos + offset;
    });
    expect(from).toBeGreaterThan(0);
    const start = source.indexOf(selected);
    const beforeCapture = editor.state;
    const snapshot = captureWysiwygEditorSelection({ editor,
      documentId: 'synthetic', source, from, to: from + selected.length })!;
    expect(editor.state).toBe(beforeCapture);
    expect(snapshot?.characterRange).toEqual({ start, end: start + selected.length });
    expect(snapshot.selectedText).toBe(selected);
    // Moving the caret while the model works must never move the edit target.
    editor.commands.setTextSelection(1);
    expect(applyWysiwygSelectionReplacement({ editor, snapshot, currentSource: source, replacement })).toBe(true);
    expect(editor.getMarkdown()).toBe(source.replace(selected, replacement));
    expect(undoDepth(editor.state)).toBe(historyDepth + 1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe(source);
    expect(undoDepth(editor.state)).toBe(historyDepth);
  });

  it('leaves the document and history untouched if Markdown cannot represent the exact result', () => {
    editor = new Editor({ extensions: [StarterKit, Markdown], content: 'alpha beta', contentType: 'markdown' });
    const snapshot = captureWysiwygSelection({ documentId: 'synthetic', source: 'alpha beta',
      markdownStart: 6, markdownEnd: 10, proseMirrorFrom: 7, proseMirrorTo: 11 })!;
    const previousState = editor.state;
    expect(applyWysiwygSelectionReplacement({ editor, snapshot, currentSource: 'alpha beta',
      replacement: '<span>unsupported HTML</span>' })).toBe(false);
    expect(editor.state).toBe(previousState);
    expect(editor.getMarkdown()).toBe('alpha beta');
    expect(undoDepth(editor.state)).toBe(0);
  });
});
