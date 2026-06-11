import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  MINIMAP_FONT_SIZE_PX,
  MINIMAP_FONT_WEIGHT,
  MINIMAP_MAX_WIDTH_PX,
  buildLineSpecs,
  computeMinimapLayout,
  minimapWidthPx,
  scrollTopForDragDelta,
  scrollTopForTrackJump,
  type MinimapLayout,
  type MinimapLayoutInput,
  type MinimapLineKind,
} from '@/lib/minimapModel';
import { cn } from '@/lib/utils';

export interface MinimapProps {
  /** Markdown source rendered as miniature text. */
  text: string;
  /** The scrollable element the minimap mirrors. Null hides the indicator. */
  scrollEl: HTMLElement | null;
  className?: string;
  /** Editor line-height multiplier; mini line height = 2px × this (Zed). */
  lineHeight?: number;
}

const DEFAULT_LINE_HEIGHT = 1.6;
/** Zed insets the minimap text by px(4.). */
const PADDING_X = 4;
const MINIMAP_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Ink opacity per markdown structure, all tinted from --foreground. */
const KIND_ALPHA: Record<MinimapLineKind, number> = {
  blank: 0,
  heading: 0.95,
  regular: 0.55,
  list: 0.62,
  code: 0.4,
  quote: 0.45,
};

interface MinimapView {
  widthPx: number;
  thumb: MinimapLayout | null;
}

function sameView(a: MinimapView, b: MinimapView): boolean {
  if (a.widthPx !== b.widthPx) return false;
  if (!a.thumb || !b.thumb) return a.thumb === b.thumb;
  return (
    a.thumb.showThumb === b.thumb.showThumb &&
    a.thumb.thumbTopPx === b.thumb.thumbTopPx &&
    a.thumb.thumbHeightPx === b.thumb.thumbHeightPx
  );
}

function observeResize(target: Element, onResize: () => void): () => void {
  onResize();
  if (typeof ResizeObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new ResizeObserver(onResize);
  observer.observe(target);
  return () => observer.disconnect();
}

/**
 * Zed-style minimap (ported from zed-industries/zed PR #26893). The markdown
 * source is drawn on a canvas as real text at a 2px weight-900 monospace font
 * — a miniature of the document rather than abstract bars. The mini line
 * height is fixed (2px × the editor line-height multiplier), so long
 * documents are never squashed: when the document overflows the minimap the
 * content slides proportionally with the editor scroll, exactly like Zed and
 * VS Code.
 *
 * Interaction matches Zed: the viewport thumb is grabbed in place, a click
 * outside the thumb centers the thumb on the click point and immediately
 * starts a delta-based drag where the full minimap height traverses the full
 * document.
 */
function MinimapImpl({ text, scrollEl, className, lineHeight }: MinimapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ startClientY: number; startScrollTop: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<MinimapView>({
    widthPx: MINIMAP_MAX_WIDTH_PX,
    thumb: null,
  });

  const lines = useMemo(() => buildLineSpecs(text), [text]);
  const miniLineHeight =
    MINIMAP_FONT_SIZE_PX *
    (lineHeight && Number.isFinite(lineHeight) && lineHeight > 0
      ? lineHeight
      : DEFAULT_LINE_HEIGHT);

  // Live measurement at call time — the minimap math must always see the
  // current scroll metrics, not values cached at render.
  const layoutInput = useCallback((): MinimapLayoutInput | null => {
    const root = rootRef.current;
    if (!root || !scrollEl) return null;
    return {
      totalLines: lines.length,
      minimapHeightPx: root.clientHeight,
      minimapLineHeightPx: miniLineHeight,
      scrollTop: scrollEl.scrollTop,
      scrollHeight: scrollEl.scrollHeight,
      clientHeight: scrollEl.clientHeight,
    };
  }, [scrollEl, lines, miniLineHeight]);

  const paint = useCallback(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
    }
    if (canvas.height !== Math.round(height * dpr)) {
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const input = layoutInput();
    if (!input) return;
    const layout = computeMinimapLayout(input);

    const ink =
      getComputedStyle(root).getPropertyValue('--foreground').trim() || '#888';
    ctx.font = `${MINIMAP_FONT_WEIGHT} ${MINIMAP_FONT_SIZE_PX}px ${MINIMAP_FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = ink;

    const glyphInset = (miniLineHeight - MINIMAP_FONT_SIZE_PX) / 2;
    for (let i = layout.firstVisibleLine; i <= layout.lastVisibleLine; i++) {
      const spec = lines[i];
      if (!spec || spec.kind === 'blank') continue;
      ctx.globalAlpha = KIND_ALPHA[spec.kind];
      ctx.fillText(
        spec.text,
        PADDING_X,
        (i - layout.minimapScrollTopLines) * miniLineHeight + glyphInset,
      );
    }
    ctx.globalAlpha = 1;
  }, [layoutInput, lines, miniLineHeight]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  }, [paint]);

  const recalc = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const parent = root.parentElement;
    const paneWidth = parent?.clientWidth ?? 0;
    // Unmeasurable (first paint, jsdom) → keep the default width instead of
    // flashing the minimap away; only a *measured* narrow pane hides it.
    const widthPx = paneWidth > 0 ? minimapWidthPx(paneWidth) : MINIMAP_MAX_WIDTH_PX;
    parent?.style.setProperty('--minimap-width', `${widthPx}px`);

    const input = layoutInput();
    const next: MinimapView = {
      widthPx,
      thumb: input && widthPx > 0 ? computeMinimapLayout(input) : null,
    };
    setView((prev) => (sameView(prev, next) ? prev : next));
    if (widthPx > 0) scheduleDraw();
  }, [layoutInput, scheduleDraw]);

  // Re-measure on content / metric changes (recalc identity tracks them).
  useEffect(() => {
    recalc();
  }, [recalc]);

  // Editor → minimap sync plus resize tracking. Observing the parent pane
  // covers both the minimap height and the width budget for the Zed
  // 15%-of-pane rule. Observers go through a ref so typing (which changes
  // `lines` and therefore `recalc`) never tears them down.
  const recalcRef = useRef(recalc);
  recalcRef.current = recalc;
  useEffect(() => {
    const onChange = () => recalcRef.current();
    const disconnects: Array<() => void> = [];
    const parent = rootRef.current?.parentElement;
    if (parent) disconnects.push(observeResize(parent, onChange));
    if (scrollEl) {
      scrollEl.addEventListener('scroll', onChange, { passive: true });
      disconnects.push(() => scrollEl.removeEventListener('scroll', onChange));
      disconnects.push(observeResize(scrollEl, onChange));
    }
    return () => disconnects.forEach((disconnect) => disconnect());
  }, [scrollEl]);

  // Theme switches swap CSS variables on <html data-theme>; repaint so the
  // canvas ink follows without a content change.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(scheduleDraw);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [scheduleDraw]);

  // Drop the pending frame and the published width on unmount.
  useEffect(() => {
    const root = rootRef.current;
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      root?.parentElement?.style.removeProperty('--minimap-width');
    };
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const root = rootRef.current;
      const input = layoutInput();
      if (!root || !scrollEl || !input) return;
      event.preventDefault();

      const layout = computeMinimapLayout(input);
      const clickY = event.clientY - root.getBoundingClientRect().top;
      const inThumb =
        layout.showThumb &&
        clickY >= layout.thumbTopPx &&
        clickY < layout.thumbTopPx + layout.thumbHeightPx;
      if (!inThumb) {
        scrollEl.scrollTop = scrollTopForTrackJump({ ...input, clickYPx: clickY });
      }
      dragRef.current = {
        startClientY: event.clientY,
        startScrollTop: scrollEl.scrollTop,
      };
      setDragging(true);
      recalc();
    },
    [layoutInput, recalc, scrollEl],
  );

  // Document-level move/up listeners so the gesture survives a cursor that
  // wanders outside the minimap rectangle.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const root = rootRef.current;
      const drag = dragRef.current;
      if (!root || !drag || !scrollEl) return;
      scrollEl.scrollTop = scrollTopForDragDelta({
        totalLines: lines.length,
        minimapHeightPx: root.clientHeight,
        minimapLineHeightPx: miniLineHeight,
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
        startScrollTop: drag.startScrollTop,
        deltaYPx: event.clientY - drag.startClientY,
      });
      recalc();
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, lines, miniLineHeight, recalc, scrollEl]);

  const hidden = view.widthPx <= 0;
  return (
    <div
      ref={rootRef}
      data-testid="editor-minimap"
      role="presentation"
      aria-hidden="true"
      className={cn('minimap', className)}
      style={{
        width: hidden ? undefined : `${view.widthPx}px`,
        display: hidden ? 'none' : undefined,
      }}
      data-dragging={dragging ? 'true' : undefined}
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} className="minimap-canvas" />
      {view.thumb?.showThumb ? (
        <div
          className="minimap-viewport"
          style={{
            top: view.thumb.thumbTopPx,
            height: view.thumb.thumbHeightPx,
          }}
        />
      ) : null}
    </div>
  );
}

export const Minimap = memo(MinimapImpl);
export default Minimap;
