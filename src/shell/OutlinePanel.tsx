import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import type { OutlineItem } from '@/lib/outline';

export interface OutlinePanelProps {
  items: OutlineItem[];
  busy: boolean;
  fontSize: number;
  rowSpacing: number;
  onSelectItem?: (item: OutlineItem) => void;
}

export function OutlinePanel({
  items,
  busy,
  fontSize,
  rowSpacing,
  onSelectItem,
}: OutlinePanelProps) {
  const rowPaddingY = Math.max(2, rowSpacing + 2);

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleOutlineKeyDown}>
      <div className="flex h-9 shrink-0 items-center px-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground">
          OUTLINE
        </div>
      </div>
      <section className="explorer-section flex min-h-0 flex-1 flex-col border-t border-sidebar-border/70">
        <div className="explorer-section-header">Outline</div>
        {items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No headings</p>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div
              data-testid="outline-list"
              className="flex flex-col py-1"
              style={{ gap: `${rowSpacing}px` }}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-outline-row=""
                  className="explorer-tree-row flex w-full items-center text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: 1.25,
                    paddingTop: `${rowPaddingY}px`,
                    paddingBottom: `${rowPaddingY}px`,
                    paddingLeft: `${8 + Math.max(0, item.depth - 1) * 12}px`,
                  }}
                  disabled={busy}
                  onClick={() => onSelectItem?.(item)}
                >
                  <span className="truncate font-medium">{item.title}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </section>
    </div>
  );
}

function handleOutlineKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const active = (event.target as HTMLElement | null) ?? null;
  if (!active?.matches('[data-outline-row]')) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    active.click();
    return;
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

  const root = event.currentTarget;
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-outline-row]'));
  const currentIndex = rows.indexOf(active);
  if (currentIndex < 0) return;

  event.preventDefault();
  const nextIndex =
    event.key === 'ArrowDown'
      ? Math.min(currentIndex + 1, rows.length - 1)
      : Math.max(currentIndex - 1, 0);
  rows[nextIndex]?.focus();
}
