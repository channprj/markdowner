export interface OutlineItem {
  id: string;
  title: string;
  depth: number;
  titleStart: number;
  titleEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

export function parseMarkdownOutline(source: string): OutlineItem[] {
  const matches = Array.from(source.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm));

  return matches.map((match, index) => {
    const lineStart = match.index ?? 0;
    const rawTitle = match[2] ?? '';
    const title = rawTitle.trim();
    const rawTitleStartInLine = match[0].indexOf(rawTitle);
    const trimmedPrefixLength = rawTitle.length - rawTitle.trimStart().length;
    const titleStart = lineStart + Math.max(0, rawTitleStartInLine) + trimmedPrefixLength;

    return {
      id: `${index}-${lineStart}`,
      depth: match[1]?.length ?? 1,
      title,
      titleStart,
      titleEnd: titleStart + title.length,
      selectionStart: lineStart,
      selectionEnd: lineStart + match[0].trimEnd().length,
    };
  });
}
