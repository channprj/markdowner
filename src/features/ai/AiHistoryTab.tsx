import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, LoaderCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  aiHistoryClear,
  aiHistoryDelete,
  aiHistoryDetail,
} from '@/lib/desktop';
import { taskLabel } from './AiActivityTab';
import type {
  AiHistoryDetail,
  AiHistoryPage,
  AiHistorySummary,
} from './types';

export interface AiHistoryServices {
  detail: (requestId: string) => Promise<AiHistoryDetail | null>;
  deleteRun: (requestId: string) => Promise<boolean>;
  clear: () => Promise<number>;
  copyPrompt: (prompt: string) => Promise<void>;
}

const DEFAULT_SERVICES: AiHistoryServices = {
  detail: aiHistoryDetail,
  deleteRun: aiHistoryDelete,
  clear: aiHistoryClear,
  copyPrompt: async (prompt) => navigator.clipboard.writeText(prompt),
};

export function AiHistoryTab({
  history,
  loading,
  error,
  onPageChange,
  onReload,
  onResumeInterview,
  resumableDocumentIds = [],
  services = DEFAULT_SERVICES,
}: {
  history: AiHistoryPage;
  loading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onReload: () => void | Promise<void>;
  onResumeInterview?: (requestId: string, documentId: string) => void;
  resumableDocumentIds?: readonly string[];
  services?: AiHistoryServices;
}) {
  const [detail, setDetail] = useState<AiHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(history.total / history.pageSize));

  const openDetail = async (requestId: string) => {
    setDetailLoading(true);
    setActionError(null);
    try {
      setDetail(await services.detail(requestId));
      setCopiedPromptId(null);
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setDetailLoading(false);
    }
  };

  const copyPrompt = async (run: AiHistoryDetail) => {
    if (!run.instruction) return;
    setActionError(null);
    try {
      await services.copyPrompt(run.instruction);
      setCopiedPromptId(run.id);
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  const deleteRun = async (requestId: string) => {
    if (!window.confirm('Delete this local AI history record?')) return;
    try {
      if (await services.deleteRun(requestId)) {
        if (detail?.id === requestId) setDetail(null);
        await onReload();
      }
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  const clearHistory = async () => {
    if (!window.confirm('Clear all local AI history? This cannot be undone.')) return;
    try {
      await services.clear();
      setDetail(null);
      onPageChange(0);
      await onReload();
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {history.total.toLocaleString()} local {history.total === 1 ? 'run' : 'runs'}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={history.total === 0}
          onClick={() => void clearHistory()}
        >
          <Trash2 className="size-3" />
          Clear history
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && history.items.length === 0 ? (
          <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Loading history…
          </p>
        ) : history.items.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No saved AI runs yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {history.items.map((run) => (
              <HistoryRow
                key={run.id}
                run={run}
                onOpen={() => void openDetail(run.id)}
                onDelete={() => void deleteRun(run.id)}
              />
            ))}
          </ul>
        )}

        {detailLoading ? (
          <p className="p-3 text-xs text-muted-foreground">Loading run detail…</p>
        ) : detail ? (
          <HistoryDetail
            detail={detail}
            resumableDocumentIds={resumableDocumentIds}
            onResumeInterview={onResumeInterview}
            promptCopied={copiedPromptId === detail.id}
            onCopyPrompt={() => void copyPrompt(detail)}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Previous history page"
          disabled={history.page <= 0 || loading}
          onClick={() => onPageChange(history.page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {history.page + 1} / {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Next history page"
          disabled={history.page + 1 >= totalPages || loading}
          onClick={() => onPageChange(history.page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      {error || actionError ? (
        <p role="alert" className="px-3 pb-3 text-xs text-destructive">
          {actionError || error}
        </p>
      ) : null}
    </div>
  );
}

function HistoryRow({
  run,
  onOpen,
  onDelete,
}: {
  run: AiHistorySummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        aria-label={`Open run ${run.id}`}
        onClick={onOpen}
      >
        <span className="block truncate text-sm font-medium">{taskLabel(run.task)}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {run.status} · {run.model}
        </span>
      </button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`Delete run ${run.id}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

function HistoryDetail({
  detail,
  resumableDocumentIds,
  onResumeInterview,
  promptCopied,
  onCopyPrompt,
}: {
  detail: AiHistoryDetail;
  resumableDocumentIds: readonly string[];
  onResumeInterview?: (requestId: string, documentId: string) => void;
  promptCopied: boolean;
  onCopyPrompt: () => void;
}) {
  const scope = parseObject(detail.scopeJson);
  const result = parseObject(detail.resultJson);
  const error = parseObject(detail.errorJson);
  const usage = parseObject(detail.usageJson);
  const duration =
    detail.finishedAt === null ? null : Math.max(0, detail.finishedAt - detail.startedAt);
  const documentId = scopeDocumentId(scope);
  const resumable =
    detail.task === 'prd' &&
    (detail.status === 'running' || detail.status === 'interrupted') &&
    documentId !== null;
  const documentIsOpen = documentId !== null && resumableDocumentIds.includes(documentId);
  return (
    <section aria-label="AI history detail" className="border-t border-border p-3 text-xs">
      <h3 className="text-sm font-semibold">{taskLabel(detail.task)}</h3>
      <dl className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-muted-foreground">Model</dt><dd className="break-all">{detail.model}</dd>
        <dt className="text-muted-foreground">Status</dt><dd>{detail.status}</dd>
        <dt className="text-muted-foreground">Scope</dt><dd>{scopeLabel(scope)}</dd>
        <dt className="text-muted-foreground">Duration</dt><dd>{duration === null ? 'In progress' : `${duration} seconds`}</dd>
      </dl>
      <div className="mt-3 rounded-md border border-border bg-muted/20 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium">User prompt</h4>
          {detail.instruction ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              aria-label="Copy user prompt"
              onClick={onCopyPrompt}
            >
              {promptCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {promptCopied ? 'Copied' : 'Copy'}
            </Button>
          ) : null}
        </div>
        {detail.instruction ? (
          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
            {detail.instruction}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">No additional user prompt was provided.</p>
        )}
      </div>
      <div className="mt-3">
        <h4 className="font-medium">Request details</h4>
        <dl className="mt-1 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
          <dt className="text-muted-foreground">Request ID</dt>
          <dd className="break-all font-mono text-[11px]">{detail.id}</dd>
          <dt className="text-muted-foreground">Prompt version</dt>
          <dd className="break-all">{detail.promptVersion}</dd>
          <dt className="text-muted-foreground">Source revision</dt>
          <dd className="break-all font-mono text-[11px]">{detail.sourceHash}</dd>
          <dt className="text-muted-foreground">Target language</dt>
          <dd>{detail.targetLanguage || 'Source language'}</dd>
          <dt className="text-muted-foreground">Output limit</dt>
          <dd>
            {detail.maxOutputTokens === null
              ? 'Not recorded'
              : `${detail.maxOutputTokens.toLocaleString()} tokens`}
          </dd>
          <dt className="text-muted-foreground">Data retention</dt>
          <dd>
            {detail.zdrOnly === null
              ? 'Not recorded'
              : detail.zdrOnly
                ? 'Zero Data Retention only'
                : 'Provider retention allowed'}
          </dd>
        </dl>
      </div>
      {resumable && documentIsOpen && onResumeInterview ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => onResumeInterview(detail.id, documentId)}
        >
          Resume PRD interview
        </Button>
      ) : resumable ? (
        <p className="mt-3 rounded-md border border-border bg-muted/30 p-2 text-muted-foreground">
          Open the interview document to resume this session.
        </p>
      ) : null}
      {detail.interviewTurns?.length ? (
        <div className="mt-3">
          <h4 className="font-medium">Interview</h4>
          {detail.interviewTurns.map((turn) => (
            <div key={turn.position} className="mt-2 rounded border border-border p-2">
              <p className="font-medium">{turn.question}</p>
              <p className="mt-1 text-muted-foreground">{turn.skipped ? 'Skipped' : turn.answer}</p>
            </div>
          ))}
        </div>
      ) : null}
      {result ? <DetailJson heading="Validated result" value={result} preferred="summary" /> : null}
      {error ? (
        <DetailJson heading="Error" value={error} preferred="message" showDetails />
      ) : null}
      {usage ? (
        <div className="mt-3">
          <h4 className="font-medium">Usage</h4>
          <p className="mt-1 text-muted-foreground">
            {numberValue(usage.promptTokens)} prompt · {numberValue(usage.completionTokens)} completion
          </p>
          {typeof usage.costUsd === 'number' ? <p>USD {usage.costUsd.toFixed(4)}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function scopeDocumentId(scope: Record<string, unknown> | null): string | null {
  const target = scope?.target;
  if (!target || typeof target !== 'object' || !('documentId' in target)) return null;
  return typeof target.documentId === 'string' ? target.documentId : null;
}

function DetailJson({
  heading,
  value,
  preferred,
  showDetails = false,
}: {
  heading: string;
  value: Record<string, unknown>;
  preferred: string;
  showDetails?: boolean;
}) {
  const details = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== preferred),
  );
  return (
    <div className="mt-3">
      <h4 className="font-medium">{heading}</h4>
      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
        {typeof value[preferred] === 'string' ? value[preferred] : JSON.stringify(value, null, 2)}
      </p>
      {showDetails && Object.keys(details).length > 0 ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(details, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function scopeLabel(scope: Record<string, unknown> | null): string {
  const target = scope?.target;
  if (target && typeof target === 'object' && 'label' in target) return String(target.label);
  if (typeof scope?.documentId === 'string') return scope.documentId;
  if (typeof scope?.rootPath === 'string') return scope.rootPath;
  return typeof scope?.kind === 'string' ? scope.kind : 'Unknown';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) return String(reason.message);
  return String(reason || 'History action failed.');
}
