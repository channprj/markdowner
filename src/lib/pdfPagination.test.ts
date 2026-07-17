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
  it('moves a fitting block to the next usable page', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="first"></p><p id="crossing"></p></main>';
    const first = document.querySelector('#first') as HTMLElement;
    const crossing = document.querySelector('#crossing') as HTMLElement;
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(rect(20, 60));
    vi.spyOn(crossing, 'getBoundingClientRect').mockReturnValue(rect(180, 40));

    const result = paginatePdfDocument(document, {
      pageHeight: 200,
      pageMargin: 20,
      maxPages: 100,
    });

    expect(crossing.style.marginTop).toBe('40px');
    expect(result.pageCount).toBeGreaterThanOrEqual(2);
  });

  it('leaves a block taller than the usable page in normal flow', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><pre id="oversized" style="margin-top:4px"></pre></main>';
    const oversized = document.querySelector('#oversized') as HTMLElement;
    vi.spyOn(oversized, 'getBoundingClientRect').mockReturnValue(rect(30, 180));

    paginatePdfDocument(document, {
      pageHeight: 200,
      pageMargin: 20,
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
    const options = { pageHeight: 200, pageMargin: 20, maxPages: 100 };

    paginatePdfDocument(document, options);
    expect(block.style.marginTop).toBe('44px');

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
        pageHeight: 200,
        pageMargin: 20,
        maxPages: 100,
      }),
    ).toThrow(/100 pages/);
  });
});

describe('PDF pagination runtime', () => {
  it('serializes the exact preview token and point dimensions', () => {
    const config = {
      token: 'preview-token',
      pageWidth: 595.2755905511812,
      pageHeight: 841.8897637795276,
      pageMargin: 32,
      maxPages: 100,
    };

    expect(buildPdfPaginationScript(config)).toContain(JSON.stringify(config));
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
