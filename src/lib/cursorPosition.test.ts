import { describe, expect, it } from 'vitest';

import { nextCursorPositionFromStatistics } from './cursorPosition';

describe('nextCursorPositionFromStatistics', () => {
  it('reuses the current cursor position when CodeMirror reports the same line and column', () => {
    const current = { line: 3, column: 7 };
    const next = nextCursorPositionFromStatistics(current, {
      line: { number: 3, from: 10 },
      selectionAsSingle: { head: 16 },
    });

    expect(next).toBe(current);
  });

  it('returns the next cursor position when CodeMirror reports a changed line or column', () => {
    const current = { line: 3, column: 7 };
    const next = nextCursorPositionFromStatistics(current, {
      line: { number: 4, from: 20 },
      selectionAsSingle: { head: 24 },
    });

    expect(next).toEqual({ line: 4, column: 5 });
    expect(next).not.toBe(current);
  });
});
