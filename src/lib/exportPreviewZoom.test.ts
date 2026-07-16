import { describe, expect, it } from 'vitest';

import {
  PREVIEW_PAGE_WIDTH_PX,
  PREVIEW_ZOOM_MAX_PERCENT,
  PREVIEW_ZOOM_MIN_PERCENT,
  clampPreviewZoomPercent,
  fitPreviewZoomPercent,
  previewPageSize,
  stepPreviewZoomPercent,
} from './exportPreviewZoom';

describe('exportPreviewZoom', () => {
  it('derives A4 and Letter page heights from the 760px base width', () => {
    expect(previewPageSize('A4')).toEqual({
      width: PREVIEW_PAGE_WIDTH_PX,
      height: PREVIEW_PAGE_WIDTH_PX * (297 / 210),
    });
    expect(previewPageSize('Letter')).toEqual({
      width: PREVIEW_PAGE_WIDTH_PX,
      height: PREVIEW_PAGE_WIDTH_PX * (11 / 8.5),
    });
  });

  it.each([
    ['width-bound', { width: 380, height: 1000 }, 50],
    [
      'height-bound',
      { width: 760, height: PREVIEW_PAGE_WIDTH_PX * (297 / 210) * 0.5 },
      50,
    ],
    [
      'capped at 100%',
      { width: 1520, height: PREVIEW_PAGE_WIDTH_PX * (297 / 210) * 2 },
      100,
    ],
    ['unmeasurable width', { width: 0, height: 500 }, 100],
  ])('calculates an A4 Fit zoom for a %s viewport', (_case, viewport, expected) => {
    expect(fitPreviewZoomPercent(viewport, previewPageSize('A4'))).toBe(expected);
  });

  it('allows Fit to shrink below the manual minimum', () => {
    expect(fitPreviewZoomPercent({ width: 76, height: 108 }, previewPageSize('A4'))).toBe(10);
  });

  it('rounds irregular Fit values to manual 10% steps', () => {
    expect(stepPreviewZoomPercent(53, 'out')).toBe(50);
    expect(stepPreviewZoomPercent(53, 'in')).toBe(60);
    expect(stepPreviewZoomPercent(60, 'out')).toBe(50);
    expect(stepPreviewZoomPercent(60, 'in')).toBe(70);
  });

  it('clamps manual zoom to 25–200%', () => {
    expect(clampPreviewZoomPercent(1)).toBe(PREVIEW_ZOOM_MIN_PERCENT);
    expect(clampPreviewZoomPercent(250)).toBe(PREVIEW_ZOOM_MAX_PERCENT);
    expect(stepPreviewZoomPercent(PREVIEW_ZOOM_MIN_PERCENT, 'out')).toBe(
      PREVIEW_ZOOM_MIN_PERCENT,
    );
    expect(stepPreviewZoomPercent(PREVIEW_ZOOM_MAX_PERCENT, 'in')).toBe(
      PREVIEW_ZOOM_MAX_PERCENT,
    );
  });
});
