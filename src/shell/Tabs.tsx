import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { FileDown, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { planTabDragPlacement, type TabSlot } from '@/lib/tabDragReorder';

/** Pointer travel that tells a click on a tab apart from a drag of it. */
const DRAG_THRESHOLD_PX = 4;
const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_STEP_PX = 18;
const TAB_SLIDE_MS = 130;

export type TabsItemKind = 'document' | 'settings' | 'export' | 'ai-review';

export interface TabsItem {
  id: string;
  kind: TabsItemKind;
  name: string;
  isDirty: boolean;
  missing: boolean;
  shortcutLabel: string | null;
}

interface TabsProps {
  items: TabsItem[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /** Moves `sourceId` to `index` when a drag is released on a new slot. */
  onReorderTab?: (sourceId: string, index: number) => void;
}

/** A pointer held on a tab that has not yet travelled far enough to drag it. */
interface ArmedDrag {
  id: string;
  pointerId: number;
  startClientX: number;
}

/** A drag in flight. `slots` and `offsets` are parallel to the rendered tabs. */
interface ActiveDrag extends ArmedDrag {
  slots: TabSlot[];
  sourceIndex: number;
  grabOffsetX: number;
  index: number;
  offsets: number[];
}

function blocksTabDrag(target: EventTarget | null): boolean {
  return target instanceof Element
    ? target.closest('button, [data-no-tab-drag]') !== null
    : false;
}

export function Tabs({ items, activeTabId, onSelectTab, onCloseTab, onReorderTab }: TabsProps) {
  // A drag never reorders `items` while it is in flight: it only paints CSS
  // transforms, so the tab under the pointer keeps its DOM node and the
  // neighbours it displaces can animate out of the way.
  //
  // `drag` drives that painting. `dragRef` mirrors it because the window pointer
  // handlers must read the live placement without waiting for a render.
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const [isTrackingPointer, setIsTrackingPointer] = useState(false);
  const dragRef = useRef<ActiveDrag | null>(null);
  const armedRef = useRef<ArmedDrag | null>(null);
  const draggedRef = useRef(false);
  const pointerXRef = useRef(0);
  const tablistRef = useRef<HTMLDivElement>(null);
  const edgeScrollSpeedRef = useRef(0);
  const edgeScrollFrameRef = useRef<number | null>(null);
  const isDragging = drag !== null;

  /** Viewport x of the strip's content origin, so x moves with `scrollLeft`. */
  const contentOriginX = useCallback(() => {
    const strip = tablistRef.current;
    return strip ? strip.getBoundingClientRect().left - strip.scrollLeft : 0;
  }, []);

  const stopEdgeScroll = useCallback(() => {
    edgeScrollSpeedRef.current = 0;
    if (edgeScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(edgeScrollFrameRef.current);
      edgeScrollFrameRef.current = null;
    }
  }, []);

  const paintDrag = useCallback(
    (clientX: number) => {
      const active = dragRef.current;
      if (!active) return;

      const { index, offsets } = planTabDragPlacement(
        active.slots,
        active.sourceIndex,
        clientX - contentOriginX(),
        active.grabOffsetX,
      );
      const unchanged =
        index === active.index &&
        offsets.every((offset, slot) => offset === active.offsets[slot]);
      if (unchanged) return;

      const next = { ...active, index, offsets };
      dragRef.current = next;
      setDrag(next);
    },
    [contentOriginX],
  );

  const runEdgeScroll = useCallback(() => {
    const strip = tablistRef.current;
    const speed = edgeScrollSpeedRef.current;
    if (!strip || speed === 0) {
      edgeScrollFrameRef.current = null;
      return;
    }

    const before = strip.scrollLeft;
    strip.scrollLeft += speed;
    if (strip.scrollLeft === before) {
      stopEdgeScroll();
      return;
    }
    // Scrolling moved the content under a stationary pointer, so the slot the
    // drag is aiming at has to be recomputed on every frame.
    paintDrag(pointerXRef.current);
    edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeScroll);
  }, [paintDrag, stopEdgeScroll]);

  const updateEdgeScroll = useCallback(
    (clientX: number) => {
      const strip = tablistRef.current;
      if (!strip || strip.scrollWidth <= strip.clientWidth) {
        stopEdgeScroll();
        return;
      }

      const rect = strip.getBoundingClientRect();
      const leftDepth = EDGE_SCROLL_ZONE_PX - (clientX - rect.left);
      const rightDepth = EDGE_SCROLL_ZONE_PX - (rect.right - clientX);
      let speed = 0;
      if (leftDepth > 0 && strip.scrollLeft > 0) {
        speed = -edgeScrollStep(leftDepth);
      } else if (
        rightDepth > 0 &&
        strip.scrollLeft + strip.clientWidth < strip.scrollWidth
      ) {
        speed = edgeScrollStep(rightDepth);
      }

      edgeScrollSpeedRef.current = speed;
      if (speed === 0) {
        stopEdgeScroll();
      } else if (edgeScrollFrameRef.current === null) {
        edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeScroll);
      }
    },
    [runEdgeScroll, stopEdgeScroll],
  );

  const commitDrag = useEffectEvent((sourceId: string, index: number) => {
    onReorderTab?.(sourceId, index);
  });

  const finishDrag = useCallback(
    (commit: boolean) => {
      const active = dragRef.current;
      armedRef.current = null;
      dragRef.current = null;
      stopEdgeScroll();
      setIsTrackingPointer(false);
      setDrag(null);

      // Reordering and dropping the transforms land in the same render, so the
      // displaced tabs are already sitting where the new order puts them.
      if (active && commit && active.index !== active.sourceIndex) {
        commitDrag(active.id, active.index);
      }
    },
    [stopEdgeScroll],
  );

  const startDrag = useCallback(
    (clientX: number): boolean => {
      const armed = armedRef.current;
      const strip = tablistRef.current;
      if (!armed || !strip) return false;

      // Measured once: transforms do not affect layout, so these stay valid for
      // the whole drag.
      const origin = contentOriginX();
      const slots = Array.from(
        strip.querySelectorAll<HTMLElement>('[data-tab-id]'),
      ).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: node.dataset.tabId ?? '',
          left: rect.left - origin,
          width: rect.width,
        };
      });
      const sourceIndex = slots.findIndex((slot) => slot.id === armed.id);
      if (slots.length < 2 || sourceIndex < 0) return false;

      const active: ActiveDrag = {
        ...armed,
        slots,
        sourceIndex,
        grabOffsetX: armed.startClientX - origin - slots[sourceIndex].left,
        index: sourceIndex,
        offsets: slots.map(() => 0),
      };
      dragRef.current = active;
      draggedRef.current = true;
      setDrag(active);
      paintDrag(clientX);
      return true;
    },
    [contentOriginX, paintDrag],
  );

  useEffect(() => {
    if (!isTrackingPointer) return;

    const handleMove = (event: PointerEvent) => {
      const armed = armedRef.current;
      if (!armed || event.pointerId !== armed.pointerId) return;
      pointerXRef.current = event.clientX;

      if (!dragRef.current) {
        if (Math.abs(event.clientX - armed.startClientX) < DRAG_THRESHOLD_PX) return;
        if (!startDrag(event.clientX)) {
          finishDrag(false);
          return;
        }
      } else {
        paintDrag(event.clientX);
      }
      // Also checked on the move that starts the drag, so a gesture beginning in
      // an edge zone scrolls right away.
      updateEdgeScroll(event.clientX);
    };
    const commit = () => finishDrag(true);
    const cancel = () => finishDrag(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    // WebKit begins a document text selection the moment the press turns into a
    // drag, which paints a growing selection across the editor while the tab
    // moves. The body `user-select` override lands a render too late to stop it.
    const blockSelection = (event: Event) => event.preventDefault();

    // Capture phase on the document: a bubble-phase handler elsewhere in the app
    // can stopPropagation() a move and strand the drag mid-gesture.
    document.addEventListener('pointermove', handleMove, true);
    document.addEventListener('pointerup', commit, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('selectstart', blockSelection);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointermove', handleMove, true);
      document.removeEventListener('pointerup', commit, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('selectstart', blockSelection);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [finishDrag, isTrackingPointer, paintDrag, startDrag, updateEdgeScroll]);

  useEffect(() => {
    if (!isDragging) return;
    const { body } = document;
    const previousCursor = body.style.cursor;
    const previousUserSelect = body.style.userSelect;
    body.style.cursor = 'grabbing';
    body.style.userSelect = 'none';
    return () => {
      body.style.cursor = previousCursor;
      body.style.userSelect = previousUserSelect;
    };
  }, [isDragging]);

  const renderedIds = items.map((item) => item.id).join('\n');
  useEffect(() => {
    const active = dragRef.current;
    // A tab opening or closing mid-drag invalidates the measured geometry.
    if (active && active.slots.map((slot) => slot.id).join('\n') !== renderedIds) {
      finishDrag(false);
    }
  }, [finishDrag, renderedIds]);

  useEffect(() => () => stopEdgeScroll(), [stopEdgeScroll]);

  if (items.length === 0) return null;

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label="Open documents"
      className="flex h-full min-w-0 items-stretch overflow-x-auto border-l border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item, index) => {
        const isActive = item.id === activeTabId;
        const isDragged = drag?.id === item.id;
        const offset = drag?.offsets[index] ?? 0;
        const baseTooltip = item.shortcutLabel
          ? `${item.name} (${item.shortcutLabel})`
          : item.name;
        const tooltip = onReorderTab
          ? `${baseTooltip} — Drag to reorder`
          : baseTooltip;
        return (
          <div
            key={item.id}
            data-tab-id={item.id}
            data-tab-dragging={isDragged ? '' : undefined}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tooltip}
            style={{
              transform: offset === 0 ? undefined : `translateX(${offset}px)`,
              transition:
                isDragging && !isDragged
                  ? `transform ${TAB_SLIDE_MS}ms ease-out`
                  : undefined,
            }}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              draggedRef.current = false;
              if (!onReorderTab || event.button !== 0 || event.pointerType === 'touch') {
                return;
              }
              if (blocksTabDrag(event.target)) return;
              armedRef.current = {
                id: item.id,
                pointerId: event.pointerId,
                startClientX: event.clientX,
              };
              pointerXRef.current = event.clientX;
              setIsTrackingPointer(true);
            }}
            onClick={() => {
              // The click that closes a drag gesture must not switch documents.
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              onSelectTab(item.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectTab(item.id);
              }
            }}
            className={cn(
              'group relative flex max-w-[220px] shrink-0 select-none items-center gap-1.5 border-r border-border px-3 text-sm',
              onReorderTab && 'cursor-grab',
              !isDragging && 'transition-colors hover:bg-accent/40',
              isActive && 'bg-accent text-accent-foreground',
              isDragged && !isActive && 'bg-background',
              isDragged && 'z-10 cursor-grabbing shadow-md',
            )}
          >
            {item.kind === 'settings' ? (
              <SettingsIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            {item.kind === 'export' ? (
              <FileDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            {item.kind === 'ai-review' ? (
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            <span className={cn('truncate', item.missing && 'italic text-muted-foreground line-through')}>
              {item.name}
            </span>
            {item.missing ? (
              <span
                aria-label="File missing on disk"
                title="File no longer exists on disk"
                className="ml-1 rounded bg-destructive/15 px-1 text-[10px] uppercase tracking-wide text-destructive"
              >
                missing
              </span>
            ) : null}
            {item.isDirty ? (
              <span aria-label="Unsaved changes" className="text-base leading-none text-muted-foreground">
                ●
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Close tab"
              data-no-tab-drag
              onClick={(event: ReactMouseEvent) => {
                event.stopPropagation();
                onCloseTab(item.id);
              }}
              className={cn(
                'ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Edge-scroll speed: faster the deeper the pointer sits in the edge zone. */
function edgeScrollStep(depth: number): number {
  const ratio = Math.min(1, depth / EDGE_SCROLL_ZONE_PX);
  return Math.max(1, Math.ceil(ratio * EDGE_SCROLL_MAX_STEP_PX));
}
