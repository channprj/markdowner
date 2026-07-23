import { describe, expect, it, vi } from 'vitest';

import {
  PDF_PREVIEW_READY_MESSAGE,
  buildPdfPaginationScript,
  isPdfPreviewReadyMessage,
  paginatePdfDocument,
  planPdfLineBreaks,
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

  it('moves a fitting block out of a later page top inset', () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="inside-top-inset"></p></main>';
    const block = document.querySelector('#inside-top-inset') as HTMLElement;
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(205, 20));

    paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    expect(block.style.marginTop).toBe('17px');
  });

  it('never adds a whole-block top margin to a block taller than the usable page', () => {
    // Blocks taller than a page are split between their own line boxes (via
    // injected spacers), not nudged whole — a whole-block push would leave the
    // overflow to be sliced mid-line. With no measurable lines here (jsdom has
    // no layout) the split is a no-op, so the original margin must be untouched.
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

  it('splits direct text in a tall block that also has block children', () => {
    document.body.innerHTML = `
      <main class="markdowner-export">
        <div id="mixed">Leading text<div id="nested"></div></div>
      </main>
    `;
    const mixed = document.querySelector('#mixed') as HTMLElement;
    const nested = document.querySelector('#nested') as HTMLElement;
    vi.spyOn(mixed, 'getBoundingClientRect').mockReturnValue(rect(10, 300));
    vi.spyOn(nested, 'getBoundingClientRect').mockReturnValue(rect(20, 20));
    vi.spyOn(document, 'createRange').mockImplementation(
      () =>
        ({
          selectNodeContents: vi.fn(),
          setStart: vi.fn(),
          setEnd: vi.fn(),
          getClientRects: () => [rect(160, 20)],
        }) as unknown as Range,
    );

    paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    expect(
      mixed.querySelector(':scope > span[data-markdowner-pdf-spacer]'),
    ).not.toBeNull();
  });

  it('keeps rows in a tall table whole at page boundaries', () => {
    document.body.innerHTML = `
      <main class="markdowner-export">
        <table id="table">
          <tbody>
            <tr id="row-1"><td>First row</td></tr>
            <tr id="row-2"><td>Crossing row</td></tr>
          </tbody>
        </table>
      </main>
    `;
    const table = document.querySelector('#table') as HTMLTableElement;
    const firstRow = document.querySelector('#row-1') as HTMLTableRowElement;
    const crossingRow = document.querySelector('#row-2') as HTMLTableRowElement;
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(10, 260));
    vi.spyOn(firstRow, 'getBoundingClientRect').mockReturnValue(rect(20, 120));
    vi.spyOn(crossingRow, 'getBoundingClientRect').mockReturnValue(rect(140, 80));

    paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    const spacer = document.querySelector<HTMLTableRowElement>(
      'tr[data-markdowner-pdf-spacer]',
    );
    expect(spacer).not.toBeNull();
    expect(spacer?.nextElementSibling).toBe(crossingRow);
  });

  it('splits an oversized table cell between its own line boxes', () => {
    document.body.innerHTML = `
      <main class="markdowner-export">
        <table id="table">
          <tbody>
            <tr id="oversized-row"><td>Tall cell content</td></tr>
          </tbody>
        </table>
      </main>
    `;
    const table = document.querySelector('#table') as HTMLTableElement;
    const row = document.querySelector('#oversized-row') as HTMLTableRowElement;
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(10, 300));
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(20, 300));
    vi.spyOn(document, 'createRange').mockImplementation(
      () =>
        ({
          selectNodeContents: vi.fn(),
          getClientRects: () => [rect(160, 20)],
        }) as unknown as Range,
    );

    paginatePdfDocument(document, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    expect(
      document.querySelector('td > span[data-markdowner-pdf-spacer]'),
    ).not.toBeNull();
  });

  it('keeps table rows whole when paginating an iframe document', () => {
    document.body.innerHTML = '<iframe></iframe>';
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const frameDocument = frame.contentDocument as Document;
    frameDocument.body.innerHTML = `
      <main class="markdowner-export">
        <table id="table">
          <tbody>
            <tr id="row-1"><td>First row</td></tr>
            <tr id="row-2"><td>Crossing row</td></tr>
          </tbody>
        </table>
      </main>
    `;
    const table = frameDocument.querySelector('#table') as HTMLTableElement;
    const firstRow = frameDocument.querySelector('#row-1') as HTMLTableRowElement;
    const crossingRow = frameDocument.querySelector('#row-2') as HTMLTableRowElement;
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(10, 260));
    vi.spyOn(firstRow, 'getBoundingClientRect').mockReturnValue(rect(20, 120));
    vi.spyOn(crossingRow, 'getBoundingClientRect').mockReturnValue(rect(140, 80));
    vi.spyOn(frameDocument, 'createRange').mockImplementation(
      () =>
        ({
          selectNodeContents: vi.fn(),
          getClientRects: () => [],
        }) as unknown as Range,
    );

    paginatePdfDocument(frameDocument, {
      pageWidth: 160,
      pageHeight: 200,
      pageInsets,
      pageFurniture,
      maxPages: 100,
    });

    expect(
      frameDocument.querySelector('tr[data-markdowner-pdf-spacer]'),
    ).not.toBeNull();
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

  it('executes the serialized paginator with page furniture intact', async () => {
    document.body.innerHTML =
      '<main class="markdowner-export"><p id="runtime-content"></p></main>';
    const content = document.querySelector('#runtime-content') as HTMLElement;
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect(54, 20));
    const config = {
      token: 'runtime-token',
      pageWidth: 160,
      pageHeight: 200,
      pageInsets: { top: 32, right: 32, bottom: 32, left: 32 },
      pageFurniture: {
        headerText: 'Runtime header',
        headerAlignment: 'center' as const,
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

    window.eval(buildPdfPaginationScript(config));
    const runtimeWindow = window as typeof window & {
      __markdownerPaginatePdf: () => Promise<{
        totalHeight: number;
        pageCount: number;
      }>;
      __markdownerPdfPaginationStatus: string;
    };
    const result = await runtimeWindow.__markdownerPaginatePdf();

    expect(result.pageCount).toBe(1);
    expect(runtimeWindow.__markdownerPdfPaginationStatus).toBe('ready');
    expect(
      document.querySelector('[data-markdowner-pdf-decoration="page"]')
        ?.textContent,
    ).toContain('Runtime header');
    expect(
      document.querySelector('[data-markdowner-pdf-decoration="page"]')
        ?.textContent,
    ).toContain('1/1');
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

describe('planPdfLineBreaks', () => {
  // usable region per page is [pageStart + 10, pageStart + 90) for these values.
  const geometry = {
    pageHeight: 100,
    effectiveTop: 10,
    effectiveBottom: 10,
    usablePageHeight: 80,
  };

  it('leaves lines that stay inside a page untouched', () => {
    expect(
      planPdfLineBreaks(
        [
          { top: 10, bottom: 20 },
          { top: 20, bottom: 30 },
        ],
        geometry,
      ),
    ).toEqual([]);
  });

  it('nudges a line that straddles a page boundary to the next content top', () => {
    // The second line ends at 95, past page 0's usable bottom (90); it must drop
    // to page 1's content top (110), i.e. move down by 25.
    expect(
      planPdfLineBreaks(
        [
          { top: 10, bottom: 20 },
          { top: 85, bottom: 95 },
        ],
        geometry,
      ),
    ).toEqual([{ index: 1, delta: 25 }]);
  });

  it('nudges a line out of a later page top inset', () => {
    expect(planPdfLineBreaks([{ top: 105, bottom: 115 }], geometry)).toEqual([
      { index: 0, delta: 5 },
    ]);
  });

  it('accumulates earlier shifts when planning later boundaries', () => {
    // Line 0 shifts everything below it by 25; line 1 then lands at 190–200,
    // straddling page 1's boundary, so it needs a further 20px nudge.
    expect(
      planPdfLineBreaks(
        [
          { top: 85, bottom: 95 },
          { top: 165, bottom: 175 },
        ],
        geometry,
      ),
    ).toEqual([
      { index: 0, delta: 25 },
      { index: 1, delta: 20 },
    ]);
  });

  it('cannot rescue a single line taller than the usable page', () => {
    expect(planPdfLineBreaks([{ top: 50, bottom: 200 }], geometry)).toEqual([]);
  });
});
