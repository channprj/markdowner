import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

export interface SideBarProps {
  isOpen: boolean;
  busy: boolean;
  workspaceFilter: string;
  onWorkspaceFilterChange: (value: string) => void;
  workspaceTreeLength: number;
  filteredWorkspaceTreeLength: number;
  recentDocuments: string[];
  activeDocumentPath: string | null;
  rootDir: string | null;
  onNewDocument: () => void;
  onOpenWorkspace: () => void;
  onOpenDocument: () => void;
  onOpenRecentDocument: (path: string) => void;
  renderWorkspaceTreeNodes: () => ReactNode;
  displayFileName: (path: string) => string;
  displayWorkspacePath: (path: string, rootDir: string | null) => string;
}

export function SideBar({
  isOpen,
  busy,
  workspaceFilter,
  onWorkspaceFilterChange,
  workspaceTreeLength,
  filteredWorkspaceTreeLength,
  recentDocuments,
  activeDocumentPath,
  rootDir,
  onNewDocument,
  onOpenWorkspace,
  onOpenDocument,
  onOpenRecentDocument,
  renderWorkspaceTreeNodes,
  displayFileName,
  displayWorkspacePath,
}: SideBarProps) {
  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-border bg-sidebar p-5 text-sidebar-foreground transition-opacity duration-300 ease-in-out',
        !isOpen && 'opacity-0 invisible overflow-hidden p-0 border-r-0',
      )}
    >
      <div className="space-y-2">
        <Badge variant="secondary" className="uppercase tracking-wider">
          Markdowner
        </Badge>
        <h1 className="text-xl font-bold leading-tight">Write Markdown with confidence</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Work locally, keep your files intact, and switch between WYSIWYG, Source, and Preview
          without losing your place.
        </p>
      </div>

      <Separator />

      <section className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Workspace
        </div>
        <Button onClick={onNewDocument} disabled={busy}>
          New Document
        </Button>
        <Button variant="outline" onClick={onOpenWorkspace} disabled={busy}>
          Open Folder…
        </Button>
        <Button variant="outline" onClick={onOpenDocument} disabled={busy}>
          Open Markdown…
        </Button>
      </section>

      <Separator />

      <section className="flex min-h-0 flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </div>
        {workspaceTreeLength === 0 ? (
          <p className="text-xs text-muted-foreground">
            Open a folder to populate the file tree.
          </p>
        ) : (
          <>
            <Input
              type="text"
              value={workspaceFilter}
              onChange={(event) => onWorkspaceFilterChange(event.target.value)}
              placeholder="Search this workspace"
              disabled={busy}
              aria-label="Filter files"
            />
            {filteredWorkspaceTreeLength === 0 ? (
              <p className="text-xs text-muted-foreground">No files match this filter.</p>
            ) : (
              <ScrollArea className="max-h-[360px] pr-2">
                <div className="flex flex-col gap-1">
                  {renderWorkspaceTreeNodes()}
                </div>
              </ScrollArea>
            )}
          </>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent
        </div>
        {recentDocuments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Recent documents will appear here.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {recentDocuments.slice(0, 5).map((path) => {
              const isActive = path === activeDocumentPath;
              return (
                <button
                  key={path}
                  type="button"
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-md border border-transparent px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
                    isActive && 'border-border bg-accent text-accent-foreground',
                  )}
                  onClick={() => onOpenRecentDocument(path)}
                  disabled={busy}
                  title={path}
                >
                  <span className="truncate font-medium">{displayFileName(path)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {displayWorkspacePath(path, rootDir)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}
