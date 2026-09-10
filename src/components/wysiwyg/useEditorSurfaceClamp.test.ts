import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

import { clampAxisDelta, useEditorSurfaceClamp } from './useEditorSurfaceClamp';

it('moves an edge-clamped toolbar below the active line instead of covering it', () => {
  const dom = document.createElement('div');
  const panel = document.createElement('div');
  vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 500));
  // A 40px toolbar originally above the line at y=110..130.
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 60, 300, 40));
  const editor = {
    state: { selection: { head: 1, from: 1, to: 1 } },
    view: { dom, coordsAtPos: () => ({ left: 300, right: 300, top: 110, bottom: 130 }) },
  } as unknown as Editor;
  const panelRef = { current: panel };
  const { result } = renderHook(() => useEditorSurfaceClamp(editor, panelRef, 1));
  expect(60 + result.current.dy).toBeGreaterThanOrEqual(138);
});

/**
 * The clamp math that keeps floating editor popovers inside the editor surface.
 * `clampAxisDelta(start, end, min, max, margin)` returns the offset to ADD to
 * the popover so [start, end] fits within [min + margin, max - margin].
 */
describe('clampAxisDelta', () => {
  const MIN = 100;
  const MAX = 500;
  const MARGIN = 8;
  // Usable band: [108, 492].

  it('returns 0 when the popover is fully inside the bounds', () => {
    expect(clampAxisDelta(200, 300, MIN, MAX, MARGIN)).toBe(0);
  });

  it('shifts right (positive) when overflowing the low edge', () => {
    // Popover [80, 180] → left edge 80 < 108, shift +28 so left lands on 108.
    expect(clampAxisDelta(80, 180, MIN, MAX, MARGIN)).toBe(28);
  });

  it('shifts left (negative) when overflowing the high edge', () => {
    // Popover [420, 520] → right edge 520 > 492, shift -28 so right lands on 492.
    expect(clampAxisDelta(420, 520, MIN, MAX, MARGIN)).toBe(-28);
  });

  it('pins to the low edge when the popover is larger than the slot', () => {
    // Width 600 > band width 384 → align left edge to 108 regardless of start.
    expect(clampAxisDelta(50, 650, MIN, MAX, MARGIN)).toBe(58); // 108 - 50
  });

  it('respects the margin exactly at the boundary', () => {
    expect(clampAxisDelta(108, 200, MIN, MAX, MARGIN)).toBe(0);
    expect(clampAxisDelta(400, 492, MIN, MAX, MARGIN)).toBe(0);
  });
});
