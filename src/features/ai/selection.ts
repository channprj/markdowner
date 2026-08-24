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
  editor: {
    chain: () => {
      focus: () => {
        insertContentAt: (
          range: { from: number; to: number },
          content: string,
          options: { contentType: 'markdown' },
        ) => { run: () => boolean };
      };
    };
  };
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

  return (
    input.editor
      .chain()
      .focus()
      .insertContentAt(
        { from: range.start, to: range.end },
        input.replacement,
        { contentType: 'markdown' },
      )
      .run() !== false
  );
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
