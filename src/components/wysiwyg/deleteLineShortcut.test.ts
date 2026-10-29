/**
 * ⌘⇧K in WYSIWYG deletes the lines (blocks) the selection touches. Boots a
 * real Tiptap editor with the app's Markdown, table, and task-list extensions
 * and checks the serialized Markdown after each deletion.
 */
import { Editor } from '@tiptap/core';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { GFM_MARKED_OPTIONS } from '@/lib/gfm';

import { createCodeBlockExtension } from './codeBlockExtension';
import { DeleteLineShortcut, deleteSelectedLines } from './deleteLineShortcut';
import { FootnoteExtensions } from './footnoteExtension';
import { FrontMatterExtension } from './frontMatterExtension';
import { MarkdownerHeading } from './headingExtension';
import { MarkdownTable } from './tableMarkdownExtensions';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function buildEditor(markdown: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    // The block-level extensions of App's WYSIWYG editor, incl. TrailingNode.
    extensions: [
      ...FootnoteExtensions,
      FrontMatterExtension,
      StarterKit.configure({ heading: false, codeBlock: false }),
      MarkdownerHeading,
      createCodeBlockExtension(),
      MarkdownTable,
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      DeleteLineShortcut,
      Markdown.configure({ markedOptions: GFM_MARKED_OPTIONS }),
    ],
    content: markdown,
    contentType: 'markdown',
  });
  return editor;
}

/** Document position of the first occurrence of `text`, plus `offset` characters. */
function posOf(target: Editor, text: string, offset = 0): number {
  let found = -1;
  target.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const index = node.text!.indexOf(text);
    if (index >= 0) found = pos + index + offset;
    return false;
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

function select(target: Editor, from: number, to = from) {
  target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, from, to)));
}

function deleteLines(target: Editor) {
  return deleteSelectedLines(target.state, target.view.dispatch);
}

const markdown = (target: Editor) => target.getMarkdown().trim();
// The table serializer pads cells to a common width and adds a blank line after the table.
const tableMarkdown = (target: Editor) => markdown(target).replace(/ +/g, ' ').replace(/\n{3,}/g, '\n\n');

/** Positions just inside every table cell, row by row. */
function cellPositions(target: Editor): number[] {
  const cells: number[] = [];
  target.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') cells.push(pos);
    return true;
  });
  return cells;
}

describe('deleteSelectedLines', () => {
  it('deletes the paragraph under the caret and moves to the next block', () => {
    const view = buildEditor('alpha\n\nbeta\n\ngamma');
    select(view, posOf(view, 'beta', 2));

    expect(deleteLines(view)).toBe(true);
    expect(markdown(view)).toBe('alpha\n\ngamma');
    expect(view.state.selection.$from.parent.textContent).toBe('gamma');
  });

  it('deletes every block a selection touches, but not one it only reaches the start of', () => {
    const view = buildEditor('alpha\n\nbeta\n\ngamma\n\ndelta');
    select(view, posOf(view, 'lpha'), posOf(view, 'gamma'));

    deleteLines(view);
    expect(markdown(view)).toBe('gamma\n\ndelta');
  });

  it('deletes headings and keeps one undo step', () => {
    const view = buildEditor('# Title\n\nbody');
    select(view, posOf(view, 'Title', 1));

    deleteLines(view);
    expect(markdown(view)).toBe('body');
    view.commands.undo();
    expect(markdown(view)).toBe('# Title\n\nbody');
  });

  it('deletes a whole list item, including its nested items', () => {
    const view = buildEditor('- one\n- two\n  - nested\n- three');
    select(view, posOf(view, 'two', 1));
    deleteLines(view);
    expect(markdown(view)).toBe('- one\n- three');

    const nested = buildEditor('- one\n- two\n  - nested\n- three');
    select(nested, posOf(nested, 'nested', 3));
    deleteLines(nested);
    expect(markdown(nested)).toBe('- one\n- two\n- three');
  });

  it('removes a list together with its last item', () => {
    const view = buildEditor('before\n\n- [ ] only\n\nafter');
    select(view, posOf(view, 'only'));

    deleteLines(view);
    expect(markdown(view)).toBe('before\n\nafter');
  });

  it('deletes only the touched lines inside a code block', () => {
    const view = buildEditor('```\nl1\nl2\nl3\n```');
    select(view, posOf(view, 'l2', 1));
    deleteLines(view);
    expect(markdown(view)).toBe('```\nl1\nl3\n```');

    select(view, posOf(view, 'l3', 2));
    deleteLines(view);
    expect(markdown(view)).toBe('```\nl1\n```');
  });

  it('deletes the whole code block once every line is selected', () => {
    const view = buildEditor('intro\n\n```\nl1\nl2\n```\n\noutro');
    select(view, posOf(view, 'l1'), posOf(view, 'l2', 2));

    deleteLines(view);
    expect(markdown(view)).toBe('intro\n\noutro');
  });

  it('deletes the table row under the caret', () => {
    const view = buildEditor('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    select(view, posOf(view, '3'));

    deleteLines(view);
    expect(tableMarkdown(view)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('promotes the next row when the header row is deleted', () => {
    const view = buildEditor('| h1 | h2 |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |');
    select(view, posOf(view, 'h1', 1));

    deleteLines(view);
    expect(tableMarkdown(view)).toBe('| r1a | r1b |\n| --- | --- |\n| r2a | r2b |');
    view.commands.undo();
    expect(tableMarkdown(view)).toBe('| h1 | h2 |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |');
  });

  it('deletes the rows a cell selection spans, and the table when it spans them all', () => {
    const view = buildEditor('| h1 | h2 |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |\n| r3a | r3b |\n\nafter');
    const cells = cellPositions(view);
    view.view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cells[2], cells[5])));
    deleteLines(view);
    expect(tableMarkdown(view)).toBe('| h1 | h2 |\n| --- | --- |\n| r3a | r3b |\n\nafter');

    const all = cellPositions(view);
    view.view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, all[0], all[all.length - 1])));
    deleteLines(view);
    expect(markdown(view)).toBe('after');
  });

  it('keeps the code lines a selection crossing into or out of a code block does not touch', () => {
    const source = 'intro\n\n```\nfirst\nmiddle\nlast\n```\n\noutro';
    const into = buildEditor(source);
    select(into, posOf(into, 'intro', 2), posOf(into, 'first', 2));
    deleteLines(into);
    expect(markdown(into)).toBe('```\nmiddle\nlast\n```\n\noutro');

    const outOf = buildEditor(source);
    select(outOf, posOf(outOf, 'last', 1), posOf(outOf, 'outro', 2));
    deleteLines(outOf);
    expect(markdown(outOf)).toBe('intro\n\n```\nfirst\nmiddle\n```');

    const twoBlocks = buildEditor('```\na1\na2\na3\n```\n\n```\nb1\nb2\nb3\n```');
    select(twoBlocks, posOf(twoBlocks, 'a2'), posOf(twoBlocks, 'b2', 1));
    deleteLines(twoBlocks);
    expect(markdown(twoBlocks)).toBe('```\na1\n```\n\n```\nb3\n```');
  });

  it('keeps the table rows a selection leaving the table does not touch', () => {
    const view = buildEditor('before\n\n| h |\n| --- |\n| r1 |\n| r2 |\n| r3 |\n\nafter\n\nend');
    select(view, posOf(view, 'r2'), posOf(view, 'after', 2));

    deleteLines(view);
    expect(tableMarkdown(view)).toBe('before\n\n| h |\n| --- |\n| r1 |\n\nend');
  });

  it('collapses the caret after deleting the last code line a selection touches', () => {
    const view = buildEditor('```\nl1\nl2\n```\n\nnext');
    select(view, posOf(view, 'l2'), posOf(view, 'next'));

    deleteLines(view);
    expect(markdown(view)).toBe('```\nl1\n```\n\nnext');
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe('codeBlock');
  });

  it('puts the caret in text, never on front matter or a rule the next keystroke would replace', () => {
    const view = buildEditor('---\ntitle: x\n---\n\nbody');
    select(view, posOf(view, 'body', 2));
    deleteLines(view);
    expect(view.state.selection).toBeInstanceOf(TextSelection);
    view.commands.insertContent('z');
    expect(view.state.doc.firstChild?.type.name).toBe('frontMatter');
    expect(view.getMarkdown()).toContain('title: x');

    const rule = buildEditor('a\n\nb\n\n---\n\nc');
    select(rule, posOf(rule, 'b'));
    deleteLines(rule);
    expect(rule.state.selection).toBeInstanceOf(TextSelection);
    expect(markdown(rule)).toBe('a\n\n---\n\nc');
  });

  it('removes a footnote definition with its only paragraph', () => {
    const view = buildEditor('text[^1]\n\n[^1]: note');
    select(view, posOf(view, 'note', 2));

    deleteLines(view);
    let definitions = 0;
    view.state.doc.descendants((node) => {
      if (node.type.name === 'footnoteDefinition') definitions += 1;
      return true;
    });
    expect(definitions).toBe(0);
  });

  it('leaves no empty list or quote behind when a selection leaves it', () => {
    const list = buildEditor('- one\n- two\n\nafter\n\nend');
    select(list, posOf(list, 'one'), posOf(list, 'after', 2));
    deleteLines(list);
    expect(markdown(list)).toBe('end');

    const quote = buildEditor('> quote one\n\nafter\n\nend');
    select(quote, posOf(quote, 'quote'), posOf(quote, 'after', 2));
    deleteLines(quote);
    expect(markdown(quote)).toBe('end');
  });

  it('deletes a rule wholly inside a selection that ends at the next block', () => {
    const view = buildEditor('a\n\n---\n\nb');
    select(view, posOf(view, 'a'), posOf(view, 'b'));

    deleteLines(view);
    expect(markdown(view)).toBe('b');
  });

  it('deletes the whole item when a selection starts on its line and ends in a nested item', () => {
    const view = buildEditor('- one\n- two\n  - a\n  - b\n- three');
    select(view, posOf(view, 'two', 1), posOf(view, 'a', 1));

    deleteLines(view);
    expect(markdown(view)).toBe('- one\n- three');
  });

  it('changes nothing when there is nothing to delete', () => {
    const empty = buildEditor('only');
    select(empty, posOf(empty, 'only'));
    deleteLines(empty);
    const emptied = empty.state;
    expect(deleteLines(empty)).toBe(true);
    expect(empty.state).toBe(emptied);

    // TrailingNode would re-create this paragraph and pull the caret into the table.
    const trailing = buildEditor('| a |\n| --- |\n| 1 |');
    const { doc, schema } = trailing.state;
    trailing.view.dispatch(trailing.state.tr.insert(doc.content.size, schema.nodes.paragraph.create()));
    select(trailing, trailing.state.doc.content.size - 1);
    const before = trailing.state;
    expect(deleteLines(trailing)).toBe(true);
    expect(trailing.state).toBe(before);
  });

  it('deletes a selected block atom', () => {
    const view = buildEditor('alpha\n\n---\n\nbeta');
    let rule = -1;
    view.state.doc.forEach((node, offset) => {
      if (node.type.name === 'horizontalRule') rule = offset;
    });
    view.view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, rule)));

    deleteLines(view);
    expect(markdown(view)).toBe('alpha\n\nbeta');
  });

  it('makes the promoted row a full header row, whatever cells it had', () => {
    // Pasted HTML can bring a second header row or a header column.
    const twoHeaderRows = buildEditor('start');
    select(twoHeaderRows, posOf(twoHeaderRows, 'start', 5));
    twoHeaderRows.commands.insertContent(
      '<table><tr><th>h1</th><th>h2</th></tr><tr><th>x1</th><th>x2</th></tr><tr><td>r2a</td><td>r2b</td></tr></table>',
    );
    select(twoHeaderRows, posOf(twoHeaderRows, 'h1', 1));
    deleteLines(twoHeaderRows);
    expect(tableMarkdown(twoHeaderRows)).toBe('start\n\n| x1 | x2 |\n| --- | --- |\n| r2a | r2b |');
    twoHeaderRows.destroy();

    const headerColumn = buildEditor('start');
    select(headerColumn, posOf(headerColumn, 'start', 5));
    headerColumn.commands.insertContent(
      '<table><tr><th>h1</th><th>h2</th></tr><tr><th>r1a</th><td>r1b</td></tr><tr><th>r2a</th><td>r2b</td></tr></table>',
    );
    select(headerColumn, posOf(headerColumn, 'h1', 1));
    deleteLines(headerColumn);
    expect(tableMarkdown(headerColumn)).toBe('start\n\n| r1a | r1b |\n| --- | --- |\n| r2a | r2b |');
  });

  it('promotes the next row when a selection from above the table removes the header row', () => {
    const view = buildEditor('before\n\n| h1 | h2 |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |\n\nafter');
    select(view, posOf(view, 'before', 1), posOf(view, 'r1a', 1));

    deleteLines(view);
    expect(tableMarkdown(view)).toBe('| r2a | r2b |\n| --- | --- |\n\nafter');
  });

  it('deletes the whole item when a selection from its line ends in a code block inside it', () => {
    const view = buildEditor('- a\n  - b\n\n    ```\n    c1\n    c2\n    ```\n- z');
    select(view, posOf(view, 'a'), posOf(view, 'c1', 1));

    deleteLines(view);
    expect(markdown(view)).toBe('- z');
  });

  it('leaves one empty paragraph when the only block is deleted', () => {
    const view = buildEditor('only');
    select(view, posOf(view, 'only', 2));

    deleteLines(view);
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.doc.textContent).toBe('');
  });
});

describe('DeleteLineShortcut', () => {
  // ProseMirror reads "Mod" as ⌘ on macOS and Ctrl elsewhere.
  const commandKey = /Mac/.test(navigator.platform) ? 'metaKey' : 'ctrlKey';
  /** Shift+⌘ chord as WebKit reports it: shifted `key` plus the physical `keyCode`. */
  const press = (target: Editor, key: string) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey: true, [commandKey]: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) });
    return target.view.someProp('handleKeyDown', (handler) => handler(target.view, event)) ?? false;
  };

  it('binds Cmd+Shift+K', () => {
    const view = buildEditor('alpha\n\nbeta');
    select(view, posOf(view, 'beta'));

    expect(press(view, 'K')).toBe(true);
    expect(markdown(view)).toBe('alpha');
  });

  it('does nothing while the editor is read-only', () => {
    const view = buildEditor('alpha\n\nbeta');
    view.setEditable(false);
    select(view, posOf(view, 'beta'));

    expect(press(view, 'K')).toBe(false);
    expect(markdown(view)).toBe('alpha\n\nbeta');
  });
});
