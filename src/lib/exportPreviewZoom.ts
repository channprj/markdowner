import type { ResolvedPdfPaper } from './pdfPaper';

export const PREVIEW_ZOOM_MIN_PERCENT = 25;
export const PREVIEW_ZOOM_MAX_PERCENT = 200;
export const PREVIEW_ZOOM_STEP_PERCENT = 10;

export type PreviewZoomDirection = 'in' | 'out';

export interface PreviewSize {
  width: number;
  height: number;
}

export function previewPageSize(
  paper: Pick<ResolvedPdfPaper, 'widthPt' | 'heightPt'>,
): PreviewSize {
  return { width: paper.widthPt, height: paper.heightPt };
}

export function fitPreviewZoomPercent(viewport: PreviewSize, page: PreviewSize): number {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    page.width <= 0 ||
    page.height <= 0
  ) {
    return 100;
  }

  return Math.max(
    1,
    Math.floor(Math.min(viewport.width / page.width, viewport.height / page.height, 1) * 100),
  );
}

export function clampPreviewZoomPercent(percent: number): number {
  return Math.min(PREVIEW_ZOOM_MAX_PERCENT, Math.max(PREVIEW_ZOOM_MIN_PERCENT, percent));
}

export function stepPreviewZoomPercent(
  current: number,
  direction: PreviewZoomDirection,
): number {
  const stepped =
    direction === 'in'
      ? Math.floor(current / PREVIEW_ZOOM_STEP_PERCENT + 1) * PREVIEW_ZOOM_STEP_PERCENT
      : Math.ceil(current / PREVIEW_ZOOM_STEP_PERCENT - 1) * PREVIEW_ZOOM_STEP_PERCENT;

  return clampPreviewZoomPercent(stepped);
}
