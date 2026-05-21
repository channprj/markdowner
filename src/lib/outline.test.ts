import { describe, expect, it } from 'vitest';

import { parseMarkdownOutline } from './outline';

describe('parseMarkdownOutline', () => {
  it('returns heading depth, display title, and source ranges', () => {
    const source = ['# Agenda', '', '##   Decisions   ###', 'Notes', '### Follow-up'].join('\n');

    expect(parseMarkdownOutline(source)).toEqual([
      {
        id: '0-0',
        depth: 1,
        title: 'Agenda',
        titleStart: 2,
        titleEnd: 8,
        selectionStart: 0,
        selectionEnd: 8,
      },
      {
        id: '1-10',
        depth: 2,
        title: 'Decisions',
        titleStart: 15,
        titleEnd: 24,
        selectionStart: 10,
        selectionEnd: 30,
      },
      {
        id: '2-37',
        depth: 3,
        title: 'Follow-up',
        titleStart: 41,
        titleEnd: 50,
        selectionStart: 37,
        selectionEnd: 50,
      },
    ]);
  });

  it('ignores non-headings and hashes deeper than six levels', () => {
    expect(parseMarkdownOutline(['Body', '####### Too deep', '# Valid'].join('\n'))).toEqual([
      {
        id: '0-22',
        depth: 1,
        title: 'Valid',
        titleStart: 24,
        titleEnd: 29,
        selectionStart: 22,
        selectionEnd: 29,
      },
    ]);
  });
});
