import {
  formatPageNumber,
  pageDecorationBandHeights,
  validatePdfPageGeometry,
  type PdfPageFurniture,
  type PdfPageInsets,
} from './exportPageLayout';
import { MAX_PDF_PAGES } from './pdfPaper';

export const PDF_PREVIEW_CONFIG_MESSAGE = 'markdowner:pdf-preview-config';
export const PDF_PREVIEW_READY_MESSAGE = 'markdowner:pdf-preview-ready';
export const PDF_PREVIEW_ERROR_MESSAGE = 'markdowner:pdf-preview-error';

export interface PdfPaginationOptions {
  pageWidth: number;
  pageHeight: number;
  pageInsets: PdfPageInsets;
  pageFurniture: PdfPageFurniture;
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
  pageInsets: PdfPageInsets;
  pageFurniture: PdfPageFurniture;
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
  const pageWidth = Number(options.pageWidth);
  const pageHeight = Number(options.pageHeight);
  const pageInsets = {
    top: Number(options.pageInsets?.top),
    right: Number(options.pageInsets?.right),
    bottom: Number(options.pageInsets?.bottom),
    left: Number(options.pageInsets?.left),
  };
  const pageFurniture = options.pageFurniture;
  const maxPages = Math.floor(Number(options.maxPages));
  if (!pageFurniture || !Number.isFinite(maxPages) || maxPages < 1) {
    throw new Error('Invalid PDF pagination geometry.');
  }
  const geometry = validatePdfPageGeometry(pageWidth, pageHeight, {
    contentPaddingTop: pageInsets.top,
    contentPaddingRight: pageInsets.right,
    contentPaddingBottom: pageInsets.bottom,
    contentPaddingLeft: pageInsets.left,
    headerText: pageFurniture.headerText,
    headerAlignment: pageFurniture.headerAlignment,
    footerText: pageFurniture.footerText,
    footerAlignment: pageFurniture.footerAlignment,
    pageNumbersEnabled: pageFurniture.pageNumbersEnabled,
    pageNumberPosition: pageFurniture.pageNumberPosition,
  });
  if (!geometry.valid) throw new Error(geometry.message);
  const bands = pageDecorationBandHeights(pageFurniture);
  const effectiveTop = pageInsets.top + bands.top;
  const effectiveBottom = pageInsets.bottom + bands.bottom;

  const container =
    (doc.querySelector('.markdowner-export') as HTMLElement | null) ?? doc.body;
  for (const child of Array.from(container.children)) {
    if ((child as HTMLElement).dataset.markdownerPdfDecoration === 'page') {
      child.remove();
    }
  }
  container.style.boxSizing = 'border-box';
  container.style.margin = '0';
  container.style.padding = `${effectiveTop}px ${pageInsets.right}px 0 ${pageInsets.left}px`;
  container.style.position = 'relative';
  container.style.width = `${pageWidth}px`;

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

  const usablePageHeight = pageHeight - effectiveTop - effectiveBottom;
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
      const usableBottom = pageStart + pageHeight - effectiveBottom;
      if (top + height > usableBottom) {
        const targetTop = pageStart + pageHeight + effectiveTop;
        movement = targetTop - top;
        const computedMargin = doc.defaultView?.getComputedStyle(element).marginTop ?? '';
        const currentMargin = Number.parseFloat(computedMargin) || 0;
        element.style.marginTop = `${currentMargin + movement}px`;
      }
    }
    measuredBottom = Math.max(
      measuredBottom,
      top + height + movement + effectiveBottom,
    );
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

  const alignmentIndex = { left: 0, center: 1, right: 2 };
  const alignmentStyle = {
    left: { alignItems: 'flex-start', textAlign: 'left' },
    center: { alignItems: 'center', textAlign: 'center' },
    right: { alignItems: 'flex-end', textAlign: 'right' },
  };
  const createBand = (
    layer: HTMLElement,
    band: 'top' | 'bottom',
    height: number,
  ) => {
    if (height <= 0) return null;
    const row = doc.createElement('div');
    row.dataset.markdownerPdfDecorationBand = band;
    row.style.position = 'absolute';
    row.style.left = `${pageInsets.left}px`;
    row.style.right = `${pageInsets.right}px`;
    row.style.height = `${height}px`;
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    row.style.columnGap = '8px';
    if (band === 'top') row.style.top = `${pageInsets.top}px`;
    else row.style.bottom = `${pageInsets.bottom}px`;
    const cells = (['left', 'center', 'right'] as const).map((alignment) => {
      const cell = doc.createElement('div');
      cell.style.gridColumn = String(alignmentIndex[alignment] + 1);
      cell.style.minWidth = '0';
      cell.style.display = 'flex';
      cell.style.flexDirection = 'column';
      cell.style.justifyContent = band === 'top' ? 'flex-start' : 'flex-end';
      cell.style.gap = '4px';
      cell.style.alignItems = alignmentStyle[alignment].alignItems;
      cell.style.textAlign = alignmentStyle[alignment].textAlign;
      row.appendChild(cell);
      return cell;
    });
    layer.appendChild(row);
    return cells;
  };
  const appendText = (
    cells: HTMLElement[] | null,
    alignment: 'left' | 'center' | 'right',
    text: string,
    role: string,
  ) => {
    if (!cells || !text) return;
    const item = doc.createElement('span');
    item.dataset.markdownerPdfDecorationRole = role;
    item.textContent = text;
    item.style.display = 'block';
    item.style.maxWidth = '100%';
    item.style.overflow = 'hidden';
    item.style.textOverflow = 'ellipsis';
    item.style.whiteSpace = 'nowrap';
    item.style.lineHeight = '16px';
    cells[alignmentIndex[alignment]].appendChild(item);
  };
  const numberParts = pageFurniture.pageNumberPosition.split('-');
  const numberBand = numberParts[0] as 'top' | 'bottom';
  const numberAlignment = numberParts[1] as 'left' | 'center' | 'right';
  const topBandHeight = Math.max(0, bands.top - 6);
  const bottomBandHeight = Math.max(0, bands.bottom - 6);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const layer = doc.createElement('div');
    layer.dataset.markdownerPdfDecoration = 'page';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.position = 'absolute';
    layer.style.boxSizing = 'border-box';
    layer.style.pointerEvents = 'none';
    layer.style.overflow = 'hidden';
    layer.style.left = '0';
    layer.style.top = `${pageIndex * pageHeight}px`;
    layer.style.width = `${pageWidth}px`;
    layer.style.height = `${pageHeight}px`;
    layer.style.color = pageFurniture.textColor;
    layer.style.fontFamily = pageFurniture.fontFamily;
    layer.style.fontSize = '10px';
    layer.style.fontWeight = '400';
    layer.style.zIndex = '1';
    const topCells = createBand(layer, 'top', topBandHeight);
    const bottomCells = createBand(layer, 'bottom', bottomBandHeight);
    appendText(
      topCells,
      pageFurniture.headerAlignment,
      pageFurniture.headerText.trim(),
      'header',
    );
    appendText(
      bottomCells,
      pageFurniture.footerAlignment,
      pageFurniture.footerText.trim(),
      'footer',
    );
    if (pageFurniture.pageNumbersEnabled) {
      appendText(
        numberBand === 'top' ? topCells : bottomCells,
        numberAlignment,
        formatPageNumber(
          pageFurniture.pageNumberTemplate,
          pageIndex + 1,
          pageCount,
        ),
        'page-number',
      );
    }
    container.appendChild(layer);
  }
  return { totalHeight, pageCount };
}

export function buildPdfPaginationScript(config: PdfPaginationRuntimeConfig): string {
  const serialized = JSON.stringify(config).replace(/</g, '\\u003c');
  const paginator = paginatePdfDocument.toString();
  const formatNumber = formatPageNumber.toString();
  const decorationBands = pageDecorationBandHeights.toString();
  const validateGeometry = validatePdfPageGeometry.toString();
  return `(function () {
  "use strict";
  var config = ${serialized};
  var formatPageNumber = ${formatNumber};
  var pageDecorationBandHeights = ${decorationBands};
  var validatePdfPageGeometry = ${validateGeometry};
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
          pageWidth: config.pageWidth,
          pageHeight: config.pageHeight,
          pageInsets: config.pageInsets,
          pageFurniture: config.pageFurniture,
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
    }).catch(function () {
      parent.postMessage({
        type: "${PDF_PREVIEW_ERROR_MESSAGE}",
        token: config.token,
        pageIndex: data.pageIndex
      }, "*");
    });
  });
  run().catch(function () {});
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
