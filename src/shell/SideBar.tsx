import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  CaseSensitive,
  ChevronDown,
  FilePlus,
  FileText,
  FolderOpen,
  ListCollapse,
  Regex,
  WholeWord,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FindReplaceOptions } from '@/lib/findReplace';
import {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type ExplorerSectionId = 'editors' | 'workspace' | 'recent';

const COLLAPSED_SECTIONS_STORAGE_KEY = 'markdowner.explorer.collapsedSections';

function readCollapsedSections(): Record<ExplorerSectionId, boolean> {
  const defaults: Record<ExplorerSectionId, boolean> = {
    editors: false,
    workspace: false,
    recent: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<ExplorerSectionId, boolean>>;
    return {
      editors: Boolean(parsed.editors),
      workspace: Boolean(parsed.workspace),
      recent: Boolean(parsed.recent),
    };
  } catch {
    return defaults;
  }
}

export type SideBarPanel = 'files' | 'search' | 'outline';

export interface OutlineItem {
  id: string;
  title: string;
  depth: number;
  titleStart: number;
  titleEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

export interface SearchResultMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
  absoluteOffset: number;
}

export interface SearchResultFile {
  path: string;
  matches: SearchResultMatch[];
}

export interface OpenEditorItem {
  id: string;
  name: string;
  path: string | null;
  isActive: boolean;
  isDirty: boolean;
  missing: boolean;
}

export interface SideBarProps {
  panel: SideBarPanel;
  isOpen: boolean;
  busy: boolean;
  workspaceName: string | null;
  workspaceFilter: string;
  onWorkspaceFilterChange: (value: string) => void;
  workspaceTreeLength: number;
  filteredWorkspaceTreeLength: number;
  openEditors: OpenEditorItem[];
  recentDocuments: string[];
  activeDocumentPath: string | null;
  rootDir: string | null;
  onNewDocument?: () => void;
  onOpenDocument?: () => void;
  onOpenWorkspace?: () => void;
  onCollapseWorkspaceFolders?: () => void;
  onSelectOpenEditor: (id: string) => void;
  onCloseOpenEditor: (id: string) => void;
  onOpenRecentDocument: (path: string) => void;
  renderWorkspaceTreeNodes: () => ReactNode;
  displayFileName: (path: string) => string;
  displayWorkspacePath: (path: string, rootDir: string | null) => string;
  outlineItems: OutlineItem[];
  outlineFontSize: number;
  outlineRowSpacing: number;
  onSelectOutlineItem?: (item: OutlineItem) => void;
  searchQuery: string;
  searchOptions: FindReplaceOptions;
  searchResults: SearchResultFile[];
  searchBusy: boolean;
  searchError: string | null;
  searchHasRun: boolean;
  searchAutoFocusToken: number;
  onSearchQueryChange: (value: string) => void;
  onSearchOptionsChange: (options: FindReplaceOptions) => void;
  onRunSearch: () => void;
  onSelectSearchMatch: (file: SearchResultFile, match: SearchResultMatch) => void;
}

export function SideBar({
  panel,
  isOpen,
  busy,
  workspaceName,
  workspaceFilter,
  onWorkspaceFilterChange,
  workspaceTreeLength,
  filteredWorkspaceTreeLength,
  openEditors,
  recentDocuments,
  activeDocumentPath,
  rootDir,
  onNewDocument,
  onOpenDocument,
  onOpenWorkspace,
  onCollapseWorkspaceFolders,
  onSelectOpenEditor,
  onCloseOpenEditor,
  onOpenRecentDocument,
  renderWorkspaceTreeNodes,
  displayFileName,
  displayWorkspacePath,
  outlineItems,
  outlineFontSize,
  outlineRowSpacing,
  onSelectOutlineItem,
  searchQuery,
  searchOptions,
  searchResults,
  searchBusy,
  searchError,
  searchHasRun,
  searchAutoFocusToken,
  onSearchQueryChange,
  onSearchOptionsChange,
  onRunSearch,
  onSelectSearchMatch,
}: SideBarProps) {
  const showOutline = panel === 'outline';
  const showSearch = panel === 'search';
  const showExplorer = !showOutline && !showSearch;
  const outlinePaddingY = Math.max(2, outlineRowSpacing + 2);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceSectionTitle = workspaceName ? workspaceName.toUpperCase() : 'NO FOLDER OPENED';

  const [collapsedSections, setCollapsedSections] = useState<Record<ExplorerSectionId, boolean>>(
    readCollapsedSections,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        COLLAPSED_SECTIONS_STORAGE_KEY,
        JSON.stringify(collapsedSections),
      );
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, [collapsedSections]);

  const toggleSection = useCallback((id: ExplorerSectionId) => {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const editorsCollapsed = collapsedSections.editors;
  const workspaceCollapsed = collapsedSections.workspace;
  const recentCollapsed = collapsedSections.recent;

  /**
   * Arrow-key navigation for the Explorer rows. Up/Down moves focus between
   * `[data-explorer-row]` elements within this aside. ArrowDown from the
   * filename filter input drops into the first row; ArrowUp from the first
   * row hops back to the filter. Other shortcuts (modifiers, typing) pass
   * through untouched.
   */
  const handleExplorerKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const aside = event.currentTarget;
    const active = (event.target as HTMLElement | null) ?? null;
    if (!active) return;
    const onFilter = active.matches('[data-explorer-filter]');
    const onRow = active.matches('[data-explorer-row]');
    if (!onFilter && !onRow) return;

    const rows = Array.from(aside.querySelectorAll<HTMLElement>('[data-explorer-row]'));
    if (rows.length === 0) return;

    if (onFilter) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        rows[0].focus();
      }
      return;
    }

    const currentIndex = rows.indexOf(active);
    if (currentIndex < 0) return;

    if (event.key === 'ArrowDown') {
      const next = rows[Math.min(currentIndex + 1, rows.length - 1)];
      if (next && next !== active) {
        event.preventDefault();
        next.focus();
      }
      return;
    }

    // ArrowUp
    if (currentIndex === 0) {
      const filter = aside.querySelector<HTMLInputElement>('[data-explorer-filter]');
      if (filter) {
        event.preventDefault();
        filter.focus();
        filter.select();
      }
      return;
    }
    const prev = rows[currentIndex - 1];
    if (prev) {
      event.preventDefault();
      prev.focus();
    }
  };

  useEffect(() => {
    if (!isOpen || !showSearch) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isOpen, showSearch, searchAutoFocusToken]);

  const totalMatches = searchResults.reduce((sum, file) => sum + file.matches.length, 0);

  return (
    <aside
      aria-label={showOutline ? 'Outline' : showSearch ? 'Search' : 'Explorer'}
      data-explorer-root={showExplorer ? '' : undefined}
      onKeyDown={showExplorer ? handleExplorerKeyDown : undefined}
      className={cn(
        'flex min-h-0 flex-col overflow-y-auto border-r border-border bg-sidebar text-sidebar-foreground transition-opacity duration-300 ease-in-out',
        showOutline || showSearch ? 'gap-5 p-5' : 'explorer-sidebar',
        !isOpen && 'opacity-0 invisible overflow-hidden p-0 border-r-0',
      )}
    >
      {showOutline ? (
        <section className="flex min-h-0 flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Outline
          </div>
          {outlineItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No headings
            </p>
          ) : (
            <ScrollArea className="max-h-[520px] pr-2">
              <div
                data-testid="outline-list"
                className="flex flex-col"
                style={{ gap: `${outlineRowSpacing}px` }}
              >
                {outlineItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center rounded-md border border-transparent px-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      fontSize: `${outlineFontSize}px`,
                      lineHeight: 1.25,
                      paddingTop: `${outlinePaddingY}px`,
                      paddingBottom: `${outlinePaddingY}px`,
                      paddingLeft: `${8 + Math.max(0, item.depth - 1) * 12}px`,
                    }}
                    disabled={busy}
                    onClick={() => onSelectOutlineItem?.(item)}
                  >
                    <span className="truncate font-medium">{item.title}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>
      ) : showSearch ? (
        <section
          data-testid="sidebar-search-panel"
          className="flex min-h-0 flex-col gap-2"
        >
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Search
          </div>
          <Input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onRunSearch();
              }
            }}
            placeholder="Search across workspace"
            aria-label="Search across workspace"
            data-testid="sidebar-search-input"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={searchOptions.caseSensitive ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Match case"
              aria-pressed={searchOptions.caseSensitive}
              title="Match case"
              onClick={() =>
                onSearchOptionsChange({
                  ...searchOptions,
                  caseSensitive: !searchOptions.caseSensitive,
                })
              }
            >
              <CaseSensitive className="size-4" />
            </Button>
            <Button
              type="button"
              variant={searchOptions.wholeWord ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Whole word"
              aria-pressed={searchOptions.wholeWord}
              title="Whole word"
              onClick={() =>
                onSearchOptionsChange({
                  ...searchOptions,
                  wholeWord: !searchOptions.wholeWord,
                })
              }
            >
              <WholeWord className="size-4" />
            </Button>
            <Button
              type="button"
              variant={searchOptions.regex ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Use regular expression"
              aria-pressed={searchOptions.regex}
              title="Use regular expression"
              onClick={() =>
                onSearchOptionsChange({
                  ...searchOptions,
                  regex: !searchOptions.regex,
                })
              }
            >
              <Regex className="size-4" />
            </Button>
          </div>
          {searchError ? (
            <p
              role="alert"
              data-testid="sidebar-search-error"
              className="text-xs text-destructive"
            >
              {searchError}
            </p>
          ) : null}
          {searchBusy ? (
            <p className="text-xs text-muted-foreground">Searching…</p>
          ) : searchHasRun ? (
            totalMatches === 0 ? (
              <p
                data-testid="sidebar-search-empty"
                className="text-xs text-muted-foreground"
              >
                No results
              </p>
            ) : (
              <p
                data-testid="sidebar-search-summary"
                className="text-xs text-muted-foreground"
              >
                {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {searchResults.length}{' '}
                {searchResults.length === 1 ? 'file' : 'files'}
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Type to search workspace and open files</p>
          )}
          {searchResults.length > 0 ? (
            <ScrollArea className="max-h-[520px] pr-1">
              <div className="flex flex-col gap-3">
                {searchResults.map((file) => (
                  <div key={file.path} className="flex flex-col gap-1">
                    <button
                      type="button"
                      className="flex flex-col items-start gap-0 truncate rounded-md px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                      title={file.path}
                      onClick={() => onSelectSearchMatch(file, file.matches[0])}
                    >
                      <span className="truncate text-xs font-semibold">
                        {displayFileName(file.path)}
                      </span>
                      <span className="w-full truncate text-[10px] text-muted-foreground">
                        {displayWorkspacePath(file.path, rootDir)}
                      </span>
                    </button>
                    <div className="flex flex-col gap-0.5 pl-2">
                      {file.matches.map((match, idx) => (
                        <button
                          key={`${file.path}-${match.absoluteOffset}-${idx}`}
                          type="button"
                          data-testid="sidebar-search-match"
                          className="flex items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => onSelectSearchMatch(file, match)}
                          title={`Line ${match.line}`}
                        >
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {match.line}
                          </span>
                          <span className="min-w-0 truncate">
                            {renderPreviewWithHighlight(match)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between px-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground">
              EXPLORER
            </div>
            <div className="flex items-center gap-0.5">
              {onNewDocument ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New File in Explorer"
                  title="New File"
                  disabled={busy}
                  onClick={onNewDocument}
                  className="h-6 w-6 rounded"
                >
                  <FilePlus className="size-3.5" />
                </Button>
              ) : null}
              {onOpenDocument ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open File"
                  title="Open File"
                  disabled={busy}
                  onClick={onOpenDocument}
                  className="h-6 w-6 rounded"
                >
                  <FileText className="size-3.5" />
                </Button>
              ) : null}
              {onOpenWorkspace ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open Workspace"
                  title="Open Workspace"
                  disabled={busy}
                  onClick={onOpenWorkspace}
                  className="h-6 w-6 rounded"
                >
                  <FolderOpen className="size-3.5" />
                </Button>
              ) : null}
              {onCollapseWorkspaceFolders ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse All"
                  title="Collapse All"
                  disabled={busy || workspaceTreeLength === 0}
                  onClick={onCollapseWorkspaceFolders}
                  className="h-6 w-6 rounded"
                >
                  <ListCollapse className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          <section className="explorer-section border-t border-sidebar-border/70">
            <button
              type="button"
              className="explorer-section-header w-full text-left hover:bg-sidebar-accent/40"
              aria-expanded={!editorsCollapsed}
              aria-controls="explorer-section-editors"
              onClick={() => toggleSection('editors')}
            >
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  editorsCollapsed && '-rotate-90',
                )}
                aria-hidden="true"
              />
              <span className="truncate">OPEN EDITORS</span>
            </button>
            {editorsCollapsed ? null : (
            <div
              id="explorer-section-editors"
              data-testid="explorer-open-editors"
              className="flex flex-col py-1"
            >
              {openEditors.length === 0 ? (
                <p className="px-5 py-1.5 text-xs text-muted-foreground/70">No open editors</p>
              ) : (
                openEditors.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'group flex min-h-6 items-center gap-1.5 px-2 text-xs',
                      item.isActive && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                      aria-label="Switch to open editor"
                      data-explorer-row=""
                      title={item.path ?? item.name}
                      onClick={() => onSelectOpenEditor(item.id)}
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className={cn('truncate', item.missing && 'line-through opacity-70')}>
                        {item.name}
                      </span>
                      {item.isDirty ? <span aria-label="Unsaved changes">•</span> : null}
                    </button>
                    <button
                      type="button"
                      className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted group-hover:opacity-100"
                      aria-label="Close open editor"
                      title={`Close ${item.name}`}
                      onClick={() => onCloseOpenEditor(item.id)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </div>
            )}
          </section>

          <section
            className={cn(
              'explorer-section flex flex-col border-t border-sidebar-border/70',
              workspaceCollapsed ? 'shrink-0' : 'min-h-0 flex-1',
            )}
          >
            <button
              type="button"
              className="explorer-section-header w-full text-left hover:bg-sidebar-accent/40"
              aria-expanded={!workspaceCollapsed}
              aria-controls="explorer-section-workspace"
              onClick={() => toggleSection('workspace')}
            >
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  workspaceCollapsed && '-rotate-90',
                )}
                aria-hidden="true"
              />
              <span className="truncate">{workspaceSectionTitle}</span>
            </button>
            {workspaceCollapsed ? null : workspaceTreeLength === 0 ? (
              <p className="px-5 py-1.5 text-xs text-muted-foreground/70">
                Open a folder to populate the file tree.
              </p>
            ) : (
              <>
                <Input
                  type="text"
                  value={workspaceFilter}
                  onChange={(event) => onWorkspaceFilterChange(event.target.value)}
                  placeholder="Filter files"
                  disabled={busy}
                  aria-label="Filter files"
                  data-explorer-filter=""
                  className="mx-3 mb-1 h-7 w-[calc(100%-1.5rem)] rounded-sm text-xs"
                />
                {filteredWorkspaceTreeLength === 0 ? (
                  <p className="px-3 text-xs text-muted-foreground">No files match this filter.</p>
                ) : (
                  <ScrollArea className="min-h-0 flex-1">
                    <div
                      id="explorer-section-workspace"
                      data-testid="explorer-workspace-tree"
                      className="flex flex-col py-1"
                    >
                      {renderWorkspaceTreeNodes()}
                    </div>
                  </ScrollArea>
                )}
              </>
            )}
          </section>

          <Separator />

          <section className="explorer-section flex shrink-0 flex-col border-t border-sidebar-border/70">
            <button
              type="button"
              className="explorer-section-header w-full text-left hover:bg-sidebar-accent/40"
              aria-expanded={!recentCollapsed}
              aria-controls="explorer-section-recent"
              onClick={() => toggleSection('recent')}
            >
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform',
                  recentCollapsed && '-rotate-90',
                )}
                aria-hidden="true"
              />
              <span className="truncate">RECENT</span>
            </button>
            {recentCollapsed ? null : recentDocuments.length === 0 ? (
              <p className="px-5 py-1.5 text-xs text-muted-foreground/70">Recent documents will appear here.</p>
            ) : (
              <div id="explorer-section-recent" className="flex flex-col py-1">
                {recentDocuments.slice(0, 5).map((path) => {
                  const isActive = path === activeDocumentPath;
                  return (
                    <button
                      key={path}
                      type="button"
                      className={cn(
                        'explorer-tree-row flex w-full items-center gap-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
                        isActive && 'bg-accent text-accent-foreground',
                      )}
                      data-explorer-row=""
                      onClick={() => onOpenRecentDocument(path)}
                      disabled={busy}
                      title={path}
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">
                        {displayFileName(path)}
                      </span>
                      <span className="sr-only" aria-hidden="true">{displayWorkspacePath(path, rootDir)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}

function renderPreviewWithHighlight(match: SearchResultMatch) {
  const { preview, matchStart, matchEnd } = match;
  const safeStart = Math.max(0, Math.min(matchStart, preview.length));
  const safeEnd = Math.max(safeStart, Math.min(matchEnd, preview.length));
  const before = preview.slice(0, safeStart);
  const hit = preview.slice(safeStart, safeEnd);
  const after = preview.slice(safeEnd);
  return (
    <>
      <span className="text-muted-foreground">{before}</span>
      <mark className="rounded bg-yellow-500/20 px-0.5 text-foreground">{hit}</mark>
      <span className="text-muted-foreground">{after}</span>
    </>
  );
}
