import { describe, expect, it, vi } from 'vitest';

import {
  PDF_PREVIEW_READY_MESSAGE,
  buildPdfPaginationScript,
  isPdfPreviewReadyMessage,
  paginatePdfDocument,
} from './pdfPagination';

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 100,
    bottom: top + height,
    left: 0,
    width: 100,
    height,
    toJSON: () => ({}),
  };
}

describe('paginatePdfDocument', () => {
  const pageInsets = { top: 22, right: 18, bottom: 28, left: 24 };
  const pageFurniture = {
    headerText: '',
    headerAlignment: 'center' as const,
    footerText: '',
    footerAlignment: 'center' as const,
    pageNumbersEnabled: false,
    pageNumberPosition: 'bottom-center' as const,
    pageNumberTemplate: '{page}/{pages}',
    textColor: '#202124',
    fontFamily: 'system-ui, sans-serif',
  };

  it('moves a fitting block using independent top and bottom insets', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="first"></p><p id="crossing"></p></main>';
    const first = document.querySelector('#first') as HTMLElement;
    const crossing = document.querySelector('#crossing') as HTMLElement;
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(rect(20, 60));
    vi.spyOn(crossing, 'getBoundingClientRect').mockReturnValue(rect(180, 40));

    const result = paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    expect(crossing.style.marginTop).toBe('42px');
    expect(result.pageCount).toBeGreaterThanOrEqual(2);
  });

  it('leaves a block taller than the usable page in normal flow', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><pre id="oversized" style="margin-top:4px"></pre></main>';
    const oversized = document.querySelector('#oversized') as HTMLElement;
    vi.spyOn(oversized, 'getBoundingClientRect').mockReturnValue(rect(30, 180));

    paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    expect(oversized.style.marginTop).toBe('4px');
  });

  it('restores original margins before rerunning pagination', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="block" style="margin-top:4px"></p></main>';
    const block = document.querySelector('#block') as HTMLElement;
    vi.spyOn(block, 'getBoundingClientRect')
      .mockReturnValueOnce(rect(180, 40))
      .mockReturnValueOnce(rect(20, 40));
    const options = {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    };

    paginatePdfDocument(document, options);
    expect(block.style.marginTop).toBe('46px');

    paginatePdfDocument(document, options);
    expect(block.style.marginTop).toBe('4px');
  });

  it('rejects a document whose measured height exceeds the page cap', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="too-long"></p></main>';
    const block = document.querySelector('#too-long') as HTMLElement;
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(20_000, 40));

    expect(() =>
      paginatePdfDocument(document, {
        pageWidth: 160,
        pageHeight: 200,
        pageInsets,
        pageFurniture,
        maxPages: 100,
      }),
    ).toThrow(/100 pages/);
  });

  it('repeats header, footer, and formatted page numbers on every page', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="oversized"></p></main>';
    const oversized = document.querySelector('#oversized') as HTMLElement;
    vi.spyOn(oversized, 'getBoundingClientRect').mockReturnValue(rect(32, 260));

    const result = paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets: { top: 10, right: 10, bottom: 10, left: 10 },
      pageFurniture: {
        ...pageFurniture,
        headerText: 'Project Atlas',
        footerText: 'Confidential',
        pageNumbersEnabled: true,
      },
      maxPages: 100,
    });

    const decorations = Array.from(
      document.querySelectorAll<HTMLElement>('[data-markdowner-pdf-decoration="page"]'),
    );
    expect(result.pageCount).toBe(2);
    expect(decorations).toHaveLength(2);
    expect(decorations[0].textContent).toContain('Project Atlas');
    expect(decorations[0].textContent).toContain('Confidential');
    expect(decorations[0].textContent).toContain('1/2');
    expect(decorations[1].textContent).toContain('Project Atlas');
    expect(decorations[1].textContent).toContain('Confidential');
    expect(decorations[1].textContent).toContain('2/2');
  });

  it('treats page furniture as text and replaces decorations on rerun', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="content"></p></main>';
    const content = document.querySelector('#content') as HTMLElement;
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect(32, 20));
    const options = {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets: { top: 10, right: 10, bottom: 10, left: 10 },
      pageFurniture: {
        ...pageFurniture,
        headerText: '<b>Plain text</b>',
        pageNumbersEnabled: true,
      },
      maxPages: 100,
    };

    paginatePdfDocument(document, options);
    paginatePdfDocument(document, options);

    expect(
      document.querySelectorAll('[data-markdowner-pdf-decoration="page"]'),
    ).toHaveLength(1);
    expect(document.querySelector('[data-markdowner-pdf-decoration="page"] b')).toBeNull();
    expect(document.querySelector('[data-markdowner-pdf-decoration="page"]')?.textContent).toContain(
      '<b>Plain text</b>',
    );
  });
});

describe('PDF pagination runtime', () => {
  it('serializes the exact preview token and point dimensions', () => {
    const config = {
      token: 'preview-token',
      pageWidth: 595.2755905511812,
      pageHeight: 841.8897637795276,
      pageInsets: { top: 32, right: 36, bottom: 40, left: 44 },
      pageFurniture: {
        headerText: 'Project Atlas',
        headerAlignment: 'left' as const,
        footerText: '',
        footerAlignment: 'center' as const,
        pageNumbersEnabled: true,
        pageNumberPosition: 'bottom-center' as const,
        pageNumberTemplate: '{page}/{pages}',
        textColor: '#202124',
        fontFamily: 'system-ui, sans-serif',
      },
      maxPages: 100,
    };

    const script = buildPdfPaginationScript(config);
    expect(script).toContain(JSON.stringify(config));
    expect(script).toContain('markdowner:pdf-preview-error');
  });

  it('accepts only token-scoped, finite ready messages within the page cap', () => {
    const valid = {
      type: PDF_PREVIEW_READY_MESSAGE,
      token: 'preview-token',
      pageIndex: 1,
      pageCount: 2,
      pageWidth: 595.2755905511812,
      pageHeight: 841.8897637795276,
    };

    expect(isPdfPreviewReadyMessage(valid, 'preview-token')).toBe(true);
    expect(isPdfPreviewReadyMessage({ ...valid, token: 'stale' }, 'preview-token')).toBe(false);
    expect(isPdfPreviewReadyMessage({ ...valid, pageIndex: 2 }, 'preview-token')).toBe(false);
    expect(isPdfPreviewReadyMessage({ ...valid, pageWidth: Number.NaN }, 'preview-token')).toBe(
      false,
    );
    expect(isPdfPreviewReadyMessage({ ...valid, pageCount: 101 }, 'preview-token')).toBe(false);
    expect(isPdfPreviewReadyMessage({ ...valid, extra: true }, 'preview-token')).toBe(false);
  });
});
