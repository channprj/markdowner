import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface CommandPaletteCommand {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandPaletteCommand[];
}

const MAX_RESULTS = 60;
const PAGE_SIZE = 10;

function filterCommands(
  commands: CommandPaletteCommand[],
  query: string,
): CommandPaletteCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return commands.slice(0, MAX_RESULTS);
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const filtered: CommandPaletteCommand[] = [];
  for (const command of commands) {
    const haystack = `${command.label} ${command.category ?? ''}`.toLowerCase();
    if (tokens.every((token) => haystack.includes(token))) {
      filtered.push(command);
      if (filtered.length >= MAX_RESULTS) break;
    }
  }
  return filtered;
}

export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

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
    if (!target || target.disabled) return;
    onOpenChange(false);
    void target.run();
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
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search and run a command.</DialogDescription>
        </DialogHeader>
        <div className="border-b border-border px-3 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command…"
            aria-label="Command palette search"
            className="h-9 border-0 shadow-none focus-visible:ring-0 px-1"
          />
        </div>
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Available commands"
          className="max-h-80 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li
              role="presentation"
              data-empty-state="command-palette"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {commands.length === 0 ? 'No commands available.' : 'No matches.'}
            </li>
          ) : (
            filtered.map((command, index) => {
              const isActive = index === highlightedIndex;
              const previousCategory = index > 0 ? filtered[index - 1].category : undefined;
              const showCategoryHeader =
                command.category !== undefined && command.category !== previousCategory;
              return (
                <Fragment key={command.id}>
                  {showCategoryHeader ? (
                    <li
                      role="presentation"
                      className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      data-category-header={command.category}
                    >
                      {command.category}
                    </li>
                  ) : null}
                  <li
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={command.disabled || undefined}
                    data-active={isActive}
                    data-category={command.category}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm',
                      isActive && 'bg-accent text-accent-foreground',
                      command.disabled && 'cursor-not-allowed opacity-50',
                    )}
                    onMouseEnter={() => {
                      if (!command.disabled) setHighlightedIndex(index);
                    }}
                    onClick={() => commitSelection(index)}
                  >
                    <span className="truncate font-medium">{command.label}</span>
                    {command.shortcut ? (
                      <kbd className="ml-2 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {command.shortcut}
                      </kbd>
                    ) : null}
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
