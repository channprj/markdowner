/**
 * Integration tests for the table column/row add & delete commands wired into
 * the WYSIWYG TableToolbar. The existing TableToolbar.test.tsx only verifies
 * button wiring against a mock editor; this boots a REAL Tiptap editor with the
 * same table extensions and asserts that each command targets the cell the
 * caret sits in and produces the correct structure with content preserved.
 *
 * Table structure transforms are pure ProseMirror doc operations (no layout),
 * so jsdom is sufficient and the result matches what WebKit/Tauri runs.
 */
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function buildEditor(): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '<p>x</p>',
  });
}

/** Row-major cell start positions (header + body cells). */
function cellPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') out.push(pos);
    return true;
  });
  return out;
}

/** Table dimensions as [rows, cols] read straight off the document. */
function dimensions(editor: Editor): [number, number] {
  let rows = 0;
  let cols = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') {
      rows += 1;
      if (rows === 1) cols = node.childCount;
    }
    return true;
  });
  return [rows, cols];
}

/** Row-major cell text contents. */
function cellTexts(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
      out.push(node.textContent);
    }
    return true;
  });
  return out;
}

/** Put the caret inside the body cell at the given row/col (0-based). */
function caretInCell(editor: Editor, row: number, col: number): void {
  const cells = cellPositions(editor);
  const [, cols] = dimensions(editor);
  const index = row * cols + col;
  editor.chain().focus().setTextSelection(cells[index] + 1).run();
}

describe('table column/row editing commands', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = buildEditor();
    // 2x2 with a header row: row0 = headers, row1 = body. Fill identifiable text.
    editor
      .chain()
      .focus()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run();
    const cells = cellPositions(editor);
    editor.chain().setTextSelection(cells[0] + 1).insertContent('A').run();
    editor.chain().setTextSelection(cellPositions(editor)[1] + 1).insertContent('B').run();
    editor.chain().setTextSelection(cellPositions(editor)[2] + 1).insertContent('C').run();
    editor.chain().setTextSelection(cellPositions(editor)[3] + 1).insertContent('D').run();
  });

  afterEach(() => {
    const el = editor.view.dom.parentElement;
    editor.destroy();
    el?.remove();
  });

  it('starts as a 2x2 table A,B / C,D', () => {
    expect(dimensions(editor)).toEqual([2, 2]);
    expect(cellTexts(editor)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('addColumnAfter from col0 inserts an empty column to the right of col0', () => {
    caretInCell(editor, 1, 0); // body cell "C"
    editor.chain().focus().addColumnAfter().run();
    expect(dimensions(editor)).toEqual([2, 3]);
    // Row-major: header A, new, B / body C, new, D
    expect(cellTexts(editor)).toEqual(['A', '', 'B', 'C', '', 'D']);
  });

  it('addColumnBefore from col1 inserts an empty column to the left of col1', () => {
    caretInCell(editor, 1, 1); // body cell "D"
    editor.chain().focus().addColumnBefore().run();
    expect(dimensions(editor)).toEqual([2, 3]);
    expect(cellTexts(editor)).toEqual(['A', '', 'B', 'C', '', 'D']);
  });

  it('addRowAfter from row1 inserts an empty row below', () => {
    caretInCell(editor, 1, 0); // body cell "C"
    editor.chain().focus().addRowAfter().run();
    expect(dimensions(editor)).toEqual([3, 2]);
    expect(cellTexts(editor)).toEqual(['A', 'B', 'C', 'D', '', '']);
  });

  it('addRowBefore from the body row inserts an empty row above it', () => {
    caretInCell(editor, 1, 0); // body cell "C"
    editor.chain().focus().addRowBefore().run();
    expect(dimensions(editor)).toEqual([3, 2]);
    // New empty body row inserted between header row and C,D row.
    expect(cellTexts(editor)).toEqual(['A', 'B', '', '', 'C', 'D']);
  });

  it('deleteColumn removes the column the caret is in', () => {
    caretInCell(editor, 1, 0); // body cell "C" (col0)
    editor.chain().focus().deleteColumn().run();
    expect(dimensions(editor)).toEqual([2, 1]);
    expect(cellTexts(editor)).toEqual(['B', 'D']);
  });

  it('deleteRow removes the row the caret is in', () => {
    caretInCell(editor, 1, 0); // body row
    editor.chain().focus().deleteRow().run();
    expect(dimensions(editor)).toEqual([1, 2]);
    expect(cellTexts(editor)).toEqual(['A', 'B']);
  });
});
