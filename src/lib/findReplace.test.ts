import { describe, expect, it } from 'vitest';

import {
  findTextMatches,
  matchScrollStrategy,
  nextFindMatchIndex,
  nextFindMatchIndexAfterReplace,
  replaceAllMatches,
  replaceSingleMatch,
  resolveFindMatchSelection,
  resolveFindReplaceViewState,
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

  it('resolves the app find/replace view state from source or WYSIWYG results', () => {
    const sourceResult = findTextMatches('Alpha beta alpha', 'alpha', defaultOptions);
    const wysiwygResult = {
      matches: [
        {
          ...sourceResult.matches[0],
          wysiwygFrom: 3,
          wysiwygTo: 8,
        },
      ],
      error: null,
    };

    expect(
      resolveFindReplaceViewState({
        sourceResult,
        wysiwygResult,
        activeIndex: 3,
        activeDocumentOpen: true,
        currentMode: 'Wysiwyg',
        wysiwygEditorAvailable: true,
      }),
    ).toEqual({
      result: wysiwygResult,
      matches: wysiwygResult.matches,
      matchCount: 1,
      activeMatch: wysiwygResult.matches[0],
      activeMatchNumber: 1,
      canReplace: true,
    });

    expect(
      resolveFindReplaceViewState({
        sourceResult,
        wysiwygResult: null,
        activeIndex: 0,
        activeDocumentOpen: true,
        currentMode: 'Wysiwyg',
        wysiwygEditorAvailable: false,
      }).canReplace,
    ).toBe(false);
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

describe('matchScrollStrategy', () => {
  it('does not scroll when the match is fully inside the viewport', () => {
    expect(
      matchScrollStrategy({
        blockTop: 500,
        blockBottom: 520,
        scrollTop: 400,
        clientHeight: 600,
      }),
    ).toBe('none');
  });

  it('centers when the match is above the viewport', () => {
    expect(
      matchScrollStrategy({
        blockTop: 100,
        blockBottom: 120,
        scrollTop: 400,
        clientHeight: 600,
      }),
    ).toBe('center');
  });

  it('centers when the match is below the viewport', () => {
    expect(
      matchScrollStrategy({
        blockTop: 2000,
        blockBottom: 2020,
        scrollTop: 400,
        clientHeight: 600,
      }),
    ).toBe('center');
  });

  it('centers when the match straddles the viewport edge', () => {
    expect(
      matchScrollStrategy({
        blockTop: 990,
        blockBottom: 1010,
        scrollTop: 400,
        clientHeight: 600,
      }),
    ).toBe('center');
  });
});
