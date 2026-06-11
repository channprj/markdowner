import {
  findTextMatches,
  replacementTextForMatch,
  type FindMatch,
  type FindReplaceOptions,
  type FindTextResult,
} from './findReplace';

export type WysiwygFindMatch = FindMatch & {
  wysiwygFrom: number;
  wysiwygTo: number;
};

type TextSegment = {
  textStart: number;
  textEnd: number;
  docStart: number;
};

type ProseMirrorTextNode = {
  isText?: boolean;
  text?: string;
};

type ProseMirrorDoc = {
  descendants?: (
    callback: (node: ProseMirrorTextNode, position: number) => void,
  ) => void;
};

type ProseMirrorTransaction = {
  insertText?: (text: string, from: number, to: number) => ProseMirrorTransaction;
  scrollIntoView?: () => ProseMirrorTransaction;
};

type WysiwygEditorLike = {
  state?: {
    doc?: ProseMirrorDoc;
    tr?: ProseMirrorTransaction;
  };
  view?: {
    dispatch?: (transaction: any) => void;
    focus?: () => void;
    dom?: Element;
    coordsAtPos?: (pos: number) => { top: number; bottom: number };
  };
  commands?: {
    setTextSelection?: (selection: { from: number; to: number }) => boolean;
    scrollIntoView?: () => boolean;
  };
};

function collectTextIndex(editor: WysiwygEditorLike) {
  const doc = editor.state?.doc;
  const segments: TextSegment[] = [];
  let text = '';

  doc?.descendants?.((node, position) => {
    if (!node.isText || typeof node.text !== 'string' || node.text.length === 0) {
      return;
    }

    const textStart = text.length;
    text += node.text;
    segments.push({
      textStart,
      textEnd: text.length,
      docStart: position,
    });
  });

  return { text, segments };
}

function mapTextOffsetToDocPosition(
  segments: TextSegment[],
  offset: number,
  bias: 'start' | 'end',
) {
  for (const segment of segments) {
    if (offset < segment.textStart || offset > segment.textEnd) {
      continue;
    }

    if (offset === segment.textEnd && bias === 'start') {
      continue;
    }

    return segment.docStart + offset - segment.textStart;
  }

  return null;
}

export function isWysiwygFindMatch(
  match: FindMatch | undefined,
): match is WysiwygFindMatch {
  return (
    typeof (match as WysiwygFindMatch | undefined)?.wysiwygFrom === 'number' &&
    typeof (match as WysiwygFindMatch | undefined)?.wysiwygTo === 'number'
  );
}

export function findWysiwygTextMatches(
  editor: WysiwygEditorLike | null | undefined,
  query: string,
  options: FindReplaceOptions,
): FindTextResult {
  if (!editor) {
    return { matches: [], error: null };
  }

  const { text, segments } = collectTextIndex(editor);
  const result = findTextMatches(text, query, options);
  if (result.error || result.matches.length === 0) {
    return result;
  }

  return {
    ...result,
    matches: result.matches.flatMap((match) => {
      const wysiwygFrom = mapTextOffsetToDocPosition(segments, match.start, 'start');
      const wysiwygTo = mapTextOffsetToDocPosition(segments, match.end, 'end');
      if (wysiwygFrom === null || wysiwygTo === null || wysiwygFrom > wysiwygTo) {
        return [];
      }
      return [{ ...match, wysiwygFrom, wysiwygTo }];
    }),
  };
}

/**
 * VS Code/Zed reveal math in viewport coordinates: returns the scrollTop
 * that centers the match, or null when the match is already visible and no
 * scroll is needed.
 */
export function centeredScrollTop(input: {
  /** Viewport-space top of the match (ProseMirror coordsAtPos().top). */
  matchTop: number;
  containerTop: number;
  containerHeight: number;
  scrollTop: number;
}): number | null {
  const offsetInView = input.matchTop - input.containerTop;
  if (offsetInView >= 0 && offsetInView <= input.containerHeight) {
    return null;
  }
  return Math.max(
    0,
    input.scrollTop + offsetInView - input.containerHeight / 2,
  );
}

function nearestScrollContainer(start: Element | null | undefined): Element | null {
  let element = start?.parentElement ?? null;
  while (element) {
    if (element.scrollHeight > element.clientHeight + 1) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

/**
 * Reveals the match like VS Code/Zed: center it when offscreen, stay put
 * when visible. Falls back to the editor's nearest-edge scrollIntoView when
 * geometry is unavailable (jsdom, detached views).
 */
function scrollWysiwygMatchIntoView(
  editor: WysiwygEditorLike,
  position: number,
) {
  let coords: { top: number } | null = null;
  try {
    coords = editor.view?.coordsAtPos?.(position) ?? null;
  } catch {
    coords = null;
  }
  const container = nearestScrollContainer(editor.view?.dom);
  if (!coords || !container) {
    editor.commands?.scrollIntoView?.();
    return;
  }
  const rect = container.getBoundingClientRect();
  const next = centeredScrollTop({
    matchTop: coords.top,
    containerTop: rect.top,
    containerHeight: container.clientHeight,
    scrollTop: container.scrollTop,
  });
  if (next !== null) {
    container.scrollTop = next;
  }
}

export function selectWysiwygFindMatch(
  editor: WysiwygEditorLike | null | undefined,
  match: WysiwygFindMatch,
  options: { focusEditor?: boolean } = {},
) {
  const didSelect = editor?.commands?.setTextSelection?.({
    from: match.wysiwygFrom,
    to: match.wysiwygTo,
  });
  if (didSelect === false || !editor) {
    return;
  }
  scrollWysiwygMatchIntoView(editor, match.wysiwygFrom);
  if (options.focusEditor !== false) {
    editor.view?.focus?.();
  }
}

export function replaceWysiwygTextMatch(
  editor: WysiwygEditorLike | null | undefined,
  match: WysiwygFindMatch,
  replacement: string,
) {
  return replaceWysiwygTextMatches(editor, [match], replacement);
}

export function replaceWysiwygTextMatches(
  editor: WysiwygEditorLike | null | undefined,
  matches: WysiwygFindMatch[],
  replacement: string,
) {
  const transaction = editor?.state?.tr;
  if (!editor?.view?.dispatch || !transaction?.insertText || matches.length === 0) {
    return false;
  }

  const sortedMatches = [...matches].sort((left, right) => right.wysiwygFrom - left.wysiwygFrom);
  for (const match of sortedMatches) {
    transaction.insertText(
      replacementTextForMatch(match, replacement),
      match.wysiwygFrom,
      match.wysiwygTo,
    );
  }

  editor.view.dispatch(transaction.scrollIntoView?.() ?? transaction);
  const firstMatch = matches[0];
  if (firstMatch) {
    const selectedText = replacementTextForMatch(firstMatch, replacement);
    editor.commands?.setTextSelection?.({
      from: firstMatch.wysiwygFrom,
      to: firstMatch.wysiwygFrom + selectedText.length,
    });
  }
  editor.view.focus?.();
  return true;
}
