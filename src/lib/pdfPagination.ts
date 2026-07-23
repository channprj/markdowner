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

export interface PdfLineBox {
  top: number;
  bottom: number;
}

export interface PdfLineBreakGeometry {
  pageHeight: number;
  effectiveTop: number;
  effectiveBottom: number;
  usablePageHeight: number;
}

export interface PdfLineBreakPush {
  index: number;
  delta: number;
}

/**
 * Decide how to keep a block taller than one page from being sliced mid-line.
 * Given each line box's vertical extent (document Y, in order), return which
 * lines must drop onto the next page and by how much, so no line box straddles
 * a fixed page-slice boundary. Pure geometry so it can be unit-tested; the DOM
 * line collection and spacer insertion around it only run in a layout engine.
 */
export function planPdfLineBreaks(
  lines: readonly PdfLineBox[],
  geometry: PdfLineBreakGeometry,
): PdfLineBreakPush[] {
  const { pageHeight, effectiveTop, effectiveBottom, usablePageHeight } = geometry;
  const pushes: PdfLineBreakPush[] = [];
  let shift = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineHeight = lines[index].bottom - lines[index].top;
    // A single line taller than the usable page can't be rescued by nudging.
    if (!(lineHeight > 0) || lineHeight > usablePageHeight) continue;
    const top = lines[index].top + shift;
    const bottom = lines[index].bottom + shift;
    const pageStart = Math.floor(top / pageHeight) * pageHeight;
    const usableTop = pageStart + effectiveTop;
    const usableBottom = pageStart + pageHeight - effectiveBottom;
    if ((pageStart > 0 && top < usableTop) || bottom > usableBottom) {
      const targetTop =
        pageStart > 0 && top < usableTop
          ? usableTop
          : pageStart + pageHeight + effectiveTop;
      const delta = targetTop - top;
      if (delta > 0.5) {
        pushes.push({ index, delta });
        shift += delta;
      }
    }
  }
  return pushes;
}

interface CollectedLineBox {
  top: number;
  bottom: number;
  node: Text;
  lineIndex: number;
}

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

export interface PdfPaginationHelpers {
  formatPageNumber: typeof formatPageNumber;
  pageDecorationBandHeights: typeof pageDecorationBandHeights;
  validatePdfPageGeometry: typeof validatePdfPageGeometry;
  planPdfLineBreaks: typeof planPdfLineBreaks;
}

export function paginatePdfDocument(
  doc: Document,
  options: PdfPaginationOptions,
  helpers: PdfPaginationHelpers = {
    formatPageNumber,
    pageDecorationBandHeights,
    validatePdfPageGeometry,
    planPdfLineBreaks,
  },
): PdfPaginationResult {
  const {
    formatPageNumber: formatNumber,
    pageDecorationBandHeights: decorationBandHeights,
    validatePdfPageGeometry: validateGeometry,
    planPdfLineBreaks: planLineBreaks,
  } = helpers;
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
  const geometry = validateGeometry(pageWidth, pageHeight, {
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
  const bands = decorationBandHeights(pageFurniture);
  const effectiveTop = pageInsets.top + bands.top;
  const effectiveBottom = pageInsets.bottom + bands.bottom;

  const win = doc.defaultView;
  const scrollY = win?.scrollY ?? 0;
  const usablePageHeight = pageHeight - effectiveTop - effectiveBottom;
  const marginAttribute = 'data-markdowner-pdf-margin-top';
  const spacerAttribute = 'data-markdowner-pdf-spacer';
  const lineEpsilon = 2;

  const container =
    (doc.querySelector('.markdowner-export') as HTMLElement | null) ?? doc.body;

  // Undo the previous run so pagination stays idempotent: drop page decorations
  // and injected line spacers, re-merge the text nodes those spacers split, and
  // restore any margins we added to push a block onto a later page.
  for (const artifact of Array.from(
    container.querySelectorAll(
      `[data-markdowner-pdf-decoration="page"],[${spacerAttribute}]`,
    ),
  )) {
    artifact.remove();
  }
  container.normalize();
  for (const restored of Array.from(
    container.querySelectorAll<HTMLElement>(`[${marginAttribute}]`),
  )) {
    restored.style.marginTop = restored.getAttribute(marginAttribute) ?? '';
  }

  container.style.boxSizing = 'border-box';
  container.style.margin = '0';
  container.style.padding = `${effectiveTop}px ${pageInsets.right}px 0 ${pageInsets.left}px`;
  container.style.position = 'relative';
  container.style.width = `${pageWidth}px`;

  const children = Array.from(container.children) as HTMLElement[];

  const isFlowBlock = (element: Element): boolean => {
    if (!win) return true;
    const display = win.getComputedStyle(element).display;
    return (
      display === 'block' ||
      display === 'list-item' ||
      display === 'flex' ||
      display === 'grid' ||
      display === 'flow-root'
    );
  };

  const pushDown = (element: HTMLElement, delta: number) => {
    if (!element.hasAttribute(marginAttribute)) {
      element.setAttribute(marginAttribute, element.style.marginTop);
    }
    const currentMargin =
      Number.parseFloat(win?.getComputedStyle(element).marginTop ?? '') || 0;
    element.style.marginTop = `${currentMargin + delta}px`;
  };

  // Enumerate a block's leaf line boxes in document order (document Y). Nested
  // tables are handled by the row-aware path instead of being flattened here.
  const collectLineBoxes = (block: HTMLElement): CollectedLineBox[] => {
    const lines: CollectedLineBox[] = [];
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(candidate) {
        const text = candidate as Text;
        if (!text.data || text.data.trim() === '') return NodeFilter.FILTER_REJECT;
        let ancestor: Node | null = text.parentNode;
        while (ancestor && ancestor !== block) {
          if (ancestor.nodeType === 1) {
            const element = ancestor as HTMLElement;
            if (element.tagName === 'TABLE') return NodeFilter.FILTER_REJECT;
            if (element.hasAttribute(spacerAttribute)) return NodeFilter.FILTER_REJECT;
          }
          ancestor = ancestor.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let current: CollectedLineBox | null = null;
    let node = walker.nextNode() as Text | null;
    while (node) {
      const range = doc.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      for (let index = 0; index < rects.length; index += 1) {
        const box = rects[index];
        if (!box || box.height <= 0) continue;
        const top = box.top + scrollY;
        const bottom = box.bottom + scrollY;
        if (current && top < current.bottom - lineEpsilon) {
          // Continuation of the current visual line (baseline-aligned rects).
          current.top = Math.min(current.top, top);
          current.bottom = Math.max(current.bottom, bottom);
        } else {
          current = { top, bottom, node, lineIndex: index };
          lines.push(current);
        }
      }
      node = walker.nextNode() as Text | null;
    }
    return lines;
  };

  // Character offset where a text node's Nth line box begins, located by the
  // monotonic client-rect count so per-glyph height jitter can't mislead it.
  const lineStartOffset = (node: Text, lineIndex: number): number => {
    if (lineIndex <= 0) return 0;
    const rectCountUpTo = (offset: number): number => {
      const range = doc.createRange();
      range.setStart(node, 0);
      range.setEnd(node, offset);
      return range.getClientRects().length;
    };
    let low = 1;
    let high = node.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (rectCountUpTo(mid) >= lineIndex + 1) high = mid;
      else low = mid + 1;
    }
    return Math.max(0, low - 1);
  };

  // Insert a full-width, zero-content spacer at a line start so that line — and
  // everything after it — drops to the next page's content top.
  const insertLineSpacer = (node: Text, offset: number, height: number) => {
    const anchor = offset > 0 && offset < node.length ? node.splitText(offset) : node;
    const parent = anchor.parentNode;
    if (!parent) return;
    const spacer = doc.createElement('span');
    spacer.setAttribute(spacerAttribute, '');
    spacer.setAttribute('aria-hidden', 'true');
    const style = spacer.style;
    style.display = 'inline-block';
    style.width = '100%';
    style.height = `${height}px`;
    style.verticalAlign = 'top';
    style.lineHeight = '0';
    style.fontSize = '0';
    style.margin = '0';
    style.padding = '0';
    parent.insertBefore(spacer, anchor);
  };

  const insertTableSpacer = (row: HTMLTableRowElement, height: number) => {
    const parent = row.parentNode;
    if (!parent) return;
    const table = row.closest('table');
    const columnCount = Math.max(
      1,
      ...Array.from(table?.rows ?? []).map((tableRow) =>
        Array.from(tableRow.cells).reduce(
          (count, cell) => count + Math.max(1, cell.colSpan),
          0,
        ),
      ),
    );
    const spacer = doc.createElement('tr');
    spacer.setAttribute(spacerAttribute, '');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${height}px`;
    const cell = doc.createElement('td');
    cell.colSpan = columnCount;
    cell.style.boxSizing = 'border-box';
    cell.style.height = `${height}px`;
    cell.style.padding = '0';
    cell.style.border = '0';
    cell.style.fontSize = '0';
    cell.style.lineHeight = '0';
    spacer.appendChild(cell);
    parent.insertBefore(spacer, row);
  };

  // Split a leaf/inline block between its own line boxes so no line straddles a
  // page boundary. Spacers go in bottom-up so earlier offsets stay valid.
  const breakLeafByLines = (block: HTMLElement) => {
    const lines = collectLineBoxes(block);
    if (lines.length === 0) return;
    const pushes = planLineBreaks(
      lines.map((line) => ({ top: line.top, bottom: line.bottom })),
      { pageHeight, effectiveTop, effectiveBottom, usablePageHeight },
    );
    for (let index = pushes.length - 1; index >= 0; index -= 1) {
      const line = lines[pushes[index].index];
      insertLineSpacer(
        line.node,
        lineStartOffset(line.node, line.lineIndex),
        pushes[index].delta,
      );
    }
  };

  const breakTableByRows = (table: HTMLTableElement) => {
    const rows = Array.from(table.rows).filter(
      (row) => !row.hasAttribute(spacerAttribute),
    );
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const top = rect.top + scrollY;
      const bottom = rect.bottom + scrollY;
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) continue;
      if (bottom - top > usablePageHeight) {
        for (const cell of Array.from(row.cells)) breakLeafByLines(cell);
        continue;
      }
      const [push] = planLineBreaks(
        [{ top, bottom }],
        { pageHeight, effectiveTop, effectiveBottom, usablePageHeight },
      );
      if (push) insertTableSpacer(row, push.delta);
    }
  };

  // Place top-level (and, recursively, nested) blocks so none is sliced through
  // a page boundary: a block that fits is nudged whole onto the next page; a
  // block taller than a page recurses into uniform block children, or is split
  // between its line boxes when its content is leaf/inline.
  function place(list: HTMLElement[]): void {
    for (const element of list) {
      if (!element.getBoundingClientRect) continue;
      const rect = element.getBoundingClientRect();
      const top = rect.top + scrollY;
      const height = rect.height;
      if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) continue;
      if (height <= usablePageHeight) {
        const [push] = planLineBreaks(
          [{ top, bottom: top + height }],
          { pageHeight, effectiveTop, effectiveBottom, usablePageHeight },
        );
        if (push) pushDown(element, push.delta);
        continue;
      }
      if (element.tagName === 'TABLE') {
        breakTableByRows(element as HTMLTableElement);
        continue;
      }
      const kids = Array.from(element.children).filter(
        (child): child is HTMLElement =>
          child.namespaceURI === 'http://www.w3.org/1999/xhtml',
      );
      if (kids.length > 0 && kids.every(isFlowBlock)) {
        place(kids);
        const hasDirectText = Array.from(element.childNodes).some(
          (child) => child.nodeType === 3 && child.textContent?.trim(),
        );
        if (hasDirectText) breakLeafByLines(element);
      } else {
        breakLeafByLines(element);
      }
    }
  }

  place(children);

  let measuredBottom = pageHeight;
  for (const element of children) {
    if (!element.getBoundingClientRect) continue;
    const rect = element.getBoundingClientRect();
    const bottom = rect.top + scrollY + rect.height;
    if (Number.isFinite(bottom)) {
      measuredBottom = Math.max(measuredBottom, bottom + effectiveBottom);
    }
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
        formatNumber(
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
  const planLineBreaks = planPdfLineBreaks.toString();
  return `(function () {
  "use strict";
  var config = ${serialized};
  var formatPageNumber = ${formatNumber};
  var pageDecorationBandHeights = ${decorationBands};
  var validatePdfPageGeometry = ${validateGeometry};
  var planPdfLineBreaks = ${planLineBreaks};
  var paginationHelpers = {
    formatPageNumber: formatPageNumber,
    pageDecorationBandHeights: pageDecorationBandHeights,
    validatePdfPageGeometry: validatePdfPageGeometry,
    planPdfLineBreaks: planPdfLineBreaks
  };
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
        }, paginationHelpers);
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
