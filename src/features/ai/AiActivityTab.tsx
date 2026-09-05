import { useEffect, useState } from 'react';
import { LoaderCircle, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AiActiveRun, AiTask } from './types';

export function AiActivityTab({
  runs,
  loading = false,
  error = null,
  nowSeconds,
  onCancel,
}: {
  runs: readonly AiActiveRun[];
  loading?: boolean;
  error?: string | null;
  nowSeconds?: number;
  onCancel: (requestId: string) => void;
}) {
  const now = useLiveNow(nowSeconds);

  if (loading && runs.length === 0) {
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading active requests…
      </p>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No active AI requests</p>
        <p className="mt-1 text-xs leading-relaxed">
          Requests continue here even when you switch documents.
        </p>
        {error ? <p className="mt-2 text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {runs.map((run) => (
        <article key={run.requestId} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{taskLabel(run.task)}</h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {run.model}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {run.status}
            </span>
          </div>
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {scopeLabel(run)}
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            <time dateTime={new Date(run.startedAt * 1_000).toISOString()}>
              Started {formatStartTime(run.startedAt)}
            </time>
            {' · '}
            {formatElapsed(now - run.startedAt)} elapsed
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              {progressLabel(run) ? (
                <p className="truncate text-xs font-medium tabular-nums">
                  {progressLabel(run)}
                </p>
              ) : run.progress.receivedCharacters > 0 ? (
                <p className="text-sm font-medium tabular-nums">
                  {run.progress.receivedCharacters.toLocaleString()} characters
                </p>
              ) : (
                <p className="text-sm font-medium capitalize">{run.progress.stage || 'Preparing'}</p>
              )}
              {progressLabel(run) && run.progress.receivedCharacters > 0 ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {run.progress.receivedCharacters.toLocaleString()} characters received
                </p>
              ) : null}
              <ActivityProgressBar run={run} />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Cancel ${taskLabel(run.task)}`}
              disabled={!run.cancelable}
              onClick={() => onCancel(run.requestId)}
            >
              <Square className="size-3" />
              Cancel
            </Button>
          </div>
        </article>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function useLiveNow(nowSeconds: number | undefined): number {
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    if (nowSeconds !== undefined) return undefined;
    const timer = window.setInterval(() => {
      setClock(Math.floor(Date.now() / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [nowSeconds]);
  return nowSeconds ?? clock;
}

function ActivityProgressBar({ run }: { run: AiActiveRun }) {
  const completed = run.progress.chunkCompleted ?? run.progress.fileCompleted;
  const total = run.progress.chunkTotal ?? run.progress.fileTotal;
  if (completed === null || total === null || total <= 0) return null;
  const bounded = Math.max(0, Math.min(completed, total));
  return (
    <div
      role="progressbar"
      aria-label={`${taskLabel(run.task)} progress`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={bounded}
      className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300"
        style={{ width: `${(bounded / total) * 100}%` }}
      />
    </div>
  );
}

function progressLabel(run: AiActiveRun): string {
  const parts: string[] = [];
  if (run.progress.fileCompleted !== null && run.progress.fileTotal !== null) {
    parts.push(`Files ${run.progress.fileCompleted}/${run.progress.fileTotal}`);
  }
  if (run.progress.chunkCompleted !== null && run.progress.chunkTotal !== null) {
    parts.push(`Chunks ${run.progress.chunkCompleted}/${run.progress.chunkTotal}`);
  }
  if (run.progress.label) parts.push(run.progress.label);
  return parts.join(' · ');
}

function formatStartTime(startedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(startedAt * 1_000));
}

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainder = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function taskLabel(task: AiTask): string {
  if (task === 'prd') return 'Improve PRD';
  if (task === 'summary') return 'Summarize document';
  if (task === 'translation') return 'Translate document';
  return 'Custom prompt';
}

function scopeLabel(run: AiActiveRun): string {
  if (run.scope.kind === 'document') return run.scope.target.label;
  return run.scope.target?.label ?? `${run.scope.documentCount} Markdown files`;
}
