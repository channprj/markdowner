import { describe, expect, it } from 'vitest';

import { calculateDocumentStats } from './documentStats';

describe('calculateDocumentStats', () => {
  it('counts words, characters, headings, links, images, and markdown tables', () => {
    const source = [
      '# Report',
      '',
      'Alpha beta [docs](https://example.com) ![chart](chart.png).',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| One | 1 |',
      '',
      '## Next',
    ].join('\n');

    expect(calculateDocumentStats(source)).toEqual({
      words: 23,
      characters: source.length,
      readingTimeMinutes: 1,
      headings: 2,
      links: 1,
      images: 1,
      tables: 1,
    });
  });

  it('returns zero words and reading time for empty or whitespace-only input', () => {
    expect(calculateDocumentStats('   \n\t')).toMatchObject({
      words: 0,
      readingTimeMinutes: 0,
    });
  });

  it('rounds reading time up from the 200 words per minute baseline', () => {
    const source = Array.from({ length: 201 }, (_, index) => `word${index}`).join(' ');

    expect(calculateDocumentStats(source).readingTimeMinutes).toBe(2);
  });
});
