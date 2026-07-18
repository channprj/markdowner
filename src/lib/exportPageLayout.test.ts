import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPORT_PAGE_LAYOUT,
  formatPageNumber,
  normalizeExportPageLayout,
  pageNumberTemplateForFormat,
  validatePageNumberTemplate,
  validatePdfPageGeometry,
} from './exportPageLayout';

describe('export page layout', () => {
  it('migrates legacy scalar padding to All sides', () => {
    expect(normalizeExportPageLayout({ contentPadding: 24 })).toMatchObject({
      contentPaddingMode: 'all',
      contentPaddingTop: 24,
      contentPaddingRight: 24,
      contentPaddingBottom: 24,
      contentPaddingLeft: 24,
    });
  });

  it('infers Per side for unequal persisted values', () => {
    expect(
      normalizeExportPageLayout({
        contentPaddingTop: 10,
        contentPaddingRight: 20,
        contentPaddingBottom: 30,
        contentPaddingLeft: 40,
      }),
    ).toMatchObject({
      contentPaddingMode: 'individual',
      contentPaddingTop: 10,
      contentPaddingRight: 20,
      contentPaddingBottom: 30,
      contentPaddingLeft: 40,
    });
  });

  it('defaults page numbers to disabled bottom-center 1/12', () => {
    expect(DEFAULT_EXPORT_PAGE_LAYOUT).toMatchObject({
      pageNumbersEnabled: false,
      pageNumberPosition: 'bottom-center',
      pageNumberFormat: 'page-total',
      pageNumberTemplate: '{page}/{pages}',
    });
    expect(formatPageNumber('{page}/{pages}', 1, 12)).toBe('1/12');
  });

  it('maps every preset and validates Custom tokens', () => {
    expect(pageNumberTemplateForFormat('page-label-of-total', '')).toBe(
      'Page {page} of {pages}',
    );
    expect(pageNumberTemplateForFormat('dash-page', '')).toBe('– {page} –');
    expect(validatePageNumberTemplate('{page} · {pages}')).toEqual({ valid: true });
    expect(validatePageNumberTemplate('{pages}')).toMatchObject({ valid: false });
    expect(validatePageNumberTemplate('{page}/{unknown}')).toMatchObject({ valid: false });
  });

  it('rejects padding and decoration bands that consume the page', () => {
    const layout = {
      ...DEFAULT_EXPORT_PAGE_LAYOUT,
      contentPaddingLeft: 60,
      contentPaddingRight: 60,
    };
    expect(validatePdfPageGeometry(100, 200, layout)).toMatchObject({ valid: false });
    expect(validatePdfPageGeometry(595, 842, layout)).toEqual({ valid: true });
  });
});
