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
import { fuzzyScore } from '@/lib/fuzzy';
import { hangulToQwerty } from '@/lib/hangulQwerty';

export interface CommandPaletteCommand {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Opens a nested picker in place of the root list instead of running an action. */
  submenu?: CommandPaletteSubmenu;
  /** Fired when this item is highlighted inside a submenu (drives live preview). */
  preview?: () => void;
  run?: () => void | Promise<void>;
}

/** A nested list shown in place of the root command list (VS Code / Zed style). */
export interface CommandPaletteSubmenu {
  /** Heading shown above the nested list. */
  title: string;
  /** Search placeholder while the nested list is open. */
  placeholder?: string;
  items: CommandPaletteCommand[];
  /** Item id to highlight when the submenu opens (e.g. the current value). */
  initialSelectedId?: string;
  /** Fired when the submenu is left without committing, to revert any preview. */
  onCancel?: () => void;
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
  const trimmed = query.trim();
  if (!trimmed) {
    return commands.slice(0, MAX_RESULTS);
  }
  // Match the query as typed and as its QWERTY romanization, so wrong-IME
  // Korean input (e.g. `샣힏`) scores the same as the English keys (`toggle`).
  // ASCII input romanizes to itself, so English search is unaffected.
  const romanized = hangulToQwerty(trimmed);
  const scored: Array<{ command: CommandPaletteCommand; score: number; order: number }> = [];
  commands.forEach((command, order) => {
    const haystack = `${command.label} ${command.category ?? ''}`;
    const score = Math.max(
      fuzzyScore(haystack, trimmed),
      romanized === trimmed ? 0 : fuzzyScore(haystack, romanized),
    );
    if (score > 0) {
      scored.push({ command, score, order });
    }
  });
  scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  return scored.slice(0, MAX_RESULTS).map((entry) => entry.command);
}

export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [submenu, setSubmenu] = useState<CommandPaletteSubmenu | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const activeCommands = submenu ? submenu.items : commands;
  const filtered = useMemo(
    () => filterCommands(activeCommands, query),
    [activeCommands, query],
  );
  const activeOptionId =
    filtered.length > 0 ? `${listboxId}-option-${highlightedIndex}` : undefined;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlightedIndex(0);
      setSubmenu(null);
    }
  }, [open]);

  // Live-preview the highlighted item while a submenu is open. Fires on open
  // (with the initial selection) and on every navigation/filter change.
  useEffect(() => {
    if (!submenu) return;
    filtered[highlightedIndex]?.preview?.();
  }, [submenu, filtered, highlightedIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLLIElement>('[data-active="true"]');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, filtered]);

  const enterSubmenu = (next: CommandPaletteSubmenu) => {
    const index = next.initialSelectedId
      ? next.items.findIndex((item) => item.id === next.initialSelectedId)
      : 0;
    setSubmenu(next);
    setQuery('');
    setHighlightedIndex(index >= 0 ? index : 0);
  };

  const exitSubmenu = () => {
    submenu?.onCancel?.();
    setSubmenu(null);
    setQuery('');
    setHighlightedIndex(0);
  };

  const commitSelection = (index: number) => {
    const target = filtered[index];
    if (!target || target.disabled) return;
    if (target.submenu) {
      enterSubmenu(target.submenu);
      return;
    }
    onOpenChange(false);
    void target.run?.();
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
        // Keep the dim, drop the blur: live previews (e.g. code-block theme)
        // must stay legible behind the palette.
        overlayClassName="bg-black/35 supports-backdrop-filter:backdrop-blur-none"
        onEscapeKeyDown={(event) => {
          // In a submenu, Escape steps back to the root list instead of closing.
          if (submenu) {
            event.preventDefault();
            exitSubmenu();
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search and run a command.</DialogDescription>
        </DialogHeader>
        {submenu ? (
          <div className="flex items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{submenu.title}</span>
            <span className="ml-auto">Esc to go back</span>
          </div>
        ) : null}
        <div className="border-b border-border px-3 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={submenu?.placeholder ?? 'Type a command…'}
            aria-label={submenu ? `${submenu.title} search` : 'Command palette search'}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            inputMode="text"
            className="h-9 border-0 shadow-none focus-visible:ring-0 px-1"
          />
        </div>
        <ul
          ref={listRef}
          id={listboxId}
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
              {activeCommands.length === 0 ? 'No commands available.' : 'No matches.'}
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
                    id={`${listboxId}-option-${index}`}
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
