import { describe, expect, it } from 'vitest';

import {
  buildSourceLineStartOffsets,
  clampSourceOffset,
  countLiteralOccurrencesBefore,
  lineTextFromOffset,
  normalizeFinalNewline,
  sourceOffsetForLine,
} from './sourceText';

describe('buildSourceLineStartOffsets', () => {
  it('records the zero-based start offset for each source line', () => {
    expect(buildSourceLineStartOffsets('alpha\nbeta\n')).toEqual([0, 6, 11]);
  });
});

describe('sourceOffsetForLine', () => {
  it('returns zero for invalid line numbers and clamps past-end lines to the source length', () => {
    const source = 'alpha\nbeta';
    const offsets = buildSourceLineStartOffsets(source);

    expect(sourceOffsetForLine(0, offsets, source.length)).toBe(0);
    expect(sourceOffsetForLine(Number.NaN, offsets, source.length)).toBe(0);
    expect(sourceOffsetForLine(2, offsets, source.length)).toBe(6);
    expect(sourceOffsetForLine(99, offsets, source.length)).toBe(source.length);
  });
});

describe('clampSourceOffset', () => {
  it('rounds finite offsets and clamps them to the source bounds', () => {
    expect(clampSourceOffset(-1, 10)).toBe(0);
    expect(clampSourceOffset(4.6, 10)).toBe(5);
    expect(clampSourceOffset(99, 10)).toBe(10);
    expect(clampSourceOffset(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });
});

describe('normalizeFinalNewline', () => {
  it('collapses every trailing newline run to exactly one newline', () => {
    expect(normalizeFinalNewline('')).toBe('\n');
    expect(normalizeFinalNewline('alpha')).toBe('alpha\n');
    expect(normalizeFinalNewline('alpha\n')).toBe('alpha\n');
    expect(normalizeFinalNewline('alpha\n\n\n')).toBe('alpha\n');
  });
});

describe('countLiteralOccurrencesBefore', () => {
  it('counts non-overlapping literal occurrences before the end offset', () => {
    expect(countLiteralOccurrencesBefore('alpha beta alpha alpha', 'alpha', 11)).toBe(1);
    expect(countLiteralOccurrencesBefore('alpha beta alpha alpha', 'alpha', 17)).toBe(2);
    expect(countLiteralOccurrencesBefore('aaaa', 'aa', 4)).toBe(2);
  });

  it('returns zero for empty needles', () => {
    expect(countLiteralOccurrencesBefore('alpha', '', 5)).toBe(0);
  });
});

describe('lineTextFromOffset', () => {
  it('returns the text from an offset through the next newline', () => {
    expect(lineTextFromOffset('alpha\nbeta\ngamma', 6)).toBe('beta');
  });

  it('strips a trailing carriage return from CRLF lines', () => {
    expect(lineTextFromOffset('alpha\r\nbeta', 0)).toBe('alpha');
  });
});
