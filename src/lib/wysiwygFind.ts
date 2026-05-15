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
  };
  commands?: {
    setTextSelection?: (selection: { from: number; to: number }) => boolean;
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

export function selectWysiwygFindMatch(
  editor: WysiwygEditorLike | null | undefined,
  match: WysiwygFindMatch,
  options: { focusEditor?: boolean } = {},
) {
  const didSelect = editor?.commands?.setTextSelection?.({
    from: match.wysiwygFrom,
    to: match.wysiwygTo,
  });
  if (didSelect !== false && options.focusEditor !== false) {
    editor?.view?.focus?.();
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
