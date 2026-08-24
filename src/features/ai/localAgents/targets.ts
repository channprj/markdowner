import type { AiByteRange } from '../types';
import type { AiSelectionSnapshot } from '../selection';

import type {
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentTargetKind,
} from './types';

export interface LocalAgentTargetSnapshot {
  documentId: string;
  source: string;
  surface: 'source' | 'wysiwyg';
  kind: LocalAgentTargetKind;
  characterRange: AiByteRange | null;
  byteRange: AiByteRange | null;
  selectedText: string;
  proseMirrorRange: AiByteRange | null;
  requiresReview?: boolean;
}

export type WysiwygLocalAgentApplyOutcome =
  | { status: 'applied'; markdown: string }
  | { status: 'not-applied' }
  | { status: 'failed' };

interface WysiwygApplicationState {
  doc: { content: { size: number } };
  selection: { from: number; to: number };
}

interface WysiwygApplicationEditor<State extends WysiwygApplicationState> {
  chain: () => {
    focus: () => {
      insertContentAt: (
        range: { from: number; to: number },
        content: string,
        options: { contentType: 'markdown' },
      ) => { run: () => boolean };
    };
  };
  state: State;
  view?: { updateState: (state: State) => void };
  getMarkdown?: () => string;
}

export function isValidLocalAgentTargetSnapshot(
  snapshot: LocalAgentTargetSnapshot,
): boolean {
  if (!snapshot.documentId.trim()) return false;
  if (snapshot.kind === 'document') {
    return (
      snapshot.characterRange === null &&
      snapshot.byteRange === null &&
      snapshot.selectedText === '' &&
      snapshot.proseMirrorRange === null
    );
  }

  const characterRange = snapshot.characterRange;
  const byteRange = snapshot.byteRange;
  if (
    !characterRange ||
    !byteRange ||
    !isRangeWithin(characterRange, snapshot.source.length) ||
    splitsSurrogatePair(snapshot.source, characterRange.start) ||
    splitsSurrogatePair(snapshot.source, characterRange.end) ||
    !sameRange(byteRange, {
      start: utf8Length(snapshot.source.slice(0, characterRange.start)),
      end: utf8Length(snapshot.source.slice(0, characterRange.end)),
    }) ||
    snapshot.selectedText !==
      snapshot.source.slice(characterRange.start, characterRange.end)
  ) {
    return false;
  }

  const collapsed = characterRange.start === characterRange.end;
  if (snapshot.kind === 'insert' ? !collapsed : collapsed) return false;
  if (snapshot.surface === 'source') return snapshot.proseMirrorRange === null;
  return (
    snapshot.proseMirrorRange !== null &&
    isProseMirrorRangeOrdered(snapshot.proseMirrorRange) &&
    (snapshot.proseMirrorRange.start === snapshot.proseMirrorRange.end) ===
      collapsed
  );
}

export function captureSourceLocalAgentTarget(input: {
  source: string;
  anchor: number;
  head: number;
  documentId: string;
}): LocalAgentTargetSnapshot | null {
  return captureLocalAgentTarget({
    source: input.source,
    start: Math.min(input.anchor, input.head),
    end: Math.max(input.anchor, input.head),
    documentId: input.documentId,
    surface: 'source',
    proseMirrorRange: null,
  });
}

export function captureWysiwygLocalAgentTarget(input: {
  source: string;
  markdownAnchor?: number;
  markdownHead?: number;
  markdownStart?: number;
  markdownEnd?: number;
  proseMirrorFrom: number;
  proseMirrorTo: number;
  proseMirrorDocumentSize: number;
  documentId: string;
  requiresReview?: boolean;
}): LocalAgentTargetSnapshot | null {
  const anchor = input.markdownAnchor ?? input.markdownStart;
  const head = input.markdownHead ?? input.markdownEnd;
  if (anchor === undefined || head === undefined) return null;

  const proseMirrorRange = {
    start: input.proseMirrorFrom,
    end: input.proseMirrorTo,
  };
  if (
    !isProseMirrorRangeWithinDocument(
      proseMirrorRange,
      input.proseMirrorDocumentSize,
    )
  ) {
    return null;
  }

  return captureLocalAgentTarget({
    source: input.source,
    start: Math.min(anchor, head),
    end: Math.max(anchor, head),
    documentId: input.documentId,
    surface: 'wysiwyg',
    proseMirrorRange,
    requiresReview: input.requiresReview,
  });
}

export function asDocumentLocalAgentTarget(
  snapshot: LocalAgentTargetSnapshot,
): LocalAgentTargetSnapshot {
  return {
    ...snapshot,
    kind: 'document',
    characterRange: null,
    byteRange: null,
    selectedText: '',
    proseMirrorRange: null,
  };
}

export function localAgentTargetFromAiSelectionSnapshot(
  snapshot: AiSelectionSnapshot,
): LocalAgentTargetSnapshot {
  return {
    documentId: snapshot.documentId,
    source: snapshot.source,
    surface: snapshot.surface,
    kind: 'selection',
    characterRange: { ...snapshot.characterRange },
    byteRange: { ...snapshot.byteRange },
    selectedText: snapshot.selectedText,
    proseMirrorRange: snapshot.proseMirrorRange
      ? { ...snapshot.proseMirrorRange }
      : null,
    ...(snapshot.requiresReview ? { requiresReview: true } : {}),
  };
}

export function applySourceLocalAgentResult(input: {
  view: {
    state: {
      selection: { main: { anchor: number; head: number } };
    };
    dispatch: (transaction: {
      changes: { from: number; to: number; insert: string };
      selection: { anchor: number };
      scrollIntoView: boolean;
    }) => void;
  };
  snapshot: LocalAgentTargetSnapshot;
  currentDocumentId: string;
  currentSource: string;
  request: LocalAgentRunRequest;
  result: LocalAgentRunResult;
}): string | null {
  const range = validApplicationRange(input);
  if (
    input.snapshot.surface !== 'source' ||
    !range ||
    !sameLiveSourceSelection(input.view.state.selection.main, range)
  ) {
    return null;
  }

  const nextSource =
    input.currentSource.slice(0, range.start) +
    input.result.markdown +
    input.currentSource.slice(range.end);
  input.view.dispatch({
    changes: { from: range.start, to: range.end, insert: input.result.markdown },
    selection: { anchor: range.start + input.result.markdown.length },
    scrollIntoView: true,
  });
  return nextSource;
}

export function applyWysiwygLocalAgentResult<
  State extends WysiwygApplicationState,
>(input: {
  editor: WysiwygApplicationEditor<State>;
  snapshot: LocalAgentTargetSnapshot;
  currentDocumentId: string;
  currentSource: string;
  request: LocalAgentRunRequest;
  result: LocalAgentRunResult;
}): WysiwygLocalAgentApplyOutcome {
  const range = validApplicationRange(input);
  const proseMirrorRange = input.snapshot.proseMirrorRange;
  if (input.snapshot.surface !== 'wysiwyg' || !range || !proseMirrorRange) {
    return { status: 'not-applied' };
  }
  const documentSize = input.editor.state?.doc?.content?.size;
  if (
    !sameLiveWysiwygSelection(
      input.editor.state?.selection ?? null,
      proseMirrorRange,
    ) ||
    !isProseMirrorRangeWithinDocument(
      proseMirrorRange,
      documentSize,
    )
  ) {
    return { status: 'not-applied' };
  }

  const previousState = input.editor.state;
  try {
    const applied = input.editor
      .chain()
      .focus()
      .insertContentAt(
        { from: proseMirrorRange.start, to: proseMirrorRange.end },
        input.result.markdown,
        { contentType: 'markdown' },
      )
      .run();
    if (applied === false) {
      restoreWysiwygEditorState(input.editor, previousState);
      return { status: 'not-applied' };
    }
    if (typeof input.editor.getMarkdown !== 'function') {
      restoreWysiwygEditorState(input.editor, previousState);
      return { status: 'failed' };
    }
    return { status: 'applied', markdown: input.editor.getMarkdown() };
  } catch {
    restoreWysiwygEditorState(input.editor, previousState);
    return { status: 'failed' };
  }
}

function captureLocalAgentTarget(input: {
  source: string;
  start: number;
  end: number;
  documentId: string;
  surface: 'source' | 'wysiwyg';
  proseMirrorRange: AiByteRange | null;
  requiresReview?: boolean;
}): LocalAgentTargetSnapshot | null {
  const start = clampCharacterOffset(input.source, input.start);
  const end = clampCharacterOffset(input.source, input.end);
  if (
    !input.documentId.trim() ||
    splitsSurrogatePair(input.source, start) ||
    splitsSurrogatePair(input.source, end)
  ) {
    return null;
  }

  const selectedText = input.source.slice(start, end);
  const snapshot: LocalAgentTargetSnapshot = {
    documentId: input.documentId,
    source: input.source,
    surface: input.surface,
    kind: start === end ? 'insert' : 'selection',
    characterRange: { start, end },
    byteRange: {
      start: utf8Length(input.source.slice(0, start)),
      end: utf8Length(input.source.slice(0, end)),
    },
    selectedText,
    proseMirrorRange: input.proseMirrorRange,
  };
  const resolvedSnapshot = input.requiresReview
    ? { ...snapshot, requiresReview: true }
    : snapshot;
  return isValidLocalAgentTargetSnapshot(resolvedSnapshot)
    ? resolvedSnapshot
    : null;
}

function validApplicationRange(input: {
  snapshot: LocalAgentTargetSnapshot;
  currentDocumentId: string;
  currentSource: string;
  request: LocalAgentRunRequest;
  result: LocalAgentRunResult;
}): AiByteRange | null {
  const { snapshot, request, result } = input;
  const characterRange = snapshot.characterRange;
  const byteRange = snapshot.byteRange;
  if (
    !isValidLocalAgentTargetSnapshot(snapshot) ||
    snapshot.requiresReview === true ||
    snapshot.kind === 'document' ||
    !characterRange ||
    !byteRange ||
    input.currentDocumentId !== snapshot.documentId ||
    input.currentSource !== snapshot.source ||
    input.currentSource.slice(characterRange.start, characterRange.end) !==
      snapshot.selectedText ||
    request.documentId !== snapshot.documentId ||
    request.source !== snapshot.source ||
    request.target !== snapshot.kind ||
    result.schemaVersion !== 1 ||
    result.requestId !== request.requestId ||
    result.documentId !== request.documentId ||
    result.agent !== request.agent ||
    result.target !== request.target
  ) {
    return null;
  }

  if (snapshot.kind === 'selection') {
    if (!sameRange(request.selection, byteRange) || request.cursor !== null) {
      return null;
    }
  } else if (request.selection !== null || request.cursor !== byteRange.start) {
    return null;
  }

  return characterRange;
}

function sameRange(left: AiByteRange | null, right: AiByteRange): boolean {
  return left?.start === right.start && left.end === right.end;
}

function sameLiveSourceSelection(
  selection: { anchor: number; head: number } | null | undefined,
  range: AiByteRange,
): boolean {
  if (!selection) return false;
  return (
    Math.min(selection.anchor, selection.head) === range.start &&
    Math.max(selection.anchor, selection.head) === range.end
  );
}

function sameLiveWysiwygSelection(
  selection: { from: number; to: number } | null | undefined,
  range: AiByteRange,
): boolean {
  return selection?.from === range.start && selection.to === range.end;
}

function restoreWysiwygEditorState<State extends WysiwygApplicationState>(
  editor: WysiwygApplicationEditor<State>,
  previousState: State,
): void {
  if (editor.state === previousState || !editor.view) return;
  try {
    editor.view.updateState(previousState);
  } catch {
    // A failed state restore must still fail closed to Review.
  }
}

function isRangeWithin(range: AiByteRange, maximum: number): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= maximum
  );
}

function isProseMirrorRangeOrdered(
  range: AiByteRange,
): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start
  );
}

function isProseMirrorRangeWithinDocument(
  range: AiByteRange,
  documentSize: unknown,
): boolean {
  return (
    typeof documentSize === 'number' &&
    Number.isInteger(documentSize) &&
    documentSize >= 0 &&
    isProseMirrorRangeOrdered(range) &&
    range.end <= documentSize
  );
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
