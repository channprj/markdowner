import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';

import type { AiByteRange, AiRunResult } from './types';

export type AiSelectionSurface = 'source' | 'wysiwyg';

export interface AiSelectionSnapshot {
  documentId: string;
  source: string;
  surface: AiSelectionSurface;
  characterRange: AiByteRange;
  byteRange: AiByteRange;
  selectedText: string;
  proseMirrorRange: AiByteRange | null;
  requiresReview?: boolean;
}

export function captureSourceSelection(
  source: string,
  anchor: number,
  head: number,
  documentId: string,
): AiSelectionSnapshot | null {
  return captureSelection({
    source,
    start: Math.min(anchor, head),
    end: Math.max(anchor, head),
    documentId,
    surface: 'source',
    proseMirrorRange: null,
  });
}

export function captureWysiwygSelection(input: {
  source: string;
  markdownStart: number;
  markdownEnd: number;
  proseMirrorFrom: number;
  proseMirrorTo: number;
  documentId: string;
  requiresReview?: boolean;
}): AiSelectionSnapshot | null {
  return captureSelection({
    source: input.source,
    start: Math.min(input.markdownStart, input.markdownEnd),
    end: Math.max(input.markdownStart, input.markdownEnd),
    documentId: input.documentId,
    surface: 'wysiwyg',
    proseMirrorRange: {
      start: Math.min(input.proseMirrorFrom, input.proseMirrorTo),
      end: Math.max(input.proseMirrorFrom, input.proseMirrorTo),
    },
    requiresReview: input.requiresReview,
  });
}

export function canReplaceSourceSelection(
  snapshot: AiSelectionSnapshot,
  currentSource: string,
): boolean {
  if (currentSource !== snapshot.source) return false;
  return (
    currentSource.slice(
      snapshot.characterRange.start,
      snapshot.characterRange.end,
    ) === snapshot.selectedText
  );
}

export function selectionReplacementFromResult(
  snapshot: AiSelectionSnapshot,
  runResult: AiRunResult,
): string | null {
  const document = runResult.result;
  if (
    runResult.documentId !== snapshot.documentId ||
    runResult.task !== 'custom' ||
    !document?.validation.passed ||
    runResult.validationIssues.length > 0 ||
    document.operations.length !== 1
  ) {
    return null;
  }

  const operation = document.operations[0];
  if (
    operation.kind !== 'replace' ||
    operation.sourceRange.start !== snapshot.byteRange.start ||
    operation.sourceRange.end !== snapshot.byteRange.end ||
    operation.originalMarkdown !== snapshot.selectedText
  ) {
    return null;
  }

  const reconstructed =
    snapshot.source.slice(0, snapshot.characterRange.start) +
    operation.proposedMarkdown +
    snapshot.source.slice(snapshot.characterRange.end);
  return document.proposedMarkdown === reconstructed
    ? operation.proposedMarkdown
    : null;
}

export function canApplySelectionResult(
  snapshot: AiSelectionSnapshot,
  currentDocumentId: string,
  currentSource: string,
  runResult: AiRunResult,
): boolean {
  return (
    snapshot.requiresReview !== true &&
    currentDocumentId === snapshot.documentId &&
    canReplaceSourceSelection(snapshot, currentSource) &&
    selectionReplacementFromResult(snapshot, runResult) !== null
  );
}

export function applySourceSelectionReplacement(input: {
  view: {
    dispatch: (transaction: {
      changes: { from: number; to: number; insert: string };
      selection: { anchor: number };
      scrollIntoView: boolean;
    }) => void;
  };
  snapshot: AiSelectionSnapshot;
  currentSource: string;
  replacement: string;
}): string | null {
  if (
    input.snapshot.surface !== 'source' ||
    !canReplaceSourceSelection(input.snapshot, input.currentSource)
  ) {
    return null;
  }

  const nextSource =
    input.currentSource.slice(0, input.snapshot.characterRange.start) +
    input.replacement +
    input.currentSource.slice(input.snapshot.characterRange.end);
  input.view.dispatch({
    changes: {
      from: input.snapshot.characterRange.start,
      to: input.snapshot.characterRange.end,
      insert: input.replacement,
    },
    selection: {
      anchor:
        input.snapshot.characterRange.start + input.replacement.length,
    },
    scrollIntoView: true,
  });
  return nextSource;
}

export function applyWysiwygSelectionReplacement(input: {
  editor: Pick<Editor, 'state' | 'view' | 'storage' | 'getMarkdown'>;
  snapshot: AiSelectionSnapshot;
  currentSource: string;
  replacement: string;
}): boolean {
  const range = input.snapshot.proseMirrorRange;
  if (
    input.snapshot.surface !== 'wysiwyg' ||
    !range ||
    !canReplaceSourceSelection(input.snapshot, input.currentSource)
  ) {
    return false;
  }

  const previousState = input.editor.state;
  const manager = input.editor.storage.markdown?.manager;
  if (!manager || input.editor.getMarkdown() !== input.currentSource) return false;
  const nextSource =
    input.currentSource.slice(0, input.snapshot.characterRange.start) +
    input.replacement +
    input.currentSource.slice(input.snapshot.characterRange.end);
  try {
    // Plain inline edits can retain the exact surrounding marks and block
    // nodes. Verify serialization before dispatching; Markdown syntax in the
    // replacement will instead take the contextual parse path below.
    const inline = previousState.tr.insertText(input.replacement, range.start, range.end);
    if (manager.serialize(inline.doc.toJSON()) === nextSource) {
      input.editor.view.dispatch(closeHistory(inline).scrollIntoView());
      return true;
    }
    // Parse in the full document's context: parsing an isolated replacement
    // creates a closed paragraph and loses surrounding marks/list structure.
    const nextDoc = previousState.schema.nodeFromJSON(manager.parse(nextSource));
    if (manager.serialize(nextDoc.toJSON()) !== nextSource) return false;
    const start = previousState.doc.content.findDiffStart(nextDoc.content);
    if (start === null) return true;
    const end = previousState.doc.content.findDiffEnd(nextDoc.content)!;
    const overlap = start - Math.min(end.a, end.b);
    if (overlap > 0) { end.a += overlap; end.b += overlap; }
    const transaction = closeHistory(previousState.tr.replace(start, end.a, nextDoc.slice(start, end.b)));
    if (!transaction.doc.eq(nextDoc)) return false;
    input.editor.view.dispatch(transaction.scrollIntoView());
    return true;
  } catch {
    // Parsing/transaction failures must leave the original document and undo
    // history intact so the caller can offer the validated result in Review.
    if (input.editor.state !== previousState) input.editor.view.updateState(previousState);
    return false;
  }
}

function captureSelection(input: {
  source: string;
  start: number;
  end: number;
  documentId: string;
  surface: AiSelectionSurface;
  proseMirrorRange: AiByteRange | null;
  requiresReview?: boolean;
}): AiSelectionSnapshot | null {
  const start = clampCharacterOffset(input.source, input.start);
  const end = clampCharacterOffset(input.source, input.end);
  if (
    !input.documentId.trim() ||
    end <= start ||
    splitsSurrogatePair(input.source, start) ||
    splitsSurrogatePair(input.source, end)
  ) {
    return null;
  }

  const selectedText = input.source.slice(start, end);
  if (selectedText.length === 0) return null;

  const snapshot: AiSelectionSnapshot = {
    documentId: input.documentId,
    source: input.source,
    surface: input.surface,
    characterRange: { start, end },
    byteRange: {
      start: utf8Length(input.source.slice(0, start)),
      end: utf8Length(input.source.slice(0, end)),
    },
    selectedText,
    proseMirrorRange: input.proseMirrorRange,
  };
  return input.requiresReview ? { ...snapshot, requiresReview: true } : snapshot;
}

function clampCharacterOffset(source: string, value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(source.length, Math.round(value)));
}

function splitsSurrogatePair(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return false;
  const previous = source.charCodeAt(offset - 1);
  const next = source.charCodeAt(offset);
  return (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}
