import { FootnoteExtensions } from '@/components/wysiwyg/footnoteExtension';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

const editors: Editor[] = [];
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.commands.insertContent(char);
  }
}

function buildEditor(source: string) {
  const editor = new Editor({
    extensions: [
      ...FootnoteExtensions,
      StarterKit.configure({ trailingNode: false }),
      Table, TableRow, TableHeader, TableCell,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: source,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));

describe('Markdown footnotes', () => {
  it('preserves named and numeric definitions after editing and reopening', () => {
    const source = '본문[^report] and note[^1]. Again[^report].\n\n[^report]: **출처** and `file.md`.\n[^1]: Numeric note.';
    const editor = buildEditor(source);
    expect(editor.view.dom.querySelectorAll('[data-footnote-reference]')).toHaveLength(3);
    expect(editor.view.dom.querySelectorAll('[data-footnote-definition]')).toHaveLength(2);
    editor.commands.insertContentAt(1, 'Edited ');
    const saved = editor.getMarkdown();
    expect(saved).toContain('[^report]: **출처** and `file.md`.');
    expect(saved).toContain('[^1]: Numeric note.');
    expect(saved.match(/\[\^report\]/g)).toHaveLength(3);
    editor.commands.setContent(saved, { contentType: 'markdown' });
    expect(editor.getMarkdown()).toBe(saved);
  });

  it('keeps multiple paragraphs, lists, code and links inside an editable definition', () => {
    const editor = buildEditor('Text[^long].\n\n[^long]: First **bold** paragraph.\n    continued line\n\n    Another [link](https://example.com).\n\n    - item\n\n    ```ts\n    const x = 1;\n    ```\n\nOutside.');
    const definition = editor.state.doc.child(1);
    expect(definition.type.name).toBe('footnoteDefinition');
    expect(definition.childCount).toBe(4);
    expect(definition.child(3).type.name).toBe('codeBlock');
    expect(editor.state.doc.lastChild?.textContent).toBe('Outside.');
    let noteStart = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnoteDefinition') noteStart = pos + 2;
    });
    editor.commands.insertContentAt(noteStart, 'Edited ');
    const saved = editor.getMarkdown();
    expect(saved).toContain('[^long]: Edited First **bold** paragraph.');
    editor.commands.setContent(saved, { contentType: 'markdown' });
    expect(editor.state.doc.child(1).childCount).toBe(4);
    expect(editor.getMarkdown()).toBe(saved);
  });

  it('treats lazy continuation as footnote text without swallowing the next block', () => {
    const editor = buildEditor('Text[^n].\n\n[^n]: First line\ncontinued line\n# Heading\n\nOutside.');
    expect(editor.state.doc.child(1).textContent).toBe('First line\ncontinued line');
    expect(editor.state.doc.child(2).type.name).toBe('heading');
  });

  it('numbers repeated references by first use and updates after edits', () => {
    const editor = buildEditor('First[^B] again[^b] next[^1] missing[^absent].\n\n[^1]: One.\n[^b]: Two.');
    const buttons = () => [...editor.view.dom.querySelectorAll('[data-footnote-reference] button')].map(el => el.textContent);
    expect(buttons()).toEqual(['1', '1', '2', '[^absent]']);
    expect(editor.view.dom.querySelector<HTMLButtonElement>('[data-footnote-reference="absent"] button')?.disabled).toBe(true);
    editor.commands.insertContentAt(1, { type: 'footnoteReference', attrs: { label: '1' } });
    expect(buttons()).toEqual(['1', '2', '2', '1', '[^absent]']);
  });

  it('navigates to the editable definition and back without changing Markdown', () => {
    const editor = buildEditor('Text[^note].\n\n[^note]: Definition.');
    const saved = editor.getMarkdown();
    editor.view.dom.querySelector<HTMLButtonElement>('[data-footnote-reference] button')!.click();
    expect(editor.state.selection.$from.parent.textContent).toBe('Definition.');
    editor.view.dom.querySelector<HTMLButtonElement>('[data-footnote-definition] button')!.click();
    expect(editor.state.selection.$from.nodeAfter?.type.name).toBe('footnoteReference');
    expect(editor.getMarkdown()).toBe(saved);
  });

  it('retains literal syntax in code and escaped text, plus unused definitions', () => {
    const editor = buildEditor('`[^code]` and \\[^escaped] and [site](https://example.com).\n\n```md\n[^code]: literal\n```\n\n[^unused]: Kept.');
    expect(editor.view.dom.querySelectorAll('[data-footnote-reference]')).toHaveLength(0);
    expect(editor.getMarkdown()).toContain('[^unused]: Kept.');
    const saved = editor.getMarkdown();
    editor.commands.setContent(saved, { contentType: 'markdown' });
    expect(editor.view.dom.querySelectorAll('[data-footnote-reference]')).toHaveLength(0);
  });

  it('recognizes references inside lists and table cells and preserves Unicode labels', () => {
    const editor = buildEditor('- List[^출처]\n\n| Name |\n| --- |\n| Cell[^출처] |\n\n[^출처]: 한글.');
    expect(editor.view.dom.querySelector('li [data-footnote-reference]')).not.toBeNull();
    expect(editor.view.dom.querySelector('td [data-footnote-reference]')).not.toBeNull();
    expect(editor.getMarkdown()).toContain('[^출처]: 한글.');
  });

  it('round-trips rich clipboard HTML without turning labels into body text', () => {
    const editor = buildEditor('Text[^1].\n\n[^1]: **Note**.');
    const saved = editor.getMarkdown();
    editor.commands.setContent(editor.getHTML());
    expect(editor.getMarkdown()).toBe(saved);
  });

  it('authors a reference on space and a definition on colon-space', () => {
    const editor = buildEditor('');
    type(editor, 'Note[^1] ');
    expect(editor.view.dom.querySelector('[data-footnote-reference]')).not.toBeNull();
    editor.commands.setContent('');
    type(editor, '[^1]: ');
    expect(editor.state.selection.$from.node(1).type.name).toBe('footnoteDefinition');
    type(editor, 'New note.');
    expect(editor.getMarkdown()).toBe('[^1]: New note.');
  });

  it('does not convert escaped references while typing', () => {
    const editor = buildEditor('');
    type(editor, '\\[^literal] ');
    expect(editor.view.dom.querySelector('[data-footnote-reference]')).toBeNull();
  });
});
