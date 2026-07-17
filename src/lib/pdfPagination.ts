import { MAX_PDF_PAGES } from './pdfPaper';

export const PDF_PREVIEW_CONFIG_MESSAGE = 'markdowner:pdf-preview-config';
export const PDF_PREVIEW_READY_MESSAGE = 'markdowner:pdf-preview-ready';

export interface PdfPaginationOptions {
  pageHeight: number;
  pageMargin: number;
  maxPages: number;
}

export interface PdfPaginationResult {
  totalHeight: number;
  pageCount: number;
}

export interface PdfPaginationRuntimeConfig {
  token: string;
  pageWidth: number;
  pageHeight: number;
  pageMargin: number;
  maxPages: number;
}

export interface PdfPreviewReadyMessage {
  type: typeof PDF_PREVIEW_READY_MESSAGE;
  token: string;
  pageIndex: number;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
}

export function paginatePdfDocument(
  doc: Document,
  options: PdfPaginationOptions,
): PdfPaginationResult {
  const pageHeight = Number(options.pageHeight);
  const pageMargin = Number(options.pageMargin);
  const maxPages = Math.floor(Number(options.maxPages));
  if (
    !Number.isFinite(pageHeight) ||
    pageHeight <= 0 ||
    !Number.isFinite(pageMargin) ||
    pageMargin < 0 ||
    pageMargin * 2 >= pageHeight ||
    !Number.isFinite(maxPages) ||
    maxPages < 1
  ) {
    throw new Error('Invalid PDF pagination geometry.');
  }

  const container =
    (doc.querySelector('.markdowner-export') as HTMLElement | null) ?? doc.body;
  container.style.boxSizing = 'border-box';
  container.style.margin = '0';
  container.style.padding = `${pageMargin}px ${pageMargin}px 0 ${pageMargin}px`;

  const children = Array.from(container.children) as HTMLElement[];
  const originalMarginAttribute = 'data-markdowner-pdf-margin-top';
  for (const element of children) {
    if (!element.getBoundingClientRect) continue;
    if (!element.hasAttribute(originalMarginAttribute)) {
      element.setAttribute(originalMarginAttribute, element.style.marginTop);
    } else {
      element.style.marginTop = element.getAttribute(originalMarginAttribute) ?? '';
    }
  }

  const usablePageHeight = pageHeight - pageMargin * 2;
  const scrollY = doc.defaultView?.scrollY ?? 0;
  let measuredBottom = pageHeight;
  for (const element of children) {
    if (!element.getBoundingClientRect) continue;
    const rect = element.getBoundingClientRect();
    const top = rect.top + scrollY;
    const height = rect.height;
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) continue;

    let movement = 0;
    if (height <= usablePageHeight) {
      const pageStart = Math.floor(top / pageHeight) * pageHeight;
      const usableBottom = pageStart + pageHeight - pageMargin;
      if (top + height > usableBottom) {
        const targetTop = pageStart + pageHeight + pageMargin;
        movement = targetTop - top;
        const computedMargin = doc.defaultView?.getComputedStyle(element).marginTop ?? '';
        const currentMargin = Number.parseFloat(computedMargin) || 0;
        element.style.marginTop = `${currentMargin + movement}px`;
      }
    }
    measuredBottom = Math.max(measuredBottom, top + height + movement + pageMargin);
  }

  const totalHeight = Math.max(
    pageHeight,
    measuredBottom,
    doc.body?.scrollHeight ?? 0,
    doc.documentElement?.scrollHeight ?? 0,
  );
  const pageCount = Math.max(1, Math.ceil(totalHeight / pageHeight));
  if (pageCount > maxPages) {
    throw new Error(`PDF export exceeds the ${maxPages} pages limit.`);
  }
  return { totalHeight, pageCount };
}

export function buildPdfPaginationScript(config: PdfPaginationRuntimeConfig): string {
  const serialized = JSON.stringify(config).replaceAll('<', '\\u003c');
  const paginator = paginatePdfDocument.toString();
  return `(function () {
  "use strict";
  var config = ${serialized};
  var paginate = ${paginator};
  var running = null;
  function waitForAssets() {
    var fonts = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    var images = Array.prototype.map.call(document.images, function (image) {
      if (image.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    });
    return Promise.all([fonts].concat(images));
  }
  function run() {
    if (!running) {
      running = waitForAssets().then(function () {
        var result = paginate(document, {
          pageHeight: config.pageHeight,
          pageMargin: config.pageMargin,
          maxPages: config.maxPages
        });
        window.__markdownerPdfPaginationResult = result;
        window.__markdownerPdfPaginationStatus = "ready";
        return result;
      }).catch(function (error) {
        window.__markdownerPdfPaginationStatus = "error";
        window.__markdownerPdfPaginationError = String(error);
        throw error;
      });
    }
    return running;
  }
  window.__markdownerPaginatePdf = run;
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "${PDF_PREVIEW_CONFIG_MESSAGE}" ||
        data.token !== config.token) return;
    run().then(function (result) {
      var container = document.querySelector(".markdowner-export") || document.body;
      container.style.transform =
        "translateY(-" + (data.pageIndex * config.pageHeight) + "px)";
      container.style.transformOrigin = "top left";
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      parent.postMessage({
        type: "${PDF_PREVIEW_READY_MESSAGE}",
        token: config.token,
        pageIndex: data.pageIndex,
        pageCount: result.pageCount,
        pageWidth: config.pageWidth,
        pageHeight: config.pageHeight
      }, "*");
    });
  });
  run();
})();`;
}

export function isPdfPreviewReadyMessage(
  value: unknown,
  expectedToken: string,
): value is PdfPreviewReadyMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    'pageCount',
    'pageHeight',
    'pageIndex',
    'pageWidth',
    'token',
    'type',
  ];
  const actualKeys = Object.keys(candidate).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  const pageIndex = candidate.pageIndex;
  const pageCount = candidate.pageCount;
  const pageWidth = candidate.pageWidth;
  const pageHeight = candidate.pageHeight;
  return (
    candidate.type === PDF_PREVIEW_READY_MESSAGE &&
    candidate.token === expectedToken &&
    Number.isInteger(pageIndex) &&
    Number.isInteger(pageCount) &&
    (pageIndex as number) >= 0 &&
    (pageCount as number) >= 1 &&
    (pageCount as number) <= MAX_PDF_PAGES &&
    (pageIndex as number) < (pageCount as number) &&
    typeof pageWidth === 'number' &&
    Number.isFinite(pageWidth) &&
    pageWidth > 0 &&
    typeof pageHeight === 'number' &&
    Number.isFinite(pageHeight) &&
    pageHeight > 0
  );
}
