import { describe, expect, it } from 'vitest';

import { filterSlashItems } from './slashItemFilter';

const ITEMS = [
  { title: 'Text', keywords: ['text', 'paragraph', '텍스트'] },
  { title: 'Heading 1', keywords: ['h1', 'heading', '제목1'] },
  { title: 'Table', keywords: ['table', 'grid', '표', '테이블'] },
  { title: 'Code block', keywords: ['code', 'fenced', '코드블록'] },
];

const titles = (query: string) => filterSlashItems(ITEMS, query).map((item) => item.title);

describe('filterSlashItems', () => {
  it('returns everything in curated order for an empty query', () => {
    expect(titles('')).toEqual(['Text', 'Heading 1', 'Table', 'Code block']);
  });

  it('matches full-fuzzy subsequences, not just prefixes', () => {
    expect(titles('tbl')[0]).toBe('Table');
    expect(titles('cdblk')[0]).toBe('Code block');
  });

  it('ranks the better match first', () => {
    // "te" prefix-matches Text strongly; Table also matches but later chars.
    expect(titles('te')[0]).toBe('Text');
  });

  it('matches Korean keywords typed in Korean', () => {
    expect(titles('테이블')).toEqual(['Table']);
  });

  it('matches Korean keywords typed in English key positions', () => {
    // "표" on a dubeolsik layout is typed as "vy".
    expect(titles('vy')).toContain('Table');
  });

  it('matches English titles typed with the IME left in Korean mode', () => {
    // "table" mistyped under the Korean IME becomes "ㅅ뮤ㅣㄷ".
    expect(titles('ㅅ뮤ㅣㄷ')).toContain('Table');
  });

  it('drops items that do not match at all', () => {
    expect(titles('zzzz')).toEqual([]);
  });
});
