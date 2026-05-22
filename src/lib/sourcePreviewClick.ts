import { clampSourceOffset, lineTextFromOffset } from './sourceText';

type CaretDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

type HorizontalPoint = {
  clientX: number;
};

export function readSourceNumber(element: HTMLElement, key: keyof DOMStringMap): number | null {
  const value = element.dataset[key];
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getRenderedTextOffset(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const ownerDocument = element.ownerDocument as CaretDocument;
  const caretPosition = ownerDocument.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition) {
    const offset = getTextOffsetWithinElement(
      element,
      caretPosition.offsetNode,
      caretPosition.offset,
    );
    if (offset !== null) return offset;
  }

  const caretRange = ownerDocument.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange) {
    const offset = getTextOffsetWithinElement(
      element,
      caretRange.startContainer,
      caretRange.startOffset,
    );
    if (offset !== null) return offset;
  }

  return null;
}

export function estimateRenderedTextOffset(
  element: HTMLElement,
  point: HorizontalPoint,
  renderedTextLength: number,
): number {
  if (renderedTextLength <= 0) return 0;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return 0;

  const ratio = Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));
  return Math.round(ratio * renderedTextLength);
}

export function mapRenderedTextOffsetToSourceOffset(
  element: HTMLElement,
  source: string,
  sourceOffset: number,
  sourceEndOffset: number,
  renderedOffset: number,
): number {
  return mapRenderedTextToSourceOffset(
    element.textContent ?? '',
    source,
    sourceOffset,
    sourceEndOffset,
    renderedOffset,
  );
}

export function resolveSourcePreviewSelectionOffset({
  source,
  lineStart,
  sourceOffset,
  sourceEndOffset,
  renderedText,
  renderedOffset,
}: {
  source: string;
  lineStart: number;
  sourceOffset: number | null;
  sourceEndOffset: number | null;
  renderedText: string;
  renderedOffset: number;
}): number {
  const lineText = lineTextFromOffset(source, lineStart);
  const rawStart = sourceOffset ?? lineStart;
  const rawEnd = sourceEndOffset ?? lineStart + lineText.length;

  return mapRenderedTextToSourceOffset(
    renderedText,
    source,
    rawStart,
    rawEnd,
    renderedOffset,
  );
}

function mapRenderedTextToSourceOffset(
  renderedText: string,
  source: string,
  sourceOffset: number,
  sourceEndOffset: number,
  renderedOffset: number,
): number {
  const rawStart = clampSourceOffset(sourceOffset, source.length);
  const rawEnd = Math.max(rawStart, clampSourceOffset(sourceEndOffset, source.length));
  const rawText = source.slice(rawStart, rawEnd);

  if (renderedText.length > 0) {
    const renderedTextStart = rawText.indexOf(renderedText);
    if (renderedTextStart >= 0) {
      return clampSourceOffset(rawStart + renderedTextStart + renderedOffset, source.length);
    }
  }

  return clampSourceOffset(rawStart + renderedOffset, source.length);
}

function getTextLength(node: Node): number {
  return node.textContent?.length ?? 0;
}

function getTextOffsetWithinElement(
  root: HTMLElement,
  targetNode: Node,
  targetOffset: number,
): number | null {
  if (!root.contains(targetNode)) return null;

  const nodeFilter = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, nodeFilter);
  let offset = 0;

  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (currentNode === targetNode) {
      return offset + Math.max(0, Math.min(targetOffset, getTextLength(currentNode)));
    }
    offset += getTextLength(currentNode);
  }

  if (targetNode instanceof HTMLElement && root.contains(targetNode)) {
    return Array.from(targetNode.childNodes)
      .slice(0, targetOffset)
      .reduce((total, childNode) => total + getTextLength(childNode), offset);
  }

  return null;
}
