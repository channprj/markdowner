import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { editorPopoverAnchor, editorSurfaceRect, placeEditorPopover, type PopoverRect } from './editorPopoverPosition';

/** Gap kept between a floating popover and the editor surface edge. */
const DEFAULT_MARGIN_PX = 8;

export type ClampOffset = { dx: number; dy: number; maxHeight?: number };

const NO_OFFSET: ClampOffset = { dx: 0, dy: 0 };

/**
 * Delta needed to slide the interval [start, end] inside [min+margin, max-margin].
 * When the popover is wider/taller than the available slot it pins to the low
 * (left/top) edge rather than the high one, keeping its primary content visible.
 */
export function clampAxisDelta(
  start: number,
  end: number,
  min: number,
  max: number,
  margin: number,
): number {
  const lo = min + margin;
  const hi = max - margin;
  if (end - start >= hi - lo) return lo - start; // too big → pin to the low edge
  if (start < lo) return lo - start;
  if (end > hi) return hi - end;
  return 0;
}

/**
 * Keep a portaled popover within the editor surface. Returns a `{dx, dy}` offset
 * to ADD to the popover's computed top/left.
 *
 * Transform-agnostic: it measures the element's real on-screen rect (after any
 * CSS `translate`) and corrects that, so popovers that center themselves with
 * `translate(-50%, …)` clamp correctly. The offset is computed in a layout
 * effect (before paint), so the corrected position is what the user sees — no
 * flash at the unclamped position.
 *
 * `positionDep` should change whenever the base position changes so the clamp
 * re-runs; the popover components already re-render on selection/scroll/resize.
 */
export function useEditorSurfaceClamp(
  editor: Editor | null,
  ref: RefObject<HTMLElement | null>,
  positionDep: unknown,
  margin: number = DEFAULT_MARGIN_PX,
  anchor?: PopoverRect | null,
): ClampOffset {
  const appliedRef = useRef<ClampOffset>(NO_OFFSET);
  const [offset, setOffset] = useState<ClampOffset>(NO_OFFSET);

  useLayoutEffect(() => {
    const update = () => {
      const el = ref.current;
      const bounds = editorSurfaceRect(editor);
      if (!el || !bounds) {
        if (appliedRef.current !== NO_OFFSET) {
          appliedRef.current = NO_OFFSET;
          setOffset(NO_OFFSET);
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      const applied = appliedRef.current;
      // Remove the offset already in the DOM, including CSS translations.
      const baseTop = rect.top - applied.dy;
      const dx = clampAxisDelta(
        rect.left - applied.dx, rect.right - applied.dx,
        bounds.left, bounds.right, margin,
      );
      let dy = clampAxisDelta(
        baseTop, rect.bottom - applied.dy, bounds.top, bounds.bottom, margin,
      );
      let maxHeight: number | undefined;
      const height = Math.max(rect.height, el.scrollHeight);
      const line = anchor ?? editorPopoverAnchor(editor, bounds, height);
      if (line) {
        const position = placeEditorPopover({
          anchor: line,
          bounds,
          width: rect.width,
          height,
          preferred: baseTop < line.top ? 'above' : 'below',
          margin,
        });
        dy = position.top - baseTop;
        maxHeight = position.maxHeight;
      }
      if (dx !== applied.dx || dy !== applied.dy || maxHeight !== applied.maxHeight) {
        const next = { dx, dy, maxHeight };
        appliedRef.current = next;
        setOffset(next);
      }
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    return () => observer?.disconnect();
  }, [editor, ref, positionDep, margin, anchor]);

  return offset;
}
