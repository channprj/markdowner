import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface QuickOpenItem {
  path: string;
  name: string;
  relativePath: string;
  kind?: 'workspace' | 'recent';
}

const KIND_LABELS: Record<NonNullable<QuickOpenItem['kind']>, string> = {
  workspace: 'Workspace Files',
  recent: 'Recent Files',
};

export interface QuickOpenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: QuickOpenItem[];
  onSelect: (path: string) => void;
}

const MAX_RESULTS = 50;
const PAGE_SIZE = 10;

function filterItems(items: QuickOpenItem[], query: string): QuickOpenItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return items.slice(0, MAX_RESULTS);
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const filtered: QuickOpenItem[] = [];
  for (const item of items) {
    const haystack = `${item.name} ${item.relativePath}`.toLowerCase();
    if (tokens.every((token) => haystack.includes(token))) {
      filtered.push(item);
      if (filtered.length >= MAX_RESULTS) break;
    }
  }
  return filtered;
}

export function QuickOpen({ open, onOpenChange, items, onSelect }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => filterItems(items, query), [items, query]);
  const activeOptionId =
    filtered.length > 0 ? `${listboxId}-option-${highlightedIndex}` : undefined;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlightedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLLIElement>('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, filtered]);

  const commitSelection = (index: number) => {
    const target = filtered[index];
    if (!target) return;
    onSelect(target.path);
    onOpenChange(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % filtered.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) =>
        current <= 0 ? filtered.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setHighlightedIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setHighlightedIndex(filtered.length - 1);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.min(filtered.length - 1, current + PAGE_SIZE),
      );
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(0, current - PAGE_SIZE));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSelection(highlightedIndex);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg p-0 gap-0 overflow-hidden top-[20%] translate-y-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Quick Open</DialogTitle>
          <DialogDescription>Search workspace files by name.</DialogDescription>
        </DialogHeader>
        <div className="border-b border-border px-3 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name…"
            aria-label="Quick Open file search"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            className="h-9 border-0 shadow-none focus-visible:ring-0 px-1"
          />
        </div>
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Workspace files"
          className="max-h-80 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li
              role="presentation"
              data-empty-state="quick-open"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {items.length === 0 ? 'No files in this workspace.' : 'No matches.'}
            </li>
          ) : (
            filtered.map((item, index) => {
              const isActive = index === highlightedIndex;
              const previousKind = index > 0 ? filtered[index - 1].kind : undefined;
              const showSectionHeader =
                item.kind !== undefined && item.kind !== previousKind;
              return (
                <Fragment key={item.path}>
                  {showSectionHeader && item.kind ? (
                    <li
                      role="presentation"
                      className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-section-header={item.kind}
                    >
                      {KIND_LABELS[item.kind]}
                    </li>
                  ) : null}
                  <li
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    data-kind={item.kind}
                    className={cn(
                      'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-sm',
                      isActive && 'bg-accent text-accent-foreground',
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => commitSelection(index)}
                  >
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.relativePath}
                    </span>
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
