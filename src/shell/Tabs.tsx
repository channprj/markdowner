import { DragEvent, MouseEvent, useState } from 'react';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabsItemKind = 'document' | 'settings';

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
  onReorderTab?: (sourceId: string, targetId: string, placeAfter: boolean) => void;
}

type DropIndicator = { id: string; after: boolean };

export function Tabs({ items, activeTabId, onSelectTab, onCloseTab, onReorderTab }: TabsProps) {
  // Id of the tab being dragged; null while no drag is in flight. The drop
  // indicator tracks which edge of the hovered tab the drag would insert at.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  if (items.length === 0) return null;

  const clearDragState = () => {
    setDraggingId(null);
    setDropIndicator(null);
  };

  const isAfterDrop = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2;
  };

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-background"
    >
      {items.map((item) => {
        const isActive = item.id === activeTabId;
        const tooltip = item.shortcutLabel
          ? `${item.name} (${item.shortcutLabel})`
          : item.name;
        const indicator = dropIndicator?.id === item.id ? dropIndicator : null;
        return (
          <div
            key={item.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tooltip}
            draggable={onReorderTab !== undefined}
            onDragStart={(event) => {
              if (!onReorderTab) return;
              event.dataTransfer.effectAllowed = 'move';
              // Some engines (WebKit) need data set for the drag to start.
              event.dataTransfer.setData('text/plain', item.id);
              setDraggingId(item.id);
            }}
            onDragOver={(event) => {
              if (!onReorderTab || !draggingId || draggingId === item.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const after = isAfterDrop(event);
              setDropIndicator((prev) =>
                prev?.id === item.id && prev.after === after ? prev : { id: item.id, after },
              );
            }}
            onDrop={(event) => {
              if (!onReorderTab || !draggingId || draggingId === item.id) return;
              event.preventDefault();
              onReorderTab(draggingId, item.id, isAfterDrop(event));
              clearDragState();
            }}
            onDragEnd={clearDragState}
            onClick={() => onSelectTab(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectTab(item.id);
              }
            }}
            className={cn(
              'group relative flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-sm transition-colors hover:bg-accent/40',
              isActive && 'bg-accent text-accent-foreground',
              draggingId === item.id && 'opacity-50',
              indicator &&
                (indicator.after
                  ? 'shadow-[inset_-2px_0_0_var(--ring)]'
                  : 'shadow-[inset_2px_0_0_var(--ring)]'),
            )}
          >
            {item.kind === 'settings' ? (
              <SettingsIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
              onClick={(event: MouseEvent) => {
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
