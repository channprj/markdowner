export type FindReplaceOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type FindMatch = {
  start: number;
  end: number;
  text: string;
  regex: boolean;
  captures: string[];
  groups: Record<string, string> | null;
};

export type FindTextResult = {
  matches: FindMatch[];
  error: string | null;
};

export type FindMatchDirection = 'next' | 'previous';

export type FindMatchSelection = {
  activeMatch: FindMatch | undefined;
  activeMatchNumber: number;
  activeIndex: number;
};

const WORD_CHARACTER_PATTERN = /[A-Za-z0-9_]/;

function isWordCharacter(value: string | undefined) {
  return value !== undefined && WORD_CHARACTER_PATTERN.test(value);
}

function isWholeWordMatch(source: string, start: number, end: number) {
  return !isWordCharacter(source[start - 1]) && !isWordCharacter(source[end]);
}

function regexFlags(options: FindReplaceOptions) {
  return `g${options.caseSensitive ? '' : 'i'}u`;
}

function emptyResult(error: string | null = null): FindTextResult {
  return { matches: [], error };
}

function findRegexMatches(
  source: string,
  query: string,
  options: FindReplaceOptions,
): FindTextResult {
  let pattern: RegExp;
  try {
    pattern = new RegExp(query, regexFlags(options));
  } catch {
    return emptyResult('Invalid regular expression');
  }

  const matches: FindMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const text = match[0] ?? '';
    if (text.length === 0) {
      pattern.lastIndex += 1;
      continue;
    }

    const start = match.index;
    const end = start + text.length;
    if (!options.wholeWord || isWholeWordMatch(source, start, end)) {
      matches.push({
        start,
        end,
        text,
        regex: true,
        captures: match.slice(1),
        groups: match.groups ? { ...match.groups } : null,
      });
    }
  }

  return { matches, error: null };
}

function findLiteralMatches(
  source: string,
  query: string,
  options: FindReplaceOptions,
): FindTextResult {
  const haystack = options.caseSensitive ? source : source.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const matches: FindMatch[] = [];
  let index = haystack.indexOf(needle);

  while (index >= 0) {
    const start = index;
    const end = start + query.length;
    if (!options.wholeWord || isWholeWordMatch(source, start, end)) {
      matches.push({
        start,
        end,
        text: source.slice(start, end),
        regex: false,
        captures: [],
        groups: null,
      });
    }
    index = haystack.indexOf(needle, Math.max(end, start + 1));
  }

  return { matches, error: null };
}

export function findTextMatches(
  source: string,
  query: string,
  options: FindReplaceOptions,
): FindTextResult {
  if (query.length === 0) {
    return emptyResult();
  }

  return options.regex
    ? findRegexMatches(source, query, options)
    : findLiteralMatches(source, query, options);
}

export function replacementTextForMatch(match: FindMatch, replacement: string) {
  if (!match.regex) {
    return replacement;
  }

  return replacement.replace(/\$(\$|&|[0-9]{1,2}|<[^>]+>)/g, (token, marker) => {
    if (marker === '$') {
      return '$';
    }
    if (marker === '&') {
      return match.text;
    }
    if (marker.startsWith('<') && marker.endsWith('>')) {
      const name = marker.slice(1, -1);
      return match.groups?.[name] ?? '';
    }
    const index = Number.parseInt(marker, 10);
    if (Number.isFinite(index) && index > 0) {
      return match.captures[index - 1] ?? '';
    }
    return token;
  });
}

export function replaceSingleMatch(source: string, match: FindMatch | undefined, replacement: string) {
  if (!match) {
    return source;
  }

  return `${source.slice(0, match.start)}${replacementTextForMatch(match, replacement)}${source.slice(match.end)}`;
}

export function replaceAllMatches(source: string, matches: FindMatch[], replacement: string) {
  if (matches.length === 0) {
    return source;
  }

  let next = '';
  let cursor = 0;
  for (const match of matches) {
    next += source.slice(cursor, match.start);
    next += replacementTextForMatch(match, replacement);
    cursor = match.end;
  }
  next += source.slice(cursor);
  return next;
}

export function resolveFindMatchSelection(
  matches: readonly FindMatch[],
  activeIndex: number,
): FindMatchSelection {
  if (matches.length === 0) {
    return {
      activeMatch: undefined,
      activeMatchNumber: 0,
      activeIndex: 0,
    };
  }

  const clampedIndex = Math.max(0, Math.min(activeIndex, matches.length - 1));
  return {
    activeMatch: matches[clampedIndex],
    activeMatchNumber: clampedIndex + 1,
    activeIndex: clampedIndex,
  };
}

export function nextFindMatchIndex(
  currentIndex: number,
  matchCount: number,
  direction: FindMatchDirection,
): number {
  if (matchCount === 0) {
    return currentIndex;
  }

  const offset = direction === 'next' ? 1 : -1;
  return (currentIndex + offset + matchCount) % matchCount;
}

export function nextFindMatchIndexAfterReplace(
  currentIndex: number,
  matchCountBeforeReplace: number,
): number {
  return Math.max(0, Math.min(currentIndex, matchCountBeforeReplace - 2));
}
