export function buildSourceLineStartOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

export function lineTextFromOffset(source: string, offset: number): string {
  const lineEnd = source.indexOf('\n', offset);
  const text = source.slice(offset, lineEnd === -1 ? source.length : lineEnd);
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

export function sourceOffsetForLine(
  lineNumber: number,
  lineStartOffsets: readonly number[],
  sourceLength: number,
): number {
  if (!Number.isFinite(lineNumber) || lineNumber < 1) {
    return 0;
  }
  return lineStartOffsets[lineNumber - 1] ?? sourceLength;
}

export function clampSourceOffset(offset: number, sourceLength: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(sourceLength, Math.round(offset)));
}

// Collapse any trailing newline run into exactly one `\n`. VS Code's
// `files.insertFinalNewline` + `files.trimFinalNewlines` combined: empty
// input still emits a single newline, multi-newline tails get squeezed,
// and text that already ends with exactly one `\n` round-trips unchanged.
export function normalizeFinalNewline(text: string): string {
  return text.replace(/\n*$/, '\n');
}

export function countLiteralOccurrencesBefore(
  source: string,
  needle: string,
  endOffset: number,
): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0 && index < endOffset) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }

  return count;
}
