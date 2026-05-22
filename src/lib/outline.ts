export interface OutlineItem {
  id: string;
  title: string;
  depth: number;
  titleStart: number;
  titleEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

const HEADING_LINE_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_START_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

export function parseMarkdownOutline(source: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;
  let activeFence: { marker: '`' | '~'; length: number } | null = null;

  for (const line of source.split('\n')) {
    const fence = line.match(FENCE_START_PATTERN);
    if (fence) {
      const sequence = fence[1] ?? '';
      const marker = sequence[0] as '`' | '~';
      if (activeFence) {
        if (activeFence.marker === marker && sequence.length >= activeFence.length) {
          activeFence = null;
        }
      } else {
        activeFence = { marker, length: sequence.length };
      }
      offset += line.length + 1;
      continue;
    }

    if (activeFence) {
      offset += line.length + 1;
      continue;
    }

    const match = line.match(HEADING_LINE_PATTERN);
    if (match) {
      const rawTitle = match[2] ?? '';
      const title = rawTitle.trim();
      const rawTitleStartInLine = line.indexOf(rawTitle);
      const trimmedPrefixLength = rawTitle.length - rawTitle.trimStart().length;
      const titleStart = offset + Math.max(0, rawTitleStartInLine) + trimmedPrefixLength;

      items.push({
        id: `${items.length}-${offset}`,
        depth: match[1]?.length ?? 1,
        title,
        titleStart,
        titleEnd: titleStart + title.length,
        selectionStart: offset,
        selectionEnd: offset + line.trimEnd().length,
      });
    }

    offset += line.length + 1;
  }

  return items;
}
