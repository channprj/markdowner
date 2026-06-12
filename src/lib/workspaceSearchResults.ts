import type { SearchResultFile, SearchResultMatch } from '@/shell/SearchPanel';

import { findTextMatches, type FindReplaceOptions } from './findReplace';

/**
 * Recompute one document's workspace-search matches from its LIVE draft so
 * the Cmd+Shift+F results track edits immediately: matches the user edits
 * away disappear, new ones appear, line numbers stay correct — without
 * waiting for a save or re-running the whole workspace search.
 *
 * Returns the updated result list, or null when nothing changed for `path`.
 */
export function refreshSearchResultsForDocument(
  results: readonly SearchResultFile[],
  path: string,
  draft: string,
  query: string,
  options: FindReplaceOptions,
): SearchResultFile[] | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;

  const matches = buildSearchResultMatches(draft, query, options);
  const existingIndex = results.findIndex((file) => file.path === path);

  if (existingIndex < 0) {
    if (matches.length === 0) return null;
    // Edits introduced brand-new matches in a file the search missed.
    return [...results, { path, matches }];
  }

  if (matches.length === 0) {
    return results.filter((file) => file.path !== path);
  }

  return results.map((file, index) =>
    index === existingIndex ? { path, matches } : file,
  );
}

function buildSearchResultMatches(
  draft: string,
  query: string,
  options: FindReplaceOptions,
): SearchResultMatch[] {
  const { matches } = findTextMatches(draft, query, options);
  if (matches.length === 0) return [];

  // Precompute line start offsets once; matches arrive in document order.
  const lineStarts = [0];
  for (let offset = 0; offset < draft.length; offset += 1) {
    if (draft[offset] === '\n') lineStarts.push(offset + 1);
  }

  let lineIndex = 0;
  return matches.map((match) => {
    while (lineIndex + 1 < lineStarts.length && lineStarts[lineIndex + 1] <= match.start) {
      lineIndex += 1;
    }
    const lineStart = lineStarts[lineIndex];
    const lineEnd = draft.indexOf('\n', lineStart);
    const preview = draft.slice(lineStart, lineEnd === -1 ? draft.length : lineEnd);
    const matchStart = match.start - lineStart;
    return {
      line: lineIndex + 1,
      column: matchStart + 1,
      preview,
      matchStart,
      matchEnd: Math.min(match.end - lineStart, preview.length),
      absoluteOffset: match.start,
    };
  });
}
