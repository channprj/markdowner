import { describe, expect, it } from 'vitest';

import { moveTab, reorderTabByDrag } from './tabs';

describe('moveTab', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moves the active tab one slot to the right', () => {
    expect(moveTab(tabs, 'a', 1).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(moveTab(tabs, 'b', 1).map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves the active tab one slot to the left', () => {
    expect(moveTab(tabs, 'b', -1).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(moveTab(tabs, 'c', -1).map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not wrap when the active tab is already at the right edge', () => {
    expect(moveTab(tabs, 'c', 1).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not wrap when the active tab is already at the left edge', () => {
    expect(moveTab(tabs, 'a', -1).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns a fresh copy when the activeId is not found', () => {
    const result = moveTab(tabs, 'missing', 1);
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(tabs);
  });

  it('handles single-tab lists by returning a copy', () => {
    const single = [{ id: 'only' }];
    expect(moveTab(single, 'only', 1)).toEqual(single);
    expect(moveTab(single, 'only', -1)).toEqual(single);
  });
});

describe('reorderTabByDrag', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('drops a tab before the target', () => {
    expect(reorderTabByDrag(tabs, 'd', 'b', false).map((t) => t.id)).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
  });

  it('drops a tab after the target', () => {
    expect(reorderTabByDrag(tabs, 'a', 'c', true).map((t) => t.id)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });

  it('moves a tab leftwards across the strip', () => {
    expect(reorderTabByDrag(tabs, 'c', 'a', false).map((t) => t.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('returns a fresh copy when dropping a tab onto itself', () => {
    const result = reorderTabByDrag(tabs, 'b', 'b', true);
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result).not.toBe(tabs);
  });

  it('returns a fresh copy when either id is unknown', () => {
    expect(reorderTabByDrag(tabs, 'missing', 'b', false).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(reorderTabByDrag(tabs, 'b', 'missing', false).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});
