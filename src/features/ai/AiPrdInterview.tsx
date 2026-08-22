import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  aiInterviewAnswer,
  aiInterviewFinish,
  aiInterviewResume,
  aiInterviewSkip,
  aiInterviewStart,
  aiInterviewUpdateAnswer,
  aiRun,
} from '@/lib/desktop';
import { AI_INTERVIEW_OUTPUT_TOKEN_LIMIT } from './model';
import type {
  AiInterviewContinueRequest,
  AiInterviewSession,
  AiInterviewStartRequest,
  AiRunRequest,
  AiRunResult,
  AiRunScope,
  AiStreamEvent,
} from './types';

export interface AiPrdInterviewServices {
  startInterview: (request: AiInterviewStartRequest) => Promise<AiInterviewSession>;
  answerInterview: (request: AiInterviewContinueRequest) => Promise<AiInterviewSession>;
  skipInterview: (request: AiInterviewContinueRequest) => Promise<AiInterviewSession>;
  updateAnswer: (
    requestId: string,
    position: number,
    answer: string,
  ) => Promise<AiInterviewSession>;
  finishInterview: (
    requestId: string,
    answer: string | null,
  ) => Promise<AiInterviewSession>;
  resumeInterview: (requestId: string) => Promise<AiInterviewSession | null>;
  run: (
    request: AiRunRequest,
    onEvent: (event: AiStreamEvent) => void,
  ) => Promise<AiRunResult>;
}

const DEFAULT_SERVICES: AiPrdInterviewServices = {
  startInterview: aiInterviewStart,
  answerInterview: aiInterviewAnswer,
  skipInterview: aiInterviewSkip,
  updateAnswer: aiInterviewUpdateAnswer,
  finishInterview: aiInterviewFinish,
  resumeInterview: aiInterviewResume,
  run: aiRun,
};

export function AiPrdInterview({
  documentId,
  source,
  model,
  maxOutputTokens,
  instruction,
  scope,
  zdrOnly,
  recordHistory,
  disabled,
  resumeRequestId = null,
  services = DEFAULT_SERVICES,
  onStart,
  onFailure,
  onResult,
}: {
  documentId: string;
  source: string;
  model: string;
  maxOutputTokens: number;
  instruction: string | null;
  scope: AiRunScope;
  zdrOnly: boolean;
  recordHistory: boolean;
  disabled: boolean;
  resumeRequestId?: string | null;
  services?: AiPrdInterviewServices;
  onStart?: (request: AiRunRequest) => void;
  onFailure?: (request: AiRunRequest, reason: unknown) => void;
  onResult: (result: AiRunResult, request: AiRunRequest) => void;
}) {
  const storageKey = useMemo(() => `markdowner.ai.prd-interview.${documentId}`, [documentId]);
  const [session, setSession] = useState<AiInterviewSession | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showPrior, setShowPrior] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    const requestId = resumeRequestId ?? localStorage.getItem(storageKey);
    if (!requestId) return;
    setBusy(true);
    services
      .resumeInterview(requestId)
      .then((resumed) => {
        if (cancelled) return;
        if (resumed && resumed.documentId === documentId && resumed.status !== 'completed') {
          localStorage.setItem(storageKey, requestId);
          setSession(resumed);
        } else {
          localStorage.removeItem(storageKey);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, resumeRequestId, services, storageKey]);

  const current = session?.turns[session.turns.length - 1] ?? null;
  const priorTurns = session?.turns.slice(0, -1) ?? [];

  const start = async () => {
    const requestId = createRequestId();
    setBusy(true);
    setError('');
    setStatus('Finding the highest-impact PRD decision…');
    try {
      const next = await services.startInterview({
        requestId,
        documentId,
        source,
        model,
        instruction,
        zdrOnly,
        maxOutputTokens: AI_INTERVIEW_OUTPUT_TOKEN_LIMIT,
        scope,
      });
      localStorage.setItem(storageKey, requestId);
      setSession(next);
      setStatus('');
    } catch (reason) {
      setError(errorMessage(reason));
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const continueInterview = async () => {
    if (!session || busy) return;
    if (isEnoughIntent(answer)) {
      setFinishOpen(true);
      return;
    }
    if (!answer.trim()) {
      setError('Enter an answer or skip this question.');
      return;
    }
    await requestNextQuestion(false);
  };

  const requestNextQuestion = async (skip: boolean) => {
    if (!session) return;
    setBusy(true);
    setError('');
    setStatus('Preparing the next decision…');
    const request: AiInterviewContinueRequest = {
      requestId: session.requestId,
      source,
      answer: skip ? null : answer.trim(),
      instruction,
      zdrOnly,
      maxOutputTokens: AI_INTERVIEW_OUTPUT_TOKEN_LIMIT,
    };
    try {
      const next = skip
        ? await services.skipInterview(request)
        : await services.answerInterview(request);
      setSession(next);
      setAnswer('');
      setStatus('');
    } catch (reason) {
      setError(errorMessage(reason));
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!session) return;
    setFinishOpen(false);
    setBusy(true);
    setError('');
    setStatus('Generating the PRD for review…');
    const finalAnswer = isEnoughIntent(answer) ? null : answer.trim() || null;
    const runRequest: AiRunRequest = {
      requestId: session.requestId,
      documentId,
      source,
      selection: null,
      task: 'prd',
      model: session.model,
      targetLanguage: null,
      instruction,
      zdrOnly,
      maxOutputTokens,
      recordHistory,
      scope: session.scope,
      interviewId: session.requestId,
    };
    try {
      const ready = await services.finishInterview(session.requestId, finalAnswer);
      setSession(ready);
      onStart?.(runRequest);
      const result = await services.run(runRequest, (event) => {
        if (event.type === 'progress') {
          setStatus(`Generating the PRD · ${event.receivedCharacters} characters`);
        }
      });
      localStorage.removeItem(storageKey);
      setSession(null);
      setAnswer('');
      setStatus('PRD result is ready for review.');
      onResult(result, runRequest);
    } catch (reason) {
      onFailure?.(runRequest, reason);
      setError(errorMessage(reason));
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const saveEditedAnswer = async () => {
    if (!session || editingPosition === null || !editDraft.trim()) return;
    setBusy(true);
    setError('');
    try {
      setSession(
        await services.updateAnswer(
          session.requestId,
          editingPosition,
          editDraft.trim(),
        ),
      );
      setEditingPosition(null);
      setEditDraft('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="text-sm font-medium">Guided PRD interview</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          AI resolves facts from the draft, asks one product decision at a time, and offers an
          editable recommendation. It continues until you say the draft is sufficient.
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3"
          disabled={disabled || busy}
          onClick={() => void start()}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : null}
          Start PRD interview
        </Button>
        <Status error={error} status={status} busy={busy} />
      </div>
    );
  }

  return (
    <section aria-label="PRD interview" aria-busy={busy} className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Guided PRD interview</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          Question {current ? current.position + 1 : session.turns.length}
        </span>
      </div>

      {priorTurns.length > 0 ? (
        <div className="mt-3 border-b border-border pb-3">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground"
            aria-expanded={showPrior}
            onClick={() => setShowPrior((value) => !value)}
          >
            {showPrior ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Prior answers ({priorTurns.length})
          </button>
          {showPrior ? (
            <ol className="mt-2 grid gap-2">
              {priorTurns.map((turn) => (
                <li key={turn.id} className="rounded bg-muted/40 p-2 text-xs">
                  <p className="font-medium">{turn.question}</p>
                  {editingPosition === turn.position ? (
                    <div className="mt-2 grid gap-2">
                      <input
                        aria-label={`Edit answer ${turn.position + 1}`}
                        className="h-8 rounded-md border border-input bg-background px-2"
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setEditingPosition(null);
                            setEditDraft('');
                          } else if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveEditedAnswer();
                          }
                        }}
                      />
                      <Button type="button" size="sm" onClick={() => void saveEditedAnswer()}>Save answer</Button>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-start justify-between gap-2 text-muted-foreground">
                      <span>{turn.skipped ? 'Skipped' : turn.answer}</span>
                      {!turn.skipped ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-6"
                          aria-label={`Edit answer ${turn.position + 1}`}
                          onClick={() => {
                            setEditingPosition(turn.position);
                            setEditDraft(turn.answer ?? '');
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {current ? (
        <div className="mt-3" aria-live="polite">
          <p className="text-sm font-medium leading-relaxed">{current.question}</p>
          {current.rationale ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{current.rationale}</p>
          ) : null}
          {current.recommendedAnswer ? (
            <div
              aria-label="Recommended answer"
              className="mt-3 rounded-md border border-border bg-muted/30 p-2.5"
            >
              <p className="text-xs font-medium">Recommended answer</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {current.recommendedAnswer}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy}
                onClick={() => setAnswer(current.recommendedAnswer)}
              >
                Use recommended answer
              </Button>
            </div>
          ) : null}
          <label htmlFor="ai-prd-answer" className="mt-3 block text-xs font-medium">Your answer</label>
          <textarea
            id="ai-prd-answer"
            aria-label="Your answer"
            rows={4}
            className="mt-1 w-full resize-y rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={answer}
            disabled={busy}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void continueInterview();
              }
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void continueInterview()}>
              Continue interview
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void requestNextQuestion(true)}>
              Skip
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setFinishOpen(true)}>
              Generate Now
            </Button>
          </div>
        </div>
      ) : null}

      <Status error={error} status={status} busy={busy} />

      {finishOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Finish PRD interview?" className="mt-3 rounded-md border border-border bg-background p-3 shadow-lg">
          <p className="text-sm font-medium">Finish PRD interview?</p>
          <p className="mt-1 text-xs text-muted-foreground">The interview stops only after this confirmation. The generated PRD will open in Review.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setFinishOpen(false)}>Keep interviewing</Button>
            <Button type="button" size="sm" onClick={() => void finish()}>Generate PRD</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Status({ error, status, busy }: { error: string; status: string; busy: boolean }) {
  return (
    <p aria-live="polite" className={`mt-2 min-h-4 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      {busy && !error ? <LoaderCircle className="mr-1 inline size-3 animate-spin" /> : null}
      {error || status}
    </p>
  );
}

function isEnoughIntent(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase().replace(/[.!?。！？]+$/u, '');
  return normalized === 'enough' || normalized === '충분합니다' || normalized === '충분해요';
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ai-prd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) return String(reason.message);
  return String(reason || 'The PRD interview could not continue.');
}
