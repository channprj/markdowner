import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { CellSelection, deleteRow, selectedRect, tableNodeTypes } from '@tiptap/pm/tables';

/** List items whose first block is the item's own line. */
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

function tableDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole === 'table') return depth;
  }
  return null;
}

/**
 * The depth of the block a position's line belongs to: the whole table when
 * the selection leaves it, a footnote definition for its only paragraph (its
 * `[^n]:` line), the list item for its first block, otherwise the textblock.
 */
function lineDepth($pos: ResolvedPos, inTable: number | null): number {
  if (inTable !== null) return inTable;
  const depth = $pos.depth;
  if (depth < 2) return depth;
  const parent = $pos.node(depth - 1);
  if (parent.type.name === 'footnoteDefinition' && parent.childCount === 1) return depth - 1;
  return LIST_ITEM_TYPES.has(parent.type.name) && $pos.index(depth - 1) === 0 ? depth - 1 : depth;
}

/** Offset where the code line holding `offset` starts. */
function codeLineStart(text: string, offset: number): number {
  return offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
}

/**
 * Offset of the newline that ends the last code line a range touches, or -1
 * when that is the final line. A range ending at a line start does not touch
 * that line.
 */
function codeLineBreak(text: string, start: number, end: number): number {
  return text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end);
}

/** Whether every cell of the table's first row is a header cell. */
function hasHeaderRow(table: ProseMirrorNode): boolean {
  let header = table.childCount > 0;
  table.firstChild?.forEach((cell) => {
    if (cell.type.spec.tableRole !== 'header_cell') header = false;
  });
  return header;
}

/**
 * Turn every cell of the first row (at `rowPos`) into a header cell. Unlike
 * toggleHeaderRow this never turns header cells back into body cells and
 * touches only that row, whatever the selection or row spans.
 */
function promoteFirstRow(tr: Transaction, rowPos: number): void {
  const row = tr.doc.nodeAt(rowPos);
  const header = tableNodeTypes(tr.doc.type.schema).header_cell;
  row?.forEach((cell, offset) => {
    if (cell.type !== header) tr.setNodeMarkup(rowPos + 1 + offset, header, cell.attrs);
  });
}

/**
 * Delete the table rows the selection spans; false when that would be every
 * row. When the header row goes, the next row becomes the header so the
 * Markdown table keeps a real header line.
 */
function deleteTableRows(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const rect = selectedRect(state);
  const headerGoes = rect.top === 0 && hasHeaderRow(rect.table);
  const deleted: { tr?: Transaction } = {};
  if (!deleteRow(state, (tr) => { deleted.tr = tr; })) return false;
  if (!dispatch || !deleted.tr) return true;
  const { tr } = deleted;
  // Rows are removed inside the table, so its first row still starts at tableStart.
  if (headerGoes) promoteFirstRow(tr, rect.tableStart);
  dispatch(tr.scrollIntoView());
  return true;
}

/** Grow a block range over wrappers (lists, quotes) it would otherwise leave empty. */
function widenOverWrappers(
  doc: ProseMirrorNode,
  range: { from: number; to: number },
  keep: { from: boolean; to: boolean },
): { from: number; to: number } {
  let { from, to } = range;
  for (;;) {
    const $start = doc.resolve(from);
    if (!keep.from && $start.depth > 0 && from === $start.start() && to >= $start.end()) {
      from = $start.before();
      continue;
    }
    const $end = doc.resolve(to);
    if (!keep.to && $end.depth > 0 && to === $end.end() && from <= $end.start()) {
      to = $end.after();
      continue;
    }
    return { from, to };
  }
}

/**
 * Delete the lines the selection touches, like Zed's and the Source editor's
 * ⌘⇧K. In WYSIWYG a line is a block: a paragraph, a heading, or a whole list
 * item with its nested items. Inside a code block it is a code line and
 * inside a table it is a row, so a selection that crosses into either keeps
 * the lines and rows it does not touch. The change is one undo step and the
 * caret lands in the text that follows.
 */
export function deleteSelectedLines(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { selection, doc } = state;
  const { $from } = selection;
  let { $to } = selection;
  // A selection that ends at the start of a block does not touch that block.
  const endsAtBlockStart =
    !selection.empty && $to.parent.isTextblock && $to.parentOffset === 0 && !$from.sameParent($to);
  const selectionEnd = $to.pos;
  if (endsAtBlockStart) {
    const previous = Selection.findFrom(doc.resolve($to.before()), -1, true);
    if (previous && previous.$head.pos >= $from.pos) $to = previous.$head;
  }

  let from: number;
  let to: number;
  // Leading code lines / table rows of the first block, and trailing ones of
  // the last block, that the selection does not touch.
  let headCut: [number, number] | null = null;
  let tailCut: [number, number] | null = null;
  // The tail cut removes a table's header row: promote the row after it.
  let tailPromotes = false;
  if (selection instanceof CellSelection) {
    // Selected cells delete the rows they span, or the table when they span all.
    if (deleteTableRows(state, dispatch)) return true;
    const depth = tableDepth(selection.$anchorCell)!;
    from = selection.$anchorCell.before(depth);
    to = selection.$anchorCell.after(depth);
  } else if (selection instanceof NodeSelection && selection.node.isBlock) {
    ({ from, to } = selection);
  } else if (!$from.parent.isTextblock || !$to.parent.isTextblock) {
    ({ from, to } = selection);
  } else {
    if ($from.parent.type.spec.code && $from.sameParent($to)) {
      const text = $from.parent.textContent;
      const lineStart = codeLineStart(text, $from.parentOffset);
      const lineBreak = codeLineBreak(text, $from.parentOffset, $to.parentOffset);
      // Every line selected: delete the block like any other below.
      if (lineBreak >= 0 || lineStart > 0) {
        const base = $from.start();
        const cut = lineBreak >= 0 ? [base + lineStart, base + lineBreak + 1] : [base + lineStart - 1, base + text.length];
        if (dispatch) {
          const tr = state.tr.delete(cut[0], cut[1]);
          // Collapse: the mapped selection can reach into the following block.
          tr.setSelection(TextSelection.create(tr.doc, cut[0]));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }
    }
    const fromTable = tableDepth($from);
    const toTable = tableDepth($to);
    const sameTable =
      fromTable !== null && toTable !== null && $from.before(fromTable) === $to.before(toTable);
    if (sameTable && deleteTableRows(state, dispatch)) return true;
    from = $from.before(lineDepth($from, fromTable));
    to = $to.after(lineDepth($to, toTable));

    if ($from.parent.type.spec.code) {
      const lineStart = codeLineStart($from.parent.textContent, $from.parentOffset);
      if (lineStart > 0) {
        headCut = [$from.start() + lineStart - 1, $from.end()];
        from = $from.after();
      }
    } else if (fromTable !== null && !sameTable && $from.index(fromTable) > 0) {
      headCut = [$from.before(fromTable + 1), $from.end(fromTable)];
      from = $from.after(fromTable);
    }
    if ($to.parent.type.spec.code) {
      const lineBreak = codeLineBreak($to.parent.textContent, 0, $to.parentOffset);
      if (lineBreak >= 0) {
        tailCut = [$to.start(), $to.start() + lineBreak + 1];
        to = $to.before();
      }
    } else if (toTable !== null && !sameTable && $to.index(toTable) < $to.node(toTable).childCount - 1) {
      tailCut = [$to.start(toTable), $to.after(toTable + 1)];
      tailPromotes = hasHeaderRow($to.node(toTable));
      to = $to.before(toTable);
    }
    // Deleting a list item's own line deletes the item, as a caret there does,
    // including code lines and rows inside it the selection does not reach.
    const tailDepth = toTable ?? $to.depth;
    for (let depth = 1; depth < tailDepth; depth += 1) {
      if (LIST_ITEM_TYPES.has($to.node(depth).type.name) && $to.before(depth) >= from) {
        to = Math.max(to, $to.after(depth));
        tailCut = null;
        break;
      }
    }
  }

  // Rules and images wholly inside a selection that ends at a block start go too.
  if (endsAtBlockStart) {
    let $end = doc.resolve(to);
    while ($end.nodeAfter?.isAtom && $end.nodeAfter.isBlock && to + $end.nodeAfter.nodeSize <= selectionEnd) {
      to += $end.nodeAfter.nodeSize;
      $end = doc.resolve(to);
    }
  }
  ({ from, to } = widenOverWrappers(doc, { from, to }, { from: headCut !== null, to: tailCut !== null }));

  if (from >= to && !headCut && !tailCut) return false;
  // Nothing visible to delete: the empty document, or the empty paragraph
  // TrailingNode keeps after a table or code block and would re-create.
  const last = doc.lastChild;
  const onlyEmptyTrailing =
    !headCut &&
    !tailCut &&
    to >= doc.content.size &&
    from === doc.content.size - (last?.nodeSize ?? 0) &&
    last?.type.name === 'paragraph' &&
    last.content.size === 0 &&
    (doc.childCount === 1 || doc.child(doc.childCount - 2).type.name !== 'paragraph');
  if (onlyEmptyTrailing) return true;
  if (!dispatch) return true;

  const tr = state.tr;
  const caretFrom = headCut ? headCut[0] : from;
  // Back to front, so earlier positions stay valid and containers never join.
  if (tailCut) {
    tr.delete(tailCut[0], tailCut[1]);
    if (tailPromotes) promoteFirstRow(tr, tailCut[0]);
  }
  if (from < to) {
    if (!headCut && !tailCut && from <= 0 && to >= doc.content.size) {
      tr.replaceWith(0, doc.content.size, state.schema.nodes.paragraph.create());
    } else {
      tr.deleteRange(tr.mapping.map(from), tr.mapping.map(to));
    }
  }
  if (headCut) tr.delete(tr.mapping.map(headCut[0]), tr.mapping.map(headCut[1]));
  // Prefer a text caret: a node selection on front matter or a rule would be
  // replaced by the next keystroke.
  const $at = tr.doc.resolve(Math.min(tr.mapping.map(caretFrom, -1), tr.doc.content.size));
  const caret = Selection.findFrom($at, 1, true) ?? Selection.findFrom($at, -1, true);
  if (caret) {
    tr.setSelection(caret);
  } else {
    tr.insert($at.pos, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, $at.pos + 1));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** ⌘⇧K deletes the current line (block), as in Zed and the Source editor. */
export const DeleteLineShortcut = Extension.create({
  name: 'deleteLineShortcut',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-k': () =>
        this.editor.isEditable && deleteSelectedLines(this.editor.state, this.editor.view.dispatch),
    };
  },
});
