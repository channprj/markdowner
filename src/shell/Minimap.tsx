import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/utils';

export interface MinimapProps {
  /** Markdown source rendered as line bars. */
  text: string;
  /** The scrollable element the minimap mirrors. Null hides the indicator. */
  scrollEl: HTMLElement | null;
  className?: string;
}

type LineKind = 'blank' | 'heading' | 'code' | 'list' | 'quote' | 'regular';

interface LineSpec {
  kind: LineKind;
  width: number;
}

interface ViewportRect {
  top: number;
  height: number;
}

const MAX_VISIBLE_WIDTH_CHARS = 80;
const MIN_LINE_HEIGHT_PX = 1;

function observeResize(target: Element, onResize: () => void): () => void {
  onResize();
  if (typeof ResizeObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new ResizeObserver(onResize);
  observer.observe(target);
  return () => observer.disconnect();
}

function classifyLine(line: string): LineKind {
  const trimmed = line.trim();
  if (!trimmed) return 'blank';
  if (/^#{1,6}\s/.test(trimmed)) return 'heading';
  if (trimmed.startsWith('```') || trimmed.startsWith('    ')) return 'code';
  if (/^([-*+]\s|\d+\.\s|\[\s\]|\[x\])/i.test(trimmed)) return 'list';
  if (trimmed.startsWith('>')) return 'quote';
  return 'regular';
}

/**
 * VS Code-style minimap. Renders each source line as a small horizontal bar
 * whose width tracks the trimmed line length and colour reflects the
 * markdown structure (heading / list / code / quote / regular). The whole
 * document is always scaled to fit the available height so the minimap is
 * a true preview rather than a scrollable miniature.
 *
 * Scroll sync is bidirectional: the editor's scroll position drives a
 * viewport indicator on the minimap, and click + drag on the minimap maps
 * back to a proportional scrollTop on the editor.
 */
function MinimapImpl({ text, scrollEl, className }: MinimapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootHeight, setRootHeight] = useState(0);
  const [viewport, setViewport] = useState<ViewportRect>({ top: 0, height: 0 });
  const draggingRef = useRef(false);

  const lines = useMemo<LineSpec[]>(() => {
    return text.split('\n').map((raw) => {
      const trimmed = raw.trim();
      const width = trimmed.length === 0
        ? 0
        : Math.min(1, trimmed.length / MAX_VISIBLE_WIDTH_CHARS);
      return { kind: classifyLine(raw), width };
    });
  }, [text]);

  // Pixel height each line is allotted. Scales the entire document so the
  // minimap shows the whole thing without an internal scrollbar.
  const lineHeight = useMemo(() => {
    if (rootHeight <= 0 || lines.length === 0) return MIN_LINE_HEIGHT_PX;
    return Math.max(MIN_LINE_HEIGHT_PX, rootHeight / lines.length);
  }, [rootHeight, lines.length]);

  // Observe rootRef size — the minimap must respond to window resize so
  // the line-height calculation stays in sync.
  useEffect(() => {
    if (!rootRef.current) return;
    const target = rootRef.current;
    return observeResize(target, () => {
      setRootHeight(target.clientHeight);
    });
  }, []);

  const recalcViewport = useCallback(() => {
    const scroller = scrollEl;
    const root = rootRef.current;
    if (!scroller || !root) {
      setViewport({ top: 0, height: 0 });
      return;
    }
    const total = scroller.scrollHeight;
    const visible = scroller.clientHeight;
    const rootH = root.clientHeight;
    if (total <= 0 || visible <= 0 || rootH <= 0) {
      setViewport({ top: 0, height: rootH });
      return;
    }
    const heightRatio = Math.min(1, visible / total);
    const denominator = total - visible;
    const topRatio = denominator > 0 ? scroller.scrollTop / denominator : 0;
    const indicatorHeight = Math.max(16, heightRatio * rootH);
    const indicatorTop = Math.max(
      0,
      Math.min(rootH - indicatorHeight, topRatio * (rootH - indicatorHeight)),
    );
    setViewport({ top: indicatorTop, height: indicatorHeight });
  }, [scrollEl]);

  // Real-time scroll sync from editor → minimap.
  useEffect(() => {
    const scroller = scrollEl;
    if (!scroller) return;
    const onScroll = () => recalcViewport();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const disconnectResize = observeResize(scroller, recalcViewport);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      disconnectResize();
    };
  }, [recalcViewport, scrollEl]);

  // Recompute when content or root height change.
  useEffect(() => {
    recalcViewport();
  }, [recalcViewport, rootHeight, text]);

  const scrollToClientY = useCallback(
    (clientY: number) => {
      const scroller = scrollEl;
      const root = rootRef.current;
      if (!scroller || !root) return;
      const rect = root.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const total = scroller.scrollHeight;
      const visible = scroller.clientHeight;
      const target = ratio * total - visible / 2;
      const clamped = Math.max(0, Math.min(total - visible, target));
      scroller.scrollTop = clamped;
    },
    [scrollEl],
  );

  // Drag-to-scroll. Document-level move/up listeners so the gesture survives
  // a cursor that wanders outside the minimap rectangle.
  useEffect(() => {
    if (!draggingRef.current) return;
    const onMove = (event: MouseEvent) => scrollToClientY(event.clientY);
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  });

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      draggingRef.current = true;
      scrollToClientY(event.clientY);
    },
    [scrollToClientY],
  );

  return (
    <div
      ref={rootRef}
      data-testid="editor-minimap"
      role="presentation"
      aria-hidden="true"
      className={cn('minimap', className)}
      onMouseDown={handleMouseDown}
    >
      <div className="minimap-track">
        {lines.map((line, index) => (
          <div
            key={index}
            className={`minimap-row minimap-row-${line.kind}`}
            style={{ height: `${lineHeight}px` }}
          >
            {line.kind !== 'blank' ? (
              <span
                className="minimap-bar"
                style={{ width: `${Math.max(line.width * 100, 6)}%` }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div
        className="minimap-viewport"
        style={{ top: viewport.top, height: viewport.height }}
      />
    </div>
  );
}

export const Minimap = memo(MinimapImpl);
export default Minimap;
