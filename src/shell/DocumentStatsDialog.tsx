import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DocumentStats } from '@/lib/documentStats';

interface DocumentStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentName: string | null;
  documentPath: string | null;
  stats: DocumentStats;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function DocumentStatsDialog({
  open,
  onOpenChange,
  documentName,
  documentPath,
  stats,
}: DocumentStatsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Document Stats</DialogTitle>
          <DialogDescription>
            Quick writing metrics for the current Markdown document.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="truncate text-sm font-medium">{documentName ?? 'Untitled.md'}</p>
            {documentPath ? (
              <p className="truncate text-xs text-muted-foreground" title={documentPath}>
                {documentPath}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-lg font-semibold leading-none">{stats.words}</p>
              <p className="mt-1 text-xs text-muted-foreground">Words</p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-lg font-semibold leading-none">{stats.characters}</p>
              <p className="mt-1 text-xs text-muted-foreground">Characters</p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-lg font-semibold leading-none">~{stats.readingTimeMinutes} min</p>
              <p className="mt-1 text-xs text-muted-foreground">Reading time</p>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-lg font-semibold leading-none">{stats.headings}</p>
              <p className="mt-1 text-xs text-muted-foreground">Headings</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-1">
              {formatCount(stats.links, 'link', 'links')}
            </span>
            <span className="rounded-full border border-border px-2 py-1">
              {formatCount(stats.images, 'image', 'images')}
            </span>
            <span className="rounded-full border border-border px-2 py-1">
              {formatCount(stats.tables, 'table', 'tables')}
            </span>
          </div>
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
