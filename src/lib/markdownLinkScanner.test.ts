import { describe, expect, it } from 'vitest';

import { findMarkdownLinkUrlAtOffset } from './markdownLinkScanner';

describe('findMarkdownLinkUrlAtOffset', () => {
  it('returns the destination when the offset is inside a markdown link', () => {
    const line = 'Read [the guide](docs/guide.md) before editing.';

    expect(findMarkdownLinkUrlAtOffset(line, line.indexOf('guide'))).toBe('docs/guide.md');
  });

  it('keeps only the destination when the link has a quoted title', () => {
    const line = 'Open [release notes](notes.md "Release notes").';

    expect(findMarkdownLinkUrlAtOffset(line, line.indexOf('release notes'))).toBe('notes.md');
  });

  it('handles angle-bracket destinations with spaces', () => {
    const line = 'Open [local note](<docs/My Note.md> "Local note").';

    expect(findMarkdownLinkUrlAtOffset(line, line.indexOf('local note'))).toBe('docs/My Note.md');
  });

  it('ignores image syntax and offsets outside links', () => {
    const line = '![alt](image.png) then [open](doc.md)';

    expect(findMarkdownLinkUrlAtOffset(line, line.indexOf('alt'))).toBeNull();
    expect(findMarkdownLinkUrlAtOffset(line, line.indexOf('then'))).toBeNull();
    expect(findMarkdownLinkUrlAtOffset(line, line.indexOf('open'))).toBe('doc.md');
  });
});
