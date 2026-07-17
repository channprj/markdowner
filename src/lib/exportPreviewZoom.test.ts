import { describe, expect, it } from 'vitest';

import {
  PREVIEW_ZOOM_MAX_PERCENT,
  PREVIEW_ZOOM_MIN_PERCENT,
  clampPreviewZoomPercent,
  fitPreviewZoomPercent,
  previewPageSize,
  stepPreviewZoomPercent,
} from './exportPreviewZoom';

describe('exportPreviewZoom', () => {
  const a4 = previewPageSize({
    widthPt: 595.275590551,
    heightPt: 841.88976378,
  });

  it('uses resolved portrait and landscape point dimensions', () => {
    expect(a4).toEqual({
      width: 595.275590551,
      height: 841.88976378,
    });
    expect(previewPageSize({ widthPt: 841.88976378, heightPt: 595.275590551 })).toEqual({
      width: 841.88976378,
      height: 595.275590551,
    });
  });

  it.each([
    ['width-bound', { width: a4.width * 0.5, height: 1000 }, 50],
    ['height-bound', { width: 760, height: a4.height * 0.5 }, 50],
    ['capped at 100%', { width: a4.width * 2, height: a4.height * 2 }, 100],
    ['unmeasurable width', { width: 0, height: 500 }, 100],
  ])('calculates an A4 Fit zoom for a %s viewport', (_case, viewport, expected) => {
    expect(fitPreviewZoomPercent(viewport, a4)).toBe(expected);
  });

  it('allows Fit to shrink below the manual minimum', () => {
    expect(fitPreviewZoomPercent({ width: a4.width * 0.1, height: a4.height * 0.1 }, a4)).toBe(
      10,
    );
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
