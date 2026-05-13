import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Replace,
  Search,
  WholeWord,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FindReplaceOptions } from '@/lib/findReplace';

interface FindReplaceBarProps {
  query: string;
  replacement: string;
  replaceMode: boolean;
  options: FindReplaceOptions;
  activeMatchNumber: number;
  matchCount: number;
  error: string | null;
  canReplace: boolean;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onReplaceModeChange: (replaceMode: boolean) => void;
  onOptionsChange: (options: FindReplaceOptions) => void;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function FindReplaceBar({
  query,
  replacement,
  replaceMode,
  options,
  activeMatchNumber,
  matchCount,
  error,
  canReplace,
  onQueryChange,
  onReplacementChange,
  onReplaceModeChange,
  onOptionsChange,
  onPreviousMatch,
  onNextMatch,
  onReplace,
  onReplaceAll,
  onClose,
}: FindReplaceBarProps) {
  const findInputRef = useRef<HTMLInputElement | null>(null);
  // Buffer the find input locally so live typing does not re-run the search on
  // every keystroke. The committed query (parent state) only advances when the
  // user presses Enter.
  const [inputValue, setInputValue] = useState(query);
  const hasMatches = matchCount > 0;
  const hasPendingQuery = inputValue !== query;
  const replaceDisabled = !hasMatches || !canReplace || hasPendingQuery;
  const matchStatus = error
    ? error
    : hasPendingQuery
      ? 'Press Enter to search'
      : query.length === 0
        ? 'No query'
        : hasMatches
          ? `${activeMatchNumber} of ${matchCount}`
          : 'No matches';

  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  // Re-sync local input when the committed query changes from outside (e.g.
  // bar reopens with a previously-stored query).
  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const toggleOption = (key: keyof FindReplaceOptions) => {
    onOptionsChange({ ...options, [key]: !options[key] });
  };

  const handleContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Don't leak shortcuts to the editor; Enter handling is per-input below.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  // Find input: Enter commits a pending query, then subsequent Enter presses
  // navigate to next/previous match — matches VS Code's Find behavior.
  const handleFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (hasPendingQuery) {
      onQueryChange(inputValue);
      return;
    }
    if (event.shiftKey) {
      onPreviousMatch();
    } else {
      onNextMatch();
    }
  };

  // Replace input: Enter performs Replace on the current match; Cmd/Ctrl+Enter
  // (or Alt+Enter) performs Replace All. Pressing Enter never triggers replace
  // unless the user is focused inside this input.
  const handleReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (replaceDisabled) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      onReplaceAll();
    } else {
      onReplace();
    }
  };

  return (
    <div
      role="search"
      aria-label="Find and replace"
      className="absolute right-3 top-3 z-30 w-[min(34rem,calc(100%-1.5rem))] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-sm"
      onKeyDown={handleContainerKeyDown}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label className="sr-only" htmlFor="markdowner-find-text">
          Find text
        </label>
        <Input
          id="markdowner-find-text"
          ref={findInputRef}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleFindKeyDown}
          placeholder="Find"
          className="h-7 min-w-0 flex-1 text-sm"
          aria-invalid={error ? true : undefined}
        />
        <span
          role="status"
          aria-live="polite"
          className={cn(
            'w-20 shrink-0 text-right text-xs tabular-nums',
            error ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {matchStatus}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={!hasMatches}
          onClick={onPreviousMatch}
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={!hasMatches}
          onClick={onNextMatch}
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant={replaceMode ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={replaceMode ? 'Hide replace field' : 'Show replace field'}
          aria-pressed={replaceMode}
          title={replaceMode ? 'Hide replace field' : 'Show replace field'}
          onClick={() => onReplaceModeChange(!replaceMode)}
        >
          <Replace className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close find and replace"
          title="Close"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {replaceMode ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
          <div className="w-4 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <label className="sr-only" htmlFor="markdowner-replace-text">
              Replace text
            </label>
            <Input
              id="markdowner-replace-text"
              value={replacement}
              onChange={(event) => onReplacementChange(event.target.value)}
              onKeyDown={handleReplaceKeyDown}
              placeholder="Replace"
              className="h-7 min-w-0 flex-1 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={replaceDisabled}
              onClick={onReplace}
              title="Replace (Enter)"
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={replaceDisabled}
              onClick={onReplaceAll}
              title="Replace All (⌘Enter)"
            >
              Replace All
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={options.caseSensitive ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Match case"
            aria-pressed={options.caseSensitive}
            title="Match case"
            onClick={() => toggleOption('caseSensitive')}
          >
            <CaseSensitive className="size-4" />
          </Button>
          <Button
            type="button"
            variant={options.wholeWord ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Whole word"
            aria-pressed={options.wholeWord}
            title="Whole word"
            onClick={() => toggleOption('wholeWord')}
          >
            <WholeWord className="size-4" />
          </Button>
          <Button
            type="button"
            variant={options.regex ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label="Use regular expression"
            aria-pressed={options.regex}
            title="Use regular expression"
            onClick={() => toggleOption('regex')}
          >
            <Regex className="size-4" />
          </Button>
        </div>
        {replaceMode && !canReplace ? (
          <p className="truncate text-xs text-muted-foreground">
            Switch to Editor or Split View to replace.
          </p>
        ) : null}
      </div>
    </div>
  );
}
