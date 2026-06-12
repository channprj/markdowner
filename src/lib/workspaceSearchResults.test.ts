import { describe, expect, it } from 'vitest';

import type { SearchResultFile } from '@/shell/SearchPanel';

import { refreshSearchResultsForDocument } from './workspaceSearchResults';

const OPTIONS = { caseSensitive: false, wholeWord: false, regex: false };

const results: SearchResultFile[] = [
  {
    path: '/ws/a.md',
    matches: [
      {
        line: 1,
        column: 1,
        preview: 'alpha one',
        matchStart: 0,
        matchEnd: 5,
        absoluteOffset: 0,
      },
    ],
  },
  {
    path: '/ws/b.md',
    matches: [
      {
        line: 2,
        column: 1,
        preview: 'alpha two',
        matchStart: 0,
        matchEnd: 5,
        absoluteOffset: 10,
      },
    ],
  },
];

describe('refreshSearchResultsForDocument', () => {
  it('drops the file once its matches were edited away', () => {
    const next = refreshSearchResultsForDocument(
      results,
      '/ws/a.md',
      'beta one\n',
      'alpha',
      OPTIONS,
    );

    expect(next?.map((file) => file.path)).toEqual(['/ws/b.md']);
  });

  it('recomputes match positions and previews from the live draft', () => {
    const next = refreshSearchResultsForDocument(
      results,
      '/ws/a.md',
      'intro line\nsay alpha here\n',
      'alpha',
      OPTIONS,
    );

    expect(next?.[0].matches).toEqual([
      {
        line: 2,
        column: 5,
        preview: 'say alpha here',
        matchStart: 4,
        matchEnd: 9,
        absoluteOffset: 15,
      },
    ]);
    // The other file's entries are untouched.
    expect(next?.[1]).toBe(results[1]);
  });

  it('adds a file when edits introduce brand-new matches', () => {
    const next = refreshSearchResultsForDocument(
      results,
      '/ws/c.md',
      'fresh alpha\n',
      'alpha',
      OPTIONS,
    );

    expect(next?.map((file) => file.path)).toEqual(['/ws/a.md', '/ws/b.md', '/ws/c.md']);
  });

  it('returns null when nothing changes for the document', () => {
    expect(
      refreshSearchResultsForDocument(results, '/ws/c.md', 'no hits here\n', 'alpha', OPTIONS),
    ).toBeNull();
    expect(
      refreshSearchResultsForDocument(results, '/ws/a.md', 'alpha one\n', '', OPTIONS),
    ).toBeNull();
  });
});
