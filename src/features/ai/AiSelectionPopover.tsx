import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Sparkles, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  aiCancel,
  aiKeyStatus,
  aiListModels,
  aiModelPricing,
  aiRun,
} from '@/lib/desktop';
import type { Settings } from '@/lib/settings';

import {
  hasNoZdrEndpoint,
  NON_ZDR_CONFIRMATION_LABEL,
  NO_ZDR_ENDPOINT_REASON,
  outputTokenLimitForTask,
  orderModels,
  resolveUsageCost,
} from './model';
import type { AiSelectionSnapshot } from './selection';
import {
  resolveSelectionInstruction,
  SELECTION_ACTIONS,
  type SelectionActionId,
} from './selectionActions';
import { AI_METADATA_UI_TIMEOUT_MS } from './requestTimeout';
import type {
  AiKeyStatus,
  AiModel,
  AiModelPricing,
  AiRunRequest,
  AiRunResult,
  AiStreamEvent,
} from './types';

export interface AiSelectionServices {
  keyStatus: () => Promise<AiKeyStatus>;
  listModels: () => Promise<AiModel[]>;
  modelPricing?: (
    modelId: string,
    zdrOnly: boolean,
  ) => Promise<AiModelPricing>;
  run: (
    request: AiRunRequest,
    onEvent: (event: AiStreamEvent) => void,
  ) => Promise<AiRunResult>;
  cancel: (requestId: string) => Promise<boolean>;
}

export interface AiSelectionPopoverProps {
  snapshot: AiSelectionSnapshot;
  settings: Settings;
  onClose: () => void;
  onResult: (
    result: AiRunResult,
    snapshot: AiSelectionSnapshot,
    request: AiRunRequest,
  ) => void;
  onLocalAgent?: (snapshot: AiSelectionSnapshot) => void;
  services?: AiSelectionServices;
}

const DEFAULT_SERVICES: AiSelectionServices = {
  keyStatus: aiKeyStatus,
  listModels: aiListModels,
  modelPricing: aiModelPricing,
  run: aiRun,
  cancel: aiCancel,
};

export function AiSelectionPopover({
  snapshot,
  settings,
  onClose,
  onResult,
  onLocalAgent,
  services = DEFAULT_SERVICES,
}: AiSelectionPopoverProps) {
  const [prompt, setPrompt] = useState('');
  const [actionId, setActionId] = useState<SelectionActionId>('improve');
  const [models, setModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState(settings.aiCustomPromptModel);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [livePricing, setLivePricing] = useState<{
    modelId: string;
    pricing: AiModelPricing;
  } | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [confirmedNonZdr, setConfirmedNonZdr] = useState(false);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let catalogTimeout: number | undefined;
    services
      .keyStatus()
      .then((keyStatus) => {
        if (cancelled) return;
        setConfigured(keyStatus.configured);
        if (!keyStatus.configured) return;
        setCatalogError('');
        setCatalogLoading(true);
        catalogTimeout = window.setTimeout(() => {
          if (cancelled) return;
          cancelled = true;
          setCatalogLoading(false);
          setCatalogError('The model catalog did not respond. Try again.');
        }, AI_METADATA_UI_TIMEOUT_MS);
        Promise.resolve()
          .then(() => services.listModels())
          .then((catalog) => {
            if (!cancelled) {
              setModels(catalog);
              setCatalogError('');
            }
          })
          .catch((reason) => {
            if (!cancelled) setCatalogError(errorMessage(reason));
          })
          .finally(() => {
            if (catalogTimeout !== undefined) {
              window.clearTimeout(catalogTimeout);
            }
            if (!cancelled) setCatalogLoading(false);
          });
      })
      .catch((reason) => {
        if (!cancelled) {
          setConfigured(false);
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
      if (catalogTimeout !== undefined) window.clearTimeout(catalogTimeout);
    };
  }, [catalogAttempt, services]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || runningRequestId) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, runningRequestId]);

  const modelOptions = useMemo(() => orderModels(models, 'custom'), [models]);
  const selectedModel =
    modelOptions.find((candidate) => candidate.id === model) ??
    modelOptions[0] ??
    null;
  const selectedModelId = selectedModel?.id ?? null;

  useEffect(() => {
    setConfirmedNonZdr(false);
    if (
      configured !== true ||
      !selectedModelId ||
      !settings.aiZdrOnly ||
      !services.modelPricing
    ) {
      setLivePricing(null);
      setPricingLoading(false);
      return;
    }

    let cancelled = false;
    setLivePricing(null);
    setPricingLoading(true);
    services
      .modelPricing(selectedModelId, true)
      .then((pricing) => {
        if (!cancelled) setLivePricing({ modelId: selectedModelId, pricing });
      })
      .catch((reason) => {
        if (!cancelled) {
          setLivePricing({
            modelId: selectedModelId,
            pricing: {
              prompt: null,
              completion: null,
              updatedAt: '',
              eligibleEndpointCount: null,
            },
          });
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configured, selectedModelId, services, settings.aiZdrOnly]);

  const pricingReady =
    !settings.aiZdrOnly ||
    !services.modelPricing ||
    livePricing?.modelId === selectedModelId;
  const noZdrEndpoint = hasNoZdrEndpoint(
    settings.aiZdrOnly,
    livePricing?.modelId === selectedModelId
      ? livePricing.pricing.eligibleEndpointCount
      : null,
  );
  const requestZdrOnly = settings.aiZdrOnly && !noZdrEndpoint;
  const instruction = resolveSelectionInstruction(actionId, prompt);
  const canRun =
    configured === true &&
    !catalogLoading &&
    !pricingLoading &&
    pricingReady &&
    settings.aiCloudDisclosureAccepted &&
    instruction !== null &&
    selectedModel?.enabled === true &&
    (!noZdrEndpoint || confirmedNonZdr) &&
    !runningRequestId;

  const handleRun = async () => {
    if (!canRun || !selectedModel) return;
    const requestId = createRequestId();
    const request: AiRunRequest = {
      requestId,
      documentId: snapshot.documentId,
      source: snapshot.source,
      selection: snapshot.byteRange,
      task: 'custom',
      model: selectedModel.id,
      targetLanguage: null,
      instruction,
      zdrOnly: requestZdrOnly,
      maxOutputTokens: outputTokenLimitForTask('custom', snapshot.source, selectedModel),
      recordHistory: settings.aiHistoryEnabled,
    };
    setRunningRequestId(requestId);
    setStatus('Sending the selected text to OpenRouter…');
    setError('');
    try {
      const result = await services.run(request, (event) => {
        if (event.requestId !== requestId) return;
        if (event.type === 'progress') {
          setStatus(
            `Receiving replacement · ${event.receivedCharacters} characters`,
          );
        } else if (event.type === 'cancelled') {
          setStatus(
            'Request cancelled. The provider may still report partial usage.',
          );
        } else if (event.type === 'failed') {
          setError(event.message);
        }
      });
      onResult(
        result.usage
          ? {
              ...result,
              usage: resolveUsageCost(result.usage, selectedModel.pricing),
            }
          : result,
        snapshot,
        request,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRunningRequestId(null);
    }
  };

  const handleCancel = async () => {
    if (!runningRequestId) return;
    setStatus('Cancelling… partial provider usage may still be charged.');
    try {
      await services.cancel(runningRequestId);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="ai-selection-heading"
      className="ai-motion-surface fixed bottom-12 left-1/2 z-[80] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
      data-testid="ai-selection-popover"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="ai-selection-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Sparkles className="size-4" />
            Prompt selected text
          </h2>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {snapshot.selectedText}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close AI prompt"
          disabled={Boolean(runningRequestId)}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      <div className="mt-3 grid gap-3">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-1.5" aria-label="Selection actions">
            {SELECTION_ACTIONS.map((action) => (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant={actionId === action.id ? 'secondary' : 'outline'}
                aria-pressed={actionId === action.id}
                disabled={Boolean(runningRequestId)}
                onClick={() => {
                  setActionId(action.id);
                  if (action.id === 'custom') promptRef.current?.focus();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
          <Label htmlFor="ai-selection-prompt">Prompt for selected text</Label>
          <textarea
            id="ai-selection-prompt"
            ref={promptRef}
            rows={3}
            value={prompt}
            disabled={Boolean(runningRequestId)}
            onChange={(event) => {
              setPrompt(event.target.value);
              setActionId('custom');
            }}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              ) {
                return;
              }
              event.preventDefault();
              void handleRun();
            }}
            placeholder="Describe how to transform only this selection…"
            className="w-full resize-y rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-selection-model">Model for this request</Label>
            {catalogLoading ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" />
                Loading models…
              </span>
            ) : null}
          </div>
          <select
            id="ai-selection-model"
            value={selectedModel?.id ?? model}
            disabled={catalogLoading || Boolean(runningRequestId)}
            onChange={(event) => {
              setModel(event.target.value);
              setConfirmedNonZdr(false);
            }}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {modelOptions.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={!option.enabled}
              >
                {option.name} · {option.id}
              </option>
            ))}
          </select>
          {catalogError && !catalogLoading ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            >
              <span>{catalogError}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={Boolean(runningRequestId)}
                onClick={() => {
                  setCatalogError('');
                  setCatalogAttempt((attempt) => attempt + 1);
                }}
              >
                Retry model catalog
              </Button>
            </div>
          ) : null}
        </div>

        {configured === false ? (
          <p className="text-xs text-destructive">
            Add and verify an OpenRouter key in Settings first.
          </p>
        ) : null}
        {!settings.aiCloudDisclosureAccepted ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Approve cloud AI processing in Settings before running.
          </p>
        ) : null}
        {noZdrEndpoint ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
            {NO_ZDR_ENDPOINT_REASON}
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmedNonZdr}
                onChange={(event) => setConfirmedNonZdr(event.target.checked)}
              />
              {NON_ZDR_CONFIRMATION_LABEL}
            </label>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {runningRequestId ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleCancel()}
            >
              <Square />
              Cancel
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={() => void handleRun()}
                disabled={!canRun}
              >
                <Sparkles />
                Run on selection
              </Button>
              {onLocalAgent ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onLocalAgent(snapshot)}
                >
                  Use local agent
                </Button>
              ) : null}
            </>
          )}
          <span className="text-[11px] text-muted-foreground">
            {requestZdrOnly
              ? 'ZDR only'
              : 'Provider retention allowed for this request'}
          </span>
        </div>

        <p
          aria-live="polite"
          className={
            error
              ? 'min-h-4 text-xs text-destructive'
              : 'min-h-4 text-xs text-muted-foreground'
          }
        >
          {error || status}
        </p>
      </div>
    </section>
  );
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ai-selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    return String(reason.message);
  }
  return reason instanceof Error ? reason.message : String(reason);
}
