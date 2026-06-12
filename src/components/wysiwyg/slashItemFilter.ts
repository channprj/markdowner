import { fuzzyScore } from '@/lib/fuzzy';
import { hangulToQwerty } from '@/lib/hangulQwerty';

export type FilterableSlashItem = {
  title: string;
  keywords: string[];
};

/**
 * Ranked fuzzy filter for the slash menu — the same combobox behavior as the
 * command palette, and language-agnostic in both directions:
 *  - English queries match Korean keywords through the keywords' QWERTY
 *    romanization ("vy" → "표"),
 *  - wrong-IME Korean queries match English titles through the query's
 *    romanization ("ㅅ뮤ㅣㄷ" → "table"),
 *  - Korean queries match Korean keywords directly.
 * Ties keep the curated item order.
 */
export function filterSlashItems<T extends FilterableSlashItem>(
  items: readonly T[],
  rawQuery: string,
): T[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [...items];
  const romanizedQuery = hangulToQwerty(trimmed);
  const scored: Array<{ item: T; score: number; order: number }> = [];
  items.forEach((item, order) => {
    const haystack = `${item.title} ${item.keywords.join(' ')}`;
    const romanizedHaystack = hangulToQwerty(haystack);
    const score = Math.max(
      fuzzyScore(haystack, trimmed),
      romanizedQuery === trimmed ? 0 : fuzzyScore(haystack, romanizedQuery),
      romanizedHaystack === haystack ? 0 : fuzzyScore(romanizedHaystack, trimmed),
      romanizedHaystack === haystack || romanizedQuery === trimmed
        ? 0
        : fuzzyScore(romanizedHaystack, romanizedQuery),
    );
    if (score > 0) {
      scored.push({ item, score, order });
    }
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((entry) => entry.item);
}
