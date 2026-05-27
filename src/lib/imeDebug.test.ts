/**
 * Verifies the IME diagnostics capture the cell text and in-cell flag, which
 * is the signal that makes the CJK-in-table reversal legible from a single
 * overlay screenshot. Uses a hand-built ResolvedPos-like stub (no ProseMirror
 * editor needed) since imeLog only reads `$from.parent.textContent` and walks
 * `$from.node(depth).type.spec.tableRole`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearImeLog, getImeLog, imeLog } from './imeDebug';

beforeEach(() => {
  // imeLog is gated on imeDebugEnabled(); the localStorage flag turns it on.
  localStorage.setItem('markdowner:imeDebug', '1');
  clearImeLog();
});

afterEach(() => {
  localStorage.removeItem('markdowner:imeDebug');
  clearImeLog();
});

function resolvedPosStub(text: string, roles: Record<number, string>, depth: number) {
  return {
    depth,
    parent: { textContent: text },
    node: (d: number) => ({ type: { spec: { tableRole: roles[d] } } }),
  };
}

describe('imeLog cell capture', () => {
  it('records the cell text and inCell=true when the caret is in a table cell', () => {
    const $from = resolvedPosStub('녕안', { 1: 'table', 2: 'row', 3: 'cell', 4: undefined as never }, 4);
    imeLog('compositionend', { state: { selection: { from: 5, to: 5, $from } } }, { data: '안' });

    const [entry] = getImeLog();
    const parsed = JSON.parse(entry.detail);
    expect(parsed.cellText).toBe('녕안');
    expect(parsed.inCell).toBe(true);
    expect(parsed.data).toBe('안');
  });

  it('reports inCell=false in an ordinary paragraph', () => {
    const $from = resolvedPosStub('hello', { 1: undefined as never }, 1);
    imeLog('compositionstart', { state: { selection: { from: 3, to: 3, $from } } });

    const parsed = JSON.parse(getImeLog()[0].detail);
    expect(parsed.cellText).toBe('hello');
    expect(parsed.inCell).toBe(false);
  });

  it('degrades gracefully when no resolved position is available', () => {
    imeLog('keydown', { state: { selection: { from: 1, to: 1 } } }, { key: 'a' });
    const parsed = JSON.parse(getImeLog()[0].detail);
    expect(parsed.from).toBe(1);
    expect(parsed.cellText).toBeUndefined();
  });
});
