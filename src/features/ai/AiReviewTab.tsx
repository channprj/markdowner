import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CopyPlus,
  FileDiff,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AiRunProgress } from './AiRunProgress';

import {
  isReviewSourceCurrent,
  renderLocalReviewOperations,
  resolveReviewActions,
  type AiReview,
} from './review';

export interface AiReviewTabProps {
  review: AiReview;
  currentSource: string | null;
  sourcePresent: boolean;
  onApply: (markdown: string) => void;
  onRenderSelected: (operationIds: string[]) => Promise<string>;
  onOpenAsDocument: (markdown: string) => void;
  onRerun: (review: AiReview) => void;
}

export function AiReviewTab({
  review,
  currentSource,
  sourcePresent,
  onApply,
  onRenderSelected,
  onOpenAsDocument,
  onRerun,
}: AiReviewTabProps) {
  const runResult = review.runResult;
  const document = runResult?.result ?? null;
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => document?.operations.map((operation) => operation.id) ?? [],
  );
  const [renderingSelection, setRenderingSelection] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const [translationView, setTranslationView] = useState<
    'split' | 'translation'
  >('split');
  const sourceScrollRef = useRef<HTMLElement>(null);
  const translationScrollRef = useRef<HTMLElement>(null);
  const synchronizingScroll = useRef(false);

  useEffect(() => {
    setSelectedIds(document?.operations.map((operation) => operation.id) ?? []);
    setSelectionError('');
    setTranslationView('split');
  }, [document]);

  const sourceCurrent = isReviewSourceCurrent(review, currentSource);
  const validationPassed =
    document?.validation.passed === true &&
    (runResult?.validationIssues.length ?? 0) === 0;
  const actions = resolveReviewActions({
    task: review.request.task,
    sourcePresent,
    sourceRevisionMatches: sourceCurrent,
    validationPassed,
  });
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEnabled =
    actions.applySelected && selectedIds.length > 0 && !renderingSelection;

  const handleApplySelected = async () => {
    if (!selectedEnabled) return;
    setRenderingSelection(true);
    setSelectionError('');
    try {
      onApply(
        review.origin.kind === 'localAgent'
          ? renderLocalReviewOperations(review, selectedIds)
          : await onRenderSelected(selectedIds),
      );
    } catch (reason) {
      setSelectionError(errorMessage(reason));
    } finally {
      setRenderingSelection(false);
    }
  };

  const usage = runResult?.usage ?? null;
  const localAgentLabel =
    review.origin.kind === 'localAgent'
      ? {
          claude: 'Claude Code',
          codex: 'Codex',
          opencode: 'OpenCode',
        }[review.origin.agent]
      : null;
  const cost =
    usage?.costUsd === null || usage?.costUsd === undefined
      ? 'cost unavailable'
      : `$${usage.costUsd.toFixed(4)} · ${
          usage.costCalculated ? 'calculated' : 'provider'
        }`;

  return (
    <main
      aria-labelledby="ai-review-heading"
      className="ai-motion-surface min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"
      data-testid="ai-review-tab"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              AI Review · {review.sourceDocumentName}
            </p>
            <h1
              id="ai-review-heading"
              className="mt-1 flex items-center gap-2 text-lg font-semibold"
            >
              <FileDiff className="size-5" />
              {review.request.task === 'summary'
                ? 'Summary proposal'
                : review.request.task === 'translation'
                  ? 'Translation proposal'
                  : review.request.task === 'custom'
                    ? 'Document transformation'
                    : 'PRD improvement proposal'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {review.status === 'running'
                ? 'The request is streaming. Results remain non-applicable until validation completes.'
                : review.statusMessage ??
                  document?.summary ??
                  'The response could not be validated.'}
            </p>
            {review.request.task === 'translation' && document ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Detected {document.detectedSourceLanguage ?? 'unknown'} · Target{' '}
                {document.targetLanguage ?? review.request.targetLanguage ?? 'unknown'}
              </p>
            ) : null}
            {review.request.task === 'summary' && document ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Detected {document.detectedSourceLanguage ?? 'unknown'} · Summary{' '}
                {document.targetLanguage ??
                  review.request.targetLanguage ??
                  'same as source'}
              </p>
            ) : null}
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {localAgentLabel ? (
              <p>{localAgentLabel}</p>
            ) : (
              <>
                <p>{runResult?.model ?? review.request.model}</p>
                {usage ? (
                  <>
                    <p>
                      Prompt {usage.promptTokens.toLocaleString()} · Completion{' '}
                      {usage.completionTokens.toLocaleString()} · Total{' '}
                      {usage.totalTokens.toLocaleString()}
                    </p>
                    <p>{cost}</p>
                  </>
                ) : (
                  <p>{cost}</p>
                )}
                {runResult?.generationId ? (
                  <p className="font-mono">{runResult.generationId}</p>
                ) : null}
              </>
            )}
          </div>
        </header>

        {review.status === 'running' && review.origin.kind === 'openrouter' ? (
          <AiRunProgress requestId={review.requestId} />
        ) : review.status === 'running' ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
          >
            <LoaderCircle className="size-4 animate-spin" />
            AI request in progress…
          </p>
        ) : null}

        {review.status === 'failed' || review.status === 'cancelled' ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {review.statusMessage}
          </p>
        ) : null}

        {!sourcePresent || !sourceCurrent ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {review.request.task === 'summary'
              ? !sourcePresent
                ? 'The source document is no longer open. This summary was generated from the captured source snapshot and can still be opened as a new document.'
                : 'The source document changed after this request. This summary remains based on the captured source snapshot and can only be opened as a new document.'
              : !sourcePresent
                ? 'The source document is no longer open. Apply is disabled.'
                : 'The source document changed after this request. Apply is disabled; rerun or open the proposal as a new document.'}
          </p>
        ) : null}

        {review.status === 'complete' && !validationPassed ? (
          <section
            aria-labelledby="ai-validation-heading"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-4"
          >
            <h2 id="ai-validation-heading" className="text-sm font-semibold">
              Local validation failed
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Markdowner will not apply or export this response.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {[
                ...(document?.validation.issues ?? []),
                ...(runResult?.validationIssues ?? []),
              ].map((issue, index) => (
                <li key={`${issue.code}:${issue.segmentId ?? index}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
            {runResult?.rawDiagnostic ? (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-medium">
                  Raw diagnostic
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-3">
                  {runResult.rawDiagnostic}
                </pre>
              </details>
            ) : null}
          </section>
        ) : null}

        {document ? (
          <>
            {review.request.task === 'translation' ? (
              <section aria-labelledby="ai-translation-comparison-heading">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="ai-translation-comparison-heading"
                    className="text-sm font-semibold"
                  >
                    Translation comparison
                  </h2>
                  <div
                    role="group"
                    aria-label="Translation view"
                    className="flex rounded-md border border-border p-0.5"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={translationView === 'split' ? 'secondary' : 'ghost'}
                      aria-pressed={translationView === 'split'}
                      aria-label="Show source and translation"
                      onClick={() => setTranslationView('split')}
                    >
                      Side by side
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        translationView === 'translation' ? 'secondary' : 'ghost'
                      }
                      aria-pressed={translationView === 'translation'}
                      aria-label="Show translation only"
                      onClick={() => setTranslationView('translation')}
                    >
                      Translation only
                    </Button>
                  </div>
                </div>
                <div
                  className={
                    translationView === 'split'
                      ? 'grid min-h-80 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2'
                      : 'grid min-h-80 overflow-hidden rounded-md border border-border'
                  }
                >
                  {translationView === 'split' ? (
                    <article
                      ref={sourceScrollRef}
                      className="max-h-[65vh] overflow-y-auto bg-background p-4"
                      onScroll={() =>
                        syncTranslationScroll(
                          sourceScrollRef.current,
                          translationScrollRef.current,
                          synchronizingScroll,
                        )
                      }
                    >
                      <h2 className="mb-3 text-sm font-semibold">Source</h2>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                        {review.sourceSnapshot}
                      </pre>
                    </article>
                  ) : null}
                  <article
                    ref={translationScrollRef}
                    className="max-h-[65vh] overflow-y-auto bg-background p-4"
                    onScroll={() =>
                      syncTranslationScroll(
                        translationScrollRef.current,
                        sourceScrollRef.current,
                        synchronizingScroll,
                      )
                    }
                  >
                    <h2 className="mb-3 text-sm font-semibold">Translation</h2>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {document.proposedMarkdown}
                    </pre>
                  </article>
                </div>
              </section>
            ) : null}

            {review.request.task === 'summary' ? (
              <section aria-labelledby="ai-summary-preview-heading">
                <h2
                  id="ai-summary-preview-heading"
                  className="text-sm font-semibold"
                >
                  Summary preview
                </h2>
                <pre className="mt-2 max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border border-border p-4 font-sans text-sm leading-relaxed">
                  {document.proposedMarkdown}
                </pre>
              </section>
            ) : null}

            {review.request.task !== 'summary' && document.findings.length > 0 ? (
              <section aria-labelledby="ai-findings-heading">
                <h2 id="ai-findings-heading" className="text-sm font-semibold">
                  Findings
                </h2>
                <div className="mt-2 grid gap-2">
                  {document.findings.map((finding) => (
                    <article
                      key={finding.id}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                          {finding.severity}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {finding.category}
                        </span>
                        {finding.evidenceSegmentId ? (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {finding.evidenceSegmentId}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm">{finding.rationale}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {review.request.task !== 'summary' ? (
            <section aria-labelledby="ai-changes-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="ai-changes-heading" className="text-sm font-semibold">
                  Proposed changes
                </h2>
                <span className="text-xs text-muted-foreground">
                  {selectedIds.length} of {document.operations.length} selected
                </span>
              </div>
              <div className="mt-2 grid gap-3">
                {document.hunks.map((hunk) => {
                  const operation = document.operations.find(
                    (candidate) => candidate.id === hunk.operationId,
                  );
                  const checked = selectedSet.has(hunk.operationId);
                  return (
                    <article
                      key={hunk.operationId}
                      className="overflow-hidden rounded-md border border-border"
                    >
                      <label className="flex cursor-pointer items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          aria-label={`Select change for ${
                            operation?.targetSegmentId ?? hunk.operationId
                          }`}
                          checked={checked}
                          disabled={!actions.applySelected}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...current, hunk.operationId]
                                : current.filter((id) => id !== hunk.operationId),
                            )
                          }
                        />
                        {operation?.kind.replace(/_/g, ' ') ?? 'change'} ·{' '}
                        {operation?.targetSegmentId ?? hunk.operationId}
                      </label>
                      <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-xs leading-relaxed">
                        <span className="block bg-red-500/10 text-red-800 dark:text-red-200">
                          − {hunk.originalMarkdown}
                        </span>
                        <span className="mt-1 block bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
                          + {hunk.proposedMarkdown}
                        </span>
                      </pre>
                    </article>
                  );
                })}
              </div>
            </section>
            ) : null}

            {document.assumptions.length > 0 || document.warnings.length > 0 ? (
              <section className="grid gap-3 md:grid-cols-2">
                {document.assumptions.length > 0 ? (
                  <div>
                    <h2 className="text-sm font-semibold">Assumptions</h2>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                      {document.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {document.warnings.length > 0 ? (
                  <div>
                    <h2 className="text-sm font-semibold">Warnings</h2>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                      {document.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}

        <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
          {review.request.task === 'summary' ? (
            <Button
              type="button"
              onClick={() => document && onOpenAsDocument(document.proposedMarkdown)}
              disabled={!actions.openAsDocument || !document}
            >
              <CopyPlus />
              Open summary as new document
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={() => document && onApply(document.proposedMarkdown)}
                disabled={!actions.applyAll || !document}
              >
                <Check />
                Apply all
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleApplySelected()}
                disabled={!selectedEnabled}
              >
                {renderingSelection ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <FileDiff />
                )}
                Apply selected
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  document && onOpenAsDocument(document.proposedMarkdown)
                }
                disabled={!actions.openAsDocument || !document}
              >
                <CopyPlus />
                Open as new document
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onRerun(review)}
            disabled={review.status === 'running'}
          >
            <RotateCcw />
            Rerun
          </Button>
          <p className="ml-auto text-[11px] text-muted-foreground">
            {review.origin.kind === 'localAgent'
              ? 'Markdowner applies this local-agent proposal only after your confirmation.'
              : 'Cancelling a request may not prevent provider usage charges.'}
          </p>
          {selectionError ? (
            <p role="alert" className="w-full text-xs text-destructive">
              {selectionError}
            </p>
          ) : null}
        </footer>
      </div>
    </main>
  );
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    return String(reason.message);
  }
  return reason instanceof Error ? reason.message : String(reason);
}

function syncTranslationScroll(
  source: HTMLElement | null,
  target: HTMLElement | null,
  synchronizing: { current: boolean },
) {
  if (!source || !target || synchronizing.current) return;
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  if (sourceRange <= 0 || targetRange <= 0) return;
  synchronizing.current = true;
  target.scrollTop = (source.scrollTop / sourceRange) * targetRange;
  window.requestAnimationFrame(() => {
    synchronizing.current = false;
  });
}
