import { describe, expect, it } from 'vitest';

import { WINDOW_TITLE, buildWindowTitle, formatThemeLabel } from './shellDisplay';

describe('formatThemeLabel', () => {
  it('returns friendly labels for built-in and custom themes', () => {
    expect(formatThemeLabel('BuiltInLight')).toBe('Light');
    expect(formatThemeLabel('BuiltInDark')).toBe('Dark');
    expect(formatThemeLabel('CustomCss')).toBe('Custom');
  });
});

describe('buildWindowTitle', () => {
  it('returns the app title when no document is open', () => {
    expect(
      buildWindowTitle({
        activeDocumentDirty: false,
        activeDocumentName: null,
        activeDocumentSource: null,
      }),
    ).toBe(WINDOW_TITLE);
  });

  it('returns the document title for a clean open document', () => {
    expect(
      buildWindowTitle({
        activeDocumentDirty: false,
        activeDocumentName: 'notes.md',
        activeDocumentSource: '# Notes',
      }),
    ).toBe('notes.md \u2014 Markdowner');
  });

  it('marks dirty documents in the title', () => {
    expect(
      buildWindowTitle({
        activeDocumentDirty: true,
        activeDocumentName: 'notes.md',
        activeDocumentSource: '# Notes',
      }),
    ).toBe('\u25cf notes.md \u2014 Markdowner');
  });
});
