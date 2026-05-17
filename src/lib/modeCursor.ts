import type { Editor as TiptapEditor } from '@tiptap/react';

export interface SourceCursorLocation {
  line: number;
  column: number;
}

// Returns the markdown source line + column corresponding to the current
// WYSIWYG selection. Serialises the document prefix up to the cursor through
// @tiptap/markdown and counts newlines for the line, and characters since the
// last newline for the column — accurate for paragraphs, headings, lists, code
// fences, and any other block @tiptap/markdown can round-trip.
//
// Falls back to {line: 1, column: 1} on serialiser failure so callers can treat
// the result as a best-effort hint rather than a hard contract.
export function wysiwygCursorSourceLocation(editor: TiptapEditor | null): SourceCursorLocation {
  if (!editor) return { line: 1, column: 1 };
  const selection = editor.state.selection;
  const from = selection.from;
  if (from <= 0) return { line: 1, column: 1 };
  try {
    const slice = editor.state.doc.cut(0, from);
    const serializer = getMarkdownSerializer(editor);
    if (!serializer) return { line: 1, column: 1 };
    const markdown = serializer.serialize(slice);
    let line = 1;
    let lastNewline = -1;
    for (let index = 0; index < markdown.length; index += 1) {
      if (markdown[index] === '\n') {
        line += 1;
        lastNewline = index;
      }
    }
    const column = markdown.length - (lastNewline + 1) + 1;
    return { line, column: Math.max(1, column) };
  } catch {
    return { line: 1, column: 1 };
  }
}

// Returns the ProseMirror position that corresponds to the given markdown
// source location (line + column) in the current WYSIWYG document. Falls back
// to the start of the block when the column is past the block's text length.
export function wysiwygPositionAtSourceLocation(
  editor: TiptapEditor | null,
  location: SourceCursorLocation,
): number | null {
  if (!editor) return null;
  const targetLine = Number.isFinite(location.line) && location.line >= 1 ? location.line : 1;
  const targetColumn =
    Number.isFinite(location.column) && location.column >= 1 ? location.column : 1;
  const serializer = getMarkdownSerializer(editor);
  if (!serializer) return null;

  const doc = editor.state.doc;
  let cumulativeLines = 1;
  let positionAfterPreviousBlocks = 0;
  let candidate: number | null = null;
  let candidateBlockNode: { nodeSize: number; textContent: string } | null = null;

  try {
    doc.forEach((node, offset) => {
      if (candidate !== null) return;
      const blockOpenPosition = offset + 1; // skip past the opening token
      if (cumulativeLines >= targetLine) {
        candidate = blockOpenPosition;
        candidateBlockNode = node;
        return;
      }
      const sliceEnd = offset + node.nodeSize;
      const slice = doc.cut(0, sliceEnd);
      const markdown = serializer.serialize(slice);
      let lines = 1;
      for (let index = 0; index < markdown.length; index += 1) {
        if (markdown[index] === '\n') lines += 1;
      }
      if (lines >= targetLine) {
        candidate = blockOpenPosition;
        candidateBlockNode = node;
        return;
      }
      cumulativeLines = lines;
      positionAfterPreviousBlocks = sliceEnd;
    });
  } catch {
    return null;
  }

  if (candidate === null) {
    return Math.max(0, positionAfterPreviousBlocks - 1);
  }

  if (targetColumn <= 1 || candidateBlockNode === null) return candidate;
  // Subtract the block's markdown prefix length (e.g. `## ` for an h2, `> `
  // for a blockquote) so a column that the wysiwyg→source side reported as
  // including the prefix maps back to an offset inside the block's text.
  // Only paragraphs and headings are handled here — list items / quotes
  // nest sub-blocks and can't be advanced safely with a flat character
  // count, so we leave the caret at the block's start in those cases.
  const node = candidateBlockNode as {
    type?: { name?: string };
    attrs?: { level?: number };
    textContent: string;
  };
  const typeName = node.type?.name;
  let prefixLength = 0;
  if (typeName === 'heading') {
    const level = Math.max(1, Math.min(6, node.attrs?.level ?? 1));
    prefixLength = level + 1; // e.g. "## "
  } else if (typeName !== 'paragraph') {
    // Unknown / structural block — don't risk landing inside a child node.
    return candidate;
  }
  const maxAdvance = Math.max(0, node.textContent.length);
  const advance = Math.min(Math.max(0, targetColumn - 1 - prefixLength), maxAdvance);
  return candidate + advance;
}

// Backwards-compatible helpers retained for callers that only need a line.
export function wysiwygCursorSourceLine(editor: TiptapEditor | null): number {
  return wysiwygCursorSourceLocation(editor).line;
}

export function wysiwygPositionAtSourceLine(
  editor: TiptapEditor | null,
  targetLine: number,
): number | null {
  return wysiwygPositionAtSourceLocation(editor, { line: targetLine, column: 1 });
}

type Serializer = {
  serialize: (doc: unknown) => string;
};

function getMarkdownSerializer(editor: TiptapEditor): Serializer | null {
  const storage = editor.storage as unknown as
    | Record<string, unknown>
    | undefined;
  const markdown = storage?.markdown as { serializer?: Serializer } | undefined;
  return markdown?.serializer ?? null;
}
