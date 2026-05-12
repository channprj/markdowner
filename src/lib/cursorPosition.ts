export type CursorPosition = {
  line: number;
  column: number;
};

export type SourceEditorStatistics = {
  line: {
    number: number;
    from: number;
  };
  selectionAsSingle: {
    head: number;
  };
};

export function nextCursorPositionFromStatistics(
  current: CursorPosition,
  stats: SourceEditorStatistics,
): CursorPosition {
  const next = {
    line: stats.line.number,
    column: stats.selectionAsSingle.head - stats.line.from + 1,
  };

  if (current.line === next.line && current.column === next.column) {
    return current;
  }

  return next;
}
