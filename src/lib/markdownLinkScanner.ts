/**
 * Returns the markdown link destination under the given offset in a single
 * source line. This intentionally stays lighter than a full markdown parser:
 * source-mode link opening only needs a fast best-effort scanner for
 * `[text](url)` spans under the pointer.
 */
export function findMarkdownLinkUrlAtOffset(line: string, offset: number): string | null {
  let searchFrom = 0;

  while (searchFrom < line.length) {
    const labelStart = line.indexOf('[', searchFrom);
    if (labelStart === -1) return null;

    const labelEnd = line.indexOf(']', labelStart + 1);
    if (labelEnd === -1) return null;

    const openParen = labelEnd + 1;
    if (line[openParen] !== '(') {
      searchFrom = labelStart + 1;
      continue;
    }

    const closeParen = findClosingParen(line, openParen + 1);
    if (closeParen === -1) {
      searchFrom = openParen + 1;
      continue;
    }

    if (offset >= labelStart && offset <= closeParen) {
      if (line[labelStart - 1] === '!') return null;
      return parseDestination(line.slice(openParen + 1, closeParen));
    }

    searchFrom = closeParen + 1;
  }

  return null;
}

function findClosingParen(line: string, startIndex: number): number {
  let escaped = false;
  let inAngleDestination = false;

  for (let index = startIndex; index < line.length; index += 1) {
    const character = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '<' && !inAngleDestination) {
      inAngleDestination = true;
      continue;
    }

    if (character === '>' && inAngleDestination) {
      inAngleDestination = false;
      continue;
    }

    if (character === ')' && !inAngleDestination) {
      return index;
    }
  }

  return -1;
}

function parseDestination(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('<')) {
    const end = findClosingAngle(trimmed, 1);
    if (end === -1) return null;
    const destination = trimmed.slice(1, end).trim();
    return destination || null;
  }

  const match = trimmed.match(/^\S+/);
  return match?.[0] ?? null;
}

function findClosingAngle(value: string, startIndex: number): number {
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '>') {
      return index;
    }
  }

  return -1;
}
