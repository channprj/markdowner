export type DocumentStats = {
  words: number;
  characters: number;
  readingTimeMinutes: number;
  headings: number;
  links: number;
  images: number;
  tables: number;
};

const IMAGE_PATTERN = /!\[[^\]]*]\([^\n)]+\)/g;
const LINK_PATTERN = /\[[^\]]+]\([^\n)]+\)/g;
const HEADING_PATTERN = /^#{1,6}\s+.+$/gm;
const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function calculateDocumentStats(source: string): DocumentStats {
  const characters = source.length;
  const trimmed = source.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const readingTimeMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));

  const headingMatches = source.match(HEADING_PATTERN) ?? [];
  const imageMatches = source.match(IMAGE_PATTERN) ?? [];
  const links = source.replace(IMAGE_PATTERN, '').match(LINK_PATTERN) ?? [];

  const lines = source.split(/\r?\n/);
  let tables = 0;
  for (let index = 1; index < lines.length - 1; index += 1) {
    if (!isTableSeparator(lines[index] ?? '')) {
      continue;
    }

    if (isTableRow(lines[index - 1] ?? '') && isTableRow(lines[index + 1] ?? '')) {
      tables += 1;
    }
  }

  return {
    words,
    characters,
    readingTimeMinutes,
    headings: headingMatches.length,
    links: links.length,
    images: imageMatches.length,
    tables,
  };
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 0;
}

function isTableSeparator(line: string): boolean {
  return TABLE_SEPARATOR_PATTERN.test(line);
}
