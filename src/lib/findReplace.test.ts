import { describe, expect, it } from 'vitest';

import {
  findTextMatches,
  nextFindMatchIndex,
  nextFindMatchIndexAfterReplace,
  replaceAllMatches,
  replaceSingleMatch,
  resolveFindMatchSelection,
  type FindReplaceOptions,
} from './findReplace';

const defaultOptions: FindReplaceOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

describe('findReplace', () => {
  it('finds literal matches case-insensitively by default', () => {
    const result = findTextMatches('Alpha beta alpha', 'alpha', defaultOptions);

    expect(result.error).toBeNull();
    expect(result.matches.map((match) => [match.start, match.end])).toEqual([
      [0, 5],
      [11, 16],
    ]);
  });

  it('filters literal matches to whole words', () => {
    const result = findTextMatches('cat scatter cat_cat cat', 'cat', {
      ...defaultOptions,
      wholeWord: true,
    });

    expect(result.matches.map((match) => match.start)).toEqual([0, 20]);
  });

  it('returns regex errors without throwing', () => {
    const result = findTextMatches('alpha', '[', {
      ...defaultOptions,
      regex: true,
    });

    expect(result.matches).toEqual([]);
    expect(result.error).toMatch(/invalid regular expression/i);
  });

  it('replaces one regex match with capture groups', () => {
    const result = findTextMatches('todo 123\ntodo 456', 'todo (\\d+)', {
      ...defaultOptions,
      regex: true,
    });

    expect(replaceSingleMatch('todo 123\ntodo 456', result.matches[0], 'done $1')).toBe(
      'done 123\ntodo 456',
    );
  });

  it('replaces all matches from the original match ranges', () => {
    const result = findTextMatches('todo 123\ntodo 456', 'todo (\\d+)', {
      ...defaultOptions,
      regex: true,
    });

    expect(replaceAllMatches('todo 123\ntodo 456', result.matches, 'done $1')).toBe(
      'done 123\ndone 456',
    );
  });

  it('resolves active match display state and clamps out-of-range indexes', () => {
    const result = findTextMatches('alpha beta alpha', 'alpha', defaultOptions);

    expect(resolveFindMatchSelection(result.matches, 8)).toEqual({
      activeMatch: result.matches[1],
      activeMatchNumber: 2,
      activeIndex: 1,
    });
    expect(resolveFindMatchSelection([], 8)).toEqual({
      activeMatch: undefined,
      activeMatchNumber: 0,
      activeIndex: 0,
    });
  });

  it('wraps next and previous match indexes', () => {
    expect(nextFindMatchIndex(0, 3, 'previous')).toBe(2);
    expect(nextFindMatchIndex(2, 3, 'next')).toBe(0);
    expect(nextFindMatchIndex(5, 0, 'next')).toBe(5);
  });

  it('clamps the active index after replacing one match', () => {
    expect(nextFindMatchIndexAfterReplace(2, 3)).toBe(1);
    expect(nextFindMatchIndexAfterReplace(0, 1)).toBe(0);
    expect(nextFindMatchIndexAfterReplace(5, 0)).toBe(0);
  });
});
