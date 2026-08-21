import { useEffect, useMemo, useState } from 'react';
import { Ban, LoaderCircle, Sparkles, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  aiCancel,
  aiKeyStatus,
  aiListModels,
  aiModelPricing,
  aiRun,
  openExternalUrlInNewWindow,
  readTextFiles,
} from '@/lib/desktop';
import type { Settings } from '@/lib/settings';

import { AiScopePicker } from './AiScopePicker';
import { AiPrdInterview, type AiPrdInterviewServices } from './AiPrdInterview';
import {
  detectDocumentLanguage,
  estimateAiRun,
  NON_ZDR_CONFIRMATION_LABEL,
  outputTokenLimitForTask,
  orderModels,
  resolveUsageCost,
  resolveRunGate,
  searchLanguages,
  SUMMARY_SOURCE_LANGUAGE,
} from './model';
import type {
  AiByteRange,
  AiDocumentRef,
  AiKeyStatus,
  AiModel,
  AiModelOption,
  AiModelPricing,
  AiRunRequest,
  AiRunResult,
  AiRunScope,
  AiStreamEvent,
  AiTask,
} from './types';

export interface AiWorkbenchServices {
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
  openActivity?: () => Promise<void>;
  readDocuments?: (
    paths: readonly string[],
  ) => Promise<Array<{ path: string; contents: string }>>;
}

export interface AiWorkbenchPanelProps {
  documentId: string;
  documentPath?: string | null;
  documentLabel?: string;
  source: string;
  openDocuments?: readonly AiDocumentRef[];
  documentSources?: Readonly<Record<string, string>>;
  workspaceRoot?: string | null;
  workspaceDocumentCount?: number;
  workspaceDocumentPaths?: readonly string[];
  selection: AiByteRange | null;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onOpenSettings?: () => void;
  onStart?: (request: AiRunRequest) => void;
  onFailure?: (request: AiRunRequest, reason: unknown) => void;
  onResult: (result: AiRunResult, request: AiRunRequest) => void;
  services?: AiWorkbenchServices;
  interviewServices?: AiPrdInterviewServices;
  guidedPrd?: boolean;
  showHeader?: boolean;
  resumeInterviewRequest?: { requestId: string; documentId: string } | null;
}

const DEFAULT_SERVICES: AiWorkbenchServices = {
  keyStatus: aiKeyStatus,
  listModels: aiListModels,
  modelPricing: aiModelPricing,
  run: aiRun,
  cancel: aiCancel,
  openActivity: () =>
    openExternalUrlInNewWindow('https://openrouter.ai/activity'),
  readDocuments: readTextFiles,
};

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
const EMPTY_DOCUMENTS: readonly AiDocumentRef[] = [];
const EMPTY_DOCUMENT_SOURCES: Readonly<Record<string, string>> = {};
const EMPTY_DOCUMENT_PATHS: readonly string[] = [];

export function AiWorkbenchPanel({
  documentId,
  documentPath = null,
  documentLabel = 'Current document',
  source,
  openDocuments = EMPTY_DOCUMENTS,
  documentSources = EMPTY_DOCUMENT_SOURCES,
  workspaceRoot = null,
  workspaceDocumentCount = 0,
  workspaceDocumentPaths = EMPTY_DOCUMENT_PATHS,
  selection,
  settings,
  onSettingsChange,
  onOpenSettings,
  onStart,
  onFailure,
  onResult,
  services = DEFAULT_SERVICES,
  interviewServices,
  guidedPrd = false,
  showHeader = true,
  resumeInterviewRequest = null,
}: AiWorkbenchPanelProps) {
  const [task, setTask] = useState<AiTask>('prd');
  const currentDocument = useMemo<AiDocumentRef>(
    () => ({ documentId, path: documentPath, label: documentLabel }),
    [documentId, documentLabel, documentPath],
  );
  const [runScope, setRunScope] = useState<AiRunScope>(() =>
    settings.aiDefaultScope === 'workspace' && workspaceRoot
      ? {
          kind: 'workspace',
          rootPath: workspaceRoot,
          target: currentDocument,
          documentCount: workspaceDocumentCount,
        }
      : { kind: 'document', target: currentDocument },
  );
  const [models, setModels] = useState<AiModel[]>([]);
  const [model, setModel] = useState(settings.aiPrdModel);
  const [modelQuery, setModelQuery] = useState('');
  const [livePricing, setLivePricing] = useState<{
    modelId: string;
    pricing: AiModelPricing;
  } | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(
    settings.aiTranslationTargetLanguage,
  );
  const [summaryLanguage, setSummaryLanguage] = useState(
    settings.aiSummaryTargetLanguage,
  );
  const [languageQuery, setLanguageQuery] = useState('');
  const [instruction, setInstruction] = useState('');
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showActivityLink, setShowActivityLink] = useState(false);
  const [translationResume, setTranslationResume] =
    useState<TranslationResumeRecord | null>(() => loadTranslationResume());

  useEffect(() => {
    if (!resumeInterviewRequest) return;
    const target = [currentDocument, ...openDocuments].find(
      (document) => document.documentId === resumeInterviewRequest.documentId,
    );
    if (!target) return;
    setTask('prd');
    setRunScope({ kind: 'document', target });
  }, [currentDocument, openDocuments, resumeInterviewRequest]);

  const persistTranslationResume = (record: TranslationResumeRecord | null) => {
    setTranslationResume(record);
    saveTranslationResume(record);
  };

  useEffect(() => {
    let cancelled = false;
    services
      .keyStatus()
      .then((nextStatus) => {
        if (cancelled) return;
        setKeyStatus(nextStatus);
        if (!nextStatus.configured) return;
        setCatalogLoading(true);
        services
          .listModels()
          .then((nextModels) => {
            if (!cancelled) setModels(nextModels);
          })
          .catch((reason) => {
            if (!cancelled) setError(errorMessage(reason));
          })
          .finally(() => {
            if (!cancelled) setCatalogLoading(false);
          });
      })
      .catch((reason) => {
        if (!cancelled) {
          setKeyStatus({ configured: false, maskedLabel: null });
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => {
    const defaultModel = defaultModelForTask(settings, task);
    setModel(defaultModel);
    setLanguageQuery('');
    setConfirmed(false);
  }, [
    settings.aiCustomPromptModel,
    settings.aiPrdModel,
    settings.aiSummaryModel,
    settings.aiTranslationModel,
    task,
  ]);

  useEffect(() => {
    setRunScope((current) => {
      if (task === 'summary') {
        return { kind: 'document', target: currentDocument };
      }
      if (current.kind === 'workspace') {
        if (!workspaceRoot) return { kind: 'document', target: currentDocument };
        return {
          kind: 'workspace',
          rootPath: workspaceRoot,
          target: task === 'translation' ? null : current.target ?? currentDocument,
          documentCount: workspaceDocumentCount,
        };
      }
      const targetAvailable = [currentDocument, ...openDocuments].some(
        (document) => document.documentId === current.target.documentId,
      );
      return targetAvailable ? current : { kind: 'document', target: currentDocument };
    });
  }, [currentDocument, openDocuments, task, workspaceDocumentCount, workspaceRoot]);

  const modelOptions = useMemo(() => orderModels(models, task), [models, task]);
  const visibleModelOptions = useMemo(
    () => searchModels(modelOptions, modelQuery),
    [modelOptions, modelQuery],
  );
  const selectedModel =
    modelOptions.find((candidate) => candidate.id === model) ?? null;
  const selectedModelId = selectedModel?.id ?? null;
  const configured = keyStatus?.configured === true;
  const selectedModelUnavailable =
    configured && !catalogLoading && selectedModel === null;
  const selectedPricing =
    selectedModel && services.modelPricing
      ? livePricing?.modelId === selectedModel.id
        ? livePricing.pricing
        : {
            prompt: null,
            completion: null,
            updatedAt: '',
            eligibleEndpointCount: null,
          }
      : selectedModel?.pricing ?? null;
  const pricedSelectedModel =
    selectedModel && selectedPricing
      ? { ...selectedModel, pricing: selectedPricing }
      : selectedModel;
  const pricingReady =
    !services.modelPricing || livePricing?.modelId === selectedModelId;

  useEffect(() => {
    if (!configured || !selectedModelId || !services.modelPricing) {
      setLivePricing(null);
      setPricingLoading(false);
      return;
    }

    let cancelled = false;
    setLivePricing(null);
    setPricingLoading(true);
    services
      .modelPricing(selectedModelId, settings.aiZdrOnly)
      .then((pricing) => {
        if (!cancelled) {
          setLivePricing({ modelId: selectedModelId, pricing });
        }
      })
      .catch((reason) => {
        if (cancelled) return;
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
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configured, selectedModelId, services, settings.aiZdrOnly]);

  const effectiveRunScope: AiRunScope =
    task === 'summary' ? { kind: 'document', target: currentDocument } : runScope;
  const targetDocument =
    effectiveRunScope.kind === 'document'
      ? effectiveRunScope.target
      : effectiveRunScope.target ?? currentDocument;
  const scopedSource =
    targetDocument.documentId === documentId
      ? source
      : documentSources[targetDocument.documentId] ?? '';
  const maxOutputTokens = outputTokenLimitForTask(task);
  const estimate = pricedSelectedModel
    ? estimateAiRun({
        source: scopedSource,
        scope: 'document',
        model: pricedSelectedModel,
        maxOutputTokens,
      })
    : null;
  const gate =
    estimate && selectedModel
      ? resolveRunGate({
          scope: 'document',
          inputTokens: estimate.inputTokens,
          contextLength: selectedModel.contextLength,
          maxCostUsd: estimate.maxCostUsd,
          zdrOnly: settings.aiZdrOnly,
          eligibleEndpointCount:
            selectedPricing?.eligibleEndpointCount ?? null,
        })
      : null;
  const requestZdrOnly =
    settings.aiZdrOnly && gate?.code !== 'no_zdr_endpoint';
  const languages = searchLanguages(languageQuery).slice(0, 12);
  const requiresInstruction = task === 'custom';
  const targetRequired = task === 'translation';
  const taskDefaultModel = defaultModelForTask(settings, task);
  const detectedSourceLanguage = useMemo(
    () => (targetRequired ? detectDocumentLanguage(source) : null),
    [source, targetRequired],
  );
  const normalizedTargetLanguage = targetLanguage
    .trim()
    .toLocaleLowerCase()
    .split('-')[0];
  const sameLanguage =
    targetRequired &&
    detectedSourceLanguage !== null &&
    detectedSourceLanguage === normalizedTargetLanguage;
  const disclosureAccepted = settings.aiCloudDisclosureAccepted;
  const canRun =
    !runningRequestId &&
    !pricingLoading &&
    pricingReady &&
    configured &&
    disclosureAccepted &&
    (effectiveRunScope.kind === 'document' ||
      (task === 'translation' && workspaceDocumentPaths.length > 0)) &&
    scopedSource.length > 0 &&
    selectedModel?.enabled === true &&
    gate?.kind !== 'blocked' &&
    (gate?.kind !== 'confirm' || confirmed) &&
    (!requiresInstruction || instruction.trim().length > 0) &&
    (!targetRequired || targetLanguage.trim().length > 0) &&
    !(effectiveRunScope.kind === 'document' && sameLanguage);

  const chooseTargetLanguage = (language: string) => {
    setTargetLanguage(language);
    setLanguageQuery('');
    if (language !== settings.aiTranslationTargetLanguage) {
      onSettingsChange({
        ...settings,
        aiTranslationTargetLanguage: language,
      });
    }
  };

  const chooseSummaryLanguage = (language: string) => {
    setSummaryLanguage(language);
    setLanguageQuery('');
    if (language !== settings.aiSummaryTargetLanguage) {
      onSettingsChange({
        ...settings,
        aiSummaryTargetLanguage: language,
      });
    }
  };

  const chooseModel = (modelId: string) => {
    setModel(modelId);
    setModelQuery('');
    setConfirmed(false);
  };

  const saveModelAsDefault = () => {
    if (!selectedModel || selectedModel.id === taskDefaultModel) return;
    onSettingsChange(settingsWithDefaultModel(settings, task, selectedModel.id));
  };

  const handleRun = async () => {
    if (!canRun || !selectedModel) return;
    if (task === 'translation' && runScope.kind === 'workspace') {
      await handleWorkspaceTranslation(selectedModel.id);
      return;
    }
    const requestId = createRequestId();
    const request: AiRunRequest = {
      requestId,
      documentId: targetDocument.documentId,
      source: scopedSource,
      selection:
        task !== 'summary' && targetDocument.documentId === documentId
          ? selection
          : null,
      task,
      model: selectedModel.id,
      targetLanguage:
        task === 'translation'
          ? targetLanguage
          : task === 'summary' && summaryLanguage !== SUMMARY_SOURCE_LANGUAGE
            ? summaryLanguage
            : null,
      instruction: instruction.trim() || null,
      zdrOnly: requestZdrOnly,
      maxOutputTokens,
      recordHistory: settings.aiHistoryEnabled,
      scope: effectiveRunScope,
    };
    const resumable =
      task === 'translation' && settings.aiHistoryEnabled
        ? translationResumeRecord({
            batchId: requestId,
            documents: [targetDocument],
            scope: runScope,
            model: selectedModel.id,
            targetLanguage,
            instruction: instruction.trim() || null,
            zdrOnly: requestZdrOnly,
          })
        : null;
    if (resumable) {
      persistTranslationResume({ ...resumable, currentStarted: true });
    }
    setRunningRequestId(requestId);
    setShowActivityLink(false);
    setError('');
    setStatus('Starting OpenRouter request…');
    onStart?.(request);
    try {
      const result = await services.run(request, (event) => {
        if (event.requestId !== requestId) return;
        if (event.type === 'progress') {
          setStatus(`Receiving structured result · ${event.receivedCharacters} characters`);
        } else if (event.type === 'cancelled') {
          setStatus('Request cancelled. The provider may still report partial usage.');
          setShowActivityLink(true);
        } else if (event.type === 'failed') {
          setError(event.message);
        }
      });
      setStatus(
        result.result
          ? 'AI result is ready for review.'
          : 'The response failed local validation and is available for inspection.',
      );
      if (result.usage) setShowActivityLink(false);
      onResult(
        result.usage
          ? {
              ...result,
              usage: resolveUsageCost(
                result.usage,
                selectedPricing ?? selectedModel.pricing,
              ),
            }
          : result,
        request,
      );
      if (resumable) persistTranslationResume(null);
    } catch (reason) {
      onFailure?.(request, reason);
      if (errorCode(reason) === 'cancelled') {
        setError('');
        setStatus('Request cancelled. Final usage is unavailable.');
        setShowActivityLink(true);
      } else {
        setError(errorMessage(reason));
        setStatus('');
      }
    } finally {
      setRunningRequestId(null);
    }
  };

  const handleWorkspaceTranslation = async (selectedModelId: string) => {
    const readDocuments = services.readDocuments ?? DEFAULT_SERVICES.readDocuments;
    if (!readDocuments) return;
    const batchId = createRequestId();
    setRunningRequestId(batchId);
    setShowActivityLink(false);
    setError('');
    setStatus(`Loading ${workspaceDocumentPaths.length} Markdown files…`);
    try {
      const loaded = await readDocuments(workspaceDocumentPaths);
      if (loaded.length === 0) {
        throw new Error('No readable Markdown files were found in this workspace.');
      }
      const resumable = settings.aiHistoryEnabled
        ? translationResumeRecord({
            batchId,
            documents: loaded.map((document) => {
              const openDocument = document.path === documentPath
                ? currentDocument
                : openDocuments.find((candidate) => candidate.path === document.path);
              return {
                documentId: openDocument?.documentId ?? document.path,
                path: document.path,
                label: fileLabel(document.path),
              };
            }),
            scope: runScope,
            model: selectedModelId,
            targetLanguage,
            instruction: instruction.trim() || null,
            zdrOnly: requestZdrOnly,
          })
        : null;
      if (resumable) persistTranslationResume(resumable);
      for (let index = 0; index < loaded.length; index += 1) {
        const document = loaded[index];
        const openDocument = openDocuments.find(
          (candidate) => candidate.path === document.path,
        );
        const latestSource = openDocument
          ? documentSources[openDocument.documentId] ?? document.contents
          : document.path === documentPath
            ? source
            : document.contents;
        const requestId = `${batchId}:${index + 1}`;
        const request: AiRunRequest = {
          requestId,
          documentId: openDocument?.documentId ?? document.path,
          source: latestSource,
          selection: null,
          task: 'translation',
          model: selectedModelId,
          targetLanguage,
          instruction: instruction.trim() || null,
          zdrOnly: requestZdrOnly,
          maxOutputTokens: 4_096,
          recordHistory: settings.aiHistoryEnabled,
          scope: {
            ...runScope,
            target: {
              documentId: openDocument?.documentId ?? document.path,
              path: document.path,
              label: fileLabel(document.path),
            },
          },
        };
        if (resumable) {
          persistTranslationResume({
            ...resumable,
            nextIndex: index,
            currentStarted: true,
          });
        }
        setRunningRequestId(requestId);
        setStatus(
          `Translating ${index + 1} of ${loaded.length} · ${fileLabel(document.path)}`,
        );
        onStart?.(request);
        try {
          const result = await services.run(request, (event) => {
            if (event.type === 'progress') {
              setStatus(
                `Translating ${index + 1} of ${loaded.length} · ${event.receivedCharacters} characters`,
              );
            }
          });
          onResult(result, request);
          if (resumable) {
            persistTranslationResume({
              ...resumable,
              nextIndex: index + 1,
              currentStarted: false,
            });
          }
        } catch (reason) {
          onFailure?.(request, reason);
          throw reason;
        }
      }
      if (resumable) persistTranslationResume(null);
      setStatus(`${loaded.length} translation proposals are ready for review.`);
    } catch (reason) {
      setError(errorMessage(reason));
      setStatus('');
    } finally {
      setRunningRequestId(null);
    }
  };

  const handleResumeTranslation = async () => {
    if (!translationResume || runningRequestId || !settings.aiHistoryEnabled) return;
    const readDocuments = services.readDocuments ?? DEFAULT_SERVICES.readDocuments;
    if (!readDocuments) return;
    setError('');
    setShowActivityLink(false);
    setRunningRequestId(translationResume.batchId);
    try {
      const paths = translationResume.documents.flatMap((document) =>
        document.path ? [document.path] : [],
      );
      const loaded = paths.length > 0 ? await readDocuments(paths) : [];
      const diskSources = new Map(loaded.map((document) => [document.path, document.contents]));
      for (
        let index = translationResume.nextIndex;
        index < translationResume.documents.length;
        index += 1
      ) {
        const document = translationResume.documents[index];
        const latestSource =
          document.documentId === documentId || document.path === documentPath
            ? source
            : documentSources[document.documentId] ??
              (document.path ? diskSources.get(document.path) : undefined);
        if (latestSource === undefined) {
          throw new Error(`Could not reload ${document.label} for translation resume.`);
        }
        const requestId = translationResume.documents.length === 1
          ? translationResume.batchId
          : `${translationResume.batchId}:${index + 1}`;
        const resumeCurrent =
          index === translationResume.nextIndex && translationResume.currentStarted;
        const request: AiRunRequest = {
          requestId,
          documentId: document.documentId,
          source: latestSource,
          selection: null,
          task: 'translation',
          model: translationResume.model,
          targetLanguage: translationResume.targetLanguage,
          instruction: translationResume.instruction,
          zdrOnly: translationResume.zdrOnly,
          maxOutputTokens: translationResume.maxOutputTokens,
          recordHistory: true,
          scope:
            translationResume.scope.kind === 'workspace'
              ? { ...translationResume.scope, target: document }
              : { kind: 'document', target: document },
          resume: resumeCurrent,
        };
        persistTranslationResume({
          ...translationResume,
          nextIndex: index,
          currentStarted: true,
        });
        setRunningRequestId(requestId);
        setStatus(
          translationResume.documents.length === 1
            ? `Resuming ${document.label}…`
            : `Resuming ${index + 1} of ${translationResume.documents.length} · ${document.label}`,
        );
        onStart?.(request);
        try {
          const result = await services.run(request, (event) => {
            if (event.type === 'progress') {
              setStatus(`Resuming ${document.label} · ${event.receivedCharacters} characters`);
            }
          });
          onResult(result, request);
        } catch (reason) {
          onFailure?.(request, reason);
          throw reason;
        }
        persistTranslationResume({
          ...translationResume,
          nextIndex: index + 1,
          currentStarted: false,
        });
      }
      persistTranslationResume(null);
      setStatus('Translation resume completed. Proposals are ready for review.');
    } catch (reason) {
      setError(errorMessage(reason));
      setStatus('');
    } finally {
      setRunningRequestId(null);
    }
  };

  const handleCancel = async () => {
    if (!runningRequestId) return;
    setStatus('Cancelling… partial provider usage may still be charged.');
    try {
      await services.cancel(runningRequestId);
      setShowActivityLink(true);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const handleOpenActivity = async () => {
    try {
      await (services.openActivity ?? DEFAULT_SERVICES.openActivity)?.();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <section
      aria-labelledby={showHeader ? 'ai-workbench-heading' : undefined}
      aria-label={showHeader ? undefined : 'New AI request'}
      className="ai-motion-surface flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="ai-workbench-panel"
    >
      {showHeader ? <header className="border-b border-border px-3 py-3">
        <h2
          id="ai-workbench-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Sparkles className="size-4" />
          AI Feature
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Improve, summarize, translate, or transform the active Markdown document.
        </p>
      </header> : null}

      <div className="flex flex-col gap-4 p-3">
        {!configured && keyStatus !== null ? (
          <div className="rounded-md border border-dashed border-border px-3 py-3">
            <p className="text-sm font-medium">Connect OpenRouter to use AI tools.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Add a key in Settings → AI Feature Settings. Markdowner never sends a
              document automatically.
            </p>
            {onOpenSettings ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={onOpenSettings}
              >
                Open AI settings
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="ai-task">AI task</Label>
          <select
            id="ai-task"
            aria-label="AI task"
            className={selectClass}
            value={task}
            disabled={Boolean(runningRequestId)}
            onChange={(event) => setTask(event.target.value as AiTask)}
          >
            <option value="prd">Improve PRD</option>
            <option value="summary">Summarize document</option>
            <option value="translation">Translate document</option>
            <option value="custom">Custom prompt</option>
          </select>
        </div>

        {task === 'summary' ? (
          <div className="grid gap-1.5">
            <Label>Scope</Label>
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              Current document · {currentDocument.label}
            </p>
          </div>
        ) : (
          <AiScopePicker
            value={runScope}
            task={task}
            currentDocument={currentDocument}
            openDocuments={openDocuments}
            workspaceRoot={workspaceRoot}
            workspaceFileCount={workspaceDocumentCount}
            disabled={Boolean(runningRequestId)}
            onChange={setRunScope}
          />
        )}

        {task !== 'summary' && runScope.kind === 'workspace' ? (
          <p className="text-xs text-muted-foreground">
            Workspace execution will read only the selected Markdown scope and will
            never modify files without review.
          </p>
        ) : null}

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-model">Model</Label>
            {catalogLoading ? (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" />
                Refreshing
              </span>
            ) : null}
          </div>
          <Input
            type="search"
            aria-label="Search models"
            value={modelQuery}
            onChange={(event) => setModelQuery(event.target.value)}
            placeholder="Search models by name or slug"
            disabled={Boolean(runningRequestId)}
          />
          <select
            id="ai-model"
            aria-label="AI model"
            className={selectClass}
            value={
              selectedModelUnavailable
                ? model
                : visibleModelOptions.some(
                      (candidate) => candidate.id === selectedModel?.id,
                    )
                ? selectedModel?.id
                : ''
            }
            disabled={Boolean(runningRequestId)}
            onChange={(event) => chooseModel(event.target.value)}
          >
            {selectedModelUnavailable ? (
              <option value={model} disabled>
                {model} · unavailable
              </option>
            ) : null}
            {selectedModel &&
            !visibleModelOptions.some(
              (candidate) => candidate.id === selectedModel.id,
            ) ? (
              <option value="" disabled>
                Choose a matching model
              </option>
            ) : null}
            {visibleModelOptions.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={!option.enabled}
              >
                {option.name} · {option.id}
              </option>
            ))}
          </select>
          {modelQuery && visibleModelOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No text-output models match this search.
            </p>
          ) : null}
          {pricingLoading ? (
            <p className="text-[11px] text-muted-foreground">
              Checking eligible endpoint pricing…
            </p>
          ) : null}
          {selectedModel?.disabledReason ? (
            <p className="text-xs text-destructive">{selectedModel.disabledReason}</p>
          ) : null}
          {selectedModelUnavailable ? (
            <p role="alert" className="text-xs text-destructive">
              The saved model is unavailable or blocked. Choose another model
              explicitly.
            </p>
          ) : null}
          {selectedModel && selectedModel.id !== taskDefaultModel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-fit"
              disabled={Boolean(runningRequestId)}
              onClick={saveModelAsDefault}
            >
              Save as {taskLabel(task)} default
            </Button>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Task default · change the selector for this request only.
            </p>
          )}
        </div>

        {targetRequired ? (
          <div className="grid gap-2">
            <Label htmlFor="ai-target-language">Target language</Label>
            <Input
              id="ai-target-language"
              value={languageQuery || targetLanguage}
              onFocus={() => setLanguageQuery('')}
              onChange={(event) => {
                setLanguageQuery(event.target.value);
                if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(event.target.value)) {
                  chooseTargetLanguage(event.target.value);
                }
              }}
              placeholder="Search by language or BCP 47 code"
              disabled={Boolean(runningRequestId)}
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Language choices">
              {languages.map((language) => (
                <button
                  type="button"
                  key={language.code}
                  className={
                    language.code === targetLanguage
                      ? 'rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground'
                      : 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => chooseTargetLanguage(language.code)}
                  disabled={Boolean(runningRequestId)}
                >
                  {language.name} · {language.code}
                </button>
              ))}
            </div>
            {sameLanguage ? (
              <p
                role="alert"
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200"
              >
                This document already appears to be{' '}
                {languageName(detectedSourceLanguage)}. Choose a different target
                language before running.
              </p>
            ) : null}
          </div>
        ) : null}

        {task === 'summary' ? (
          <div className="grid gap-2">
            <Label htmlFor="ai-summary-language">Summary language</Label>
            <Input
              id="ai-summary-language"
              value={languageQuery || summaryLanguage}
              onFocus={() => setLanguageQuery('')}
              onChange={(event) => {
                setLanguageQuery(event.target.value);
                if (/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(event.target.value)) {
                  chooseSummaryLanguage(event.target.value);
                }
              }}
              placeholder="Search by language or BCP 47 code"
              disabled={Boolean(runningRequestId)}
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Summary language choices">
              <button
                type="button"
                className={
                  summaryLanguage === SUMMARY_SOURCE_LANGUAGE
                    ? 'rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground'
                    : 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                }
                onClick={() => chooseSummaryLanguage(SUMMARY_SOURCE_LANGUAGE)}
                disabled={Boolean(runningRequestId)}
              >
                Same as source · {SUMMARY_SOURCE_LANGUAGE}
              </button>
              {languages.map((language) => (
                <button
                  type="button"
                  key={language.code}
                  className={
                    language.code === summaryLanguage
                      ? 'rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground'
                      : 'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => chooseSummaryLanguage(language.code)}
                  disabled={Boolean(runningRequestId)}
                >
                  {language.name} · {language.code}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="ai-instruction">
            {requiresInstruction ? 'Prompt' : 'Additional instruction'}
          </Label>
          <textarea
            id="ai-instruction"
            aria-label={requiresInstruction ? 'Custom prompt' : 'Additional instruction'}
            rows={requiresInstruction ? 5 : 3}
            className="w-full resize-y rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              requiresInstruction
                ? 'Describe the exact transformation…'
                : 'Optional constraints for this run…'
            }
            disabled={Boolean(runningRequestId)}
          />
        </div>

        {estimate ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">
              Estimated input · {estimate.inputTokens.toLocaleString()} tokens
            </p>
            <p className="mt-1 text-muted-foreground">
              Output cap · {estimate.maxOutputTokens.toLocaleString()} tokens
            </p>
            <p className="mt-1 text-muted-foreground">
              Estimated maximum cost ·{' '}
              {estimate.maxCostUsd === null
                ? 'unknown'
                : `USD ${estimate.maxCostUsd.toFixed(4)}`}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Estimate only. Actual provider usage can differ.
            </p>
            {estimate.pricingUpdatedAt ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pricing checked · {estimate.pricingUpdatedAt}
              </p>
            ) : null}
          </div>
        ) : null}

        {task === 'translation' && runScope.kind === 'workspace' ? (
          <p className="text-xs text-muted-foreground">
            {workspaceDocumentPaths.length.toLocaleString()} Markdown files will run sequentially. Each file opens its own Review result.
          </p>
        ) : null}

        {translationResume && settings.aiHistoryEnabled ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">Interrupted translation available</p>
            <p className="mt-1 text-muted-foreground">
              Resume at file {Math.min(
                translationResume.nextIndex + 1,
                translationResume.documents.length,
              )}{' '}
              of {translationResume.documents.length} with {translationResume.model}.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(runningRequestId)}
                onClick={() => void handleResumeTranslation()}
              >
                Resume translation
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={Boolean(runningRequestId)}
                onClick={() => persistTranslationResume(null)}
              >
                Discard
              </Button>
            </div>
          </div>
        ) : null}

        {gate?.reason ? (
          <div
            role={gate.kind === 'blocked' ? 'alert' : undefined}
            className={
              gate.kind === 'blocked'
                ? 'rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive'
                : 'rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200'
            }
          >
            {gate.reason}
            {gate.kind === 'confirm' ? (
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {gate.code === 'no_zdr_endpoint'
                  ? NON_ZDR_CONFIRMATION_LABEL
                  : 'I understand and want to run this request.'}
              </label>
            ) : null}
          </div>
        ) : null}

        {!disclosureAccepted ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              You must approve cloud processing before Run is enabled.
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Label htmlFor="ai-panel-disclosure" className="text-xs">
                Approve cloud processing
              </Label>
              <Switch
                id="ai-panel-disclosure"
                checked={disclosureAccepted}
                onCheckedChange={(accepted) =>
                  onSettingsChange({
                    ...settings,
                    aiCloudDisclosureAccepted: accepted,
                  })
                }
              />
            </div>
          </div>
        ) : null}

        {guidedPrd && task === 'prd' && selectedModel ? (
          <AiPrdInterview
            documentId={targetDocument.documentId}
            source={scopedSource}
            model={selectedModel.id}
            instruction={instruction.trim() || null}
            scope={runScope}
            zdrOnly={requestZdrOnly}
            recordHistory={settings.aiHistoryEnabled}
            disabled={!canRun}
            resumeRequestId={
              resumeInterviewRequest?.documentId === targetDocument.documentId
                ? resumeInterviewRequest.requestId
                : null
            }
            services={interviewServices}
            onStart={onStart}
            onFailure={onFailure}
            onResult={onResult}
          />
        ) : null}

        {!guidedPrd || task !== 'prd' ? <div className="flex items-center gap-2">
          {runningRequestId ? (
            <Button type="button" variant="destructive" onClick={() => void handleCancel()}>
              <Square />
              Cancel
            </Button>
          ) : (
            <Button type="button" onClick={() => void handleRun()} disabled={!canRun}>
              <Sparkles />
              Run
            </Button>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {requestZdrOnly ? (
              'ZDR only'
            ) : (
              <>
                <Ban className="size-3" />
                Retention allowed for this request
              </>
            )}
          </span>
        </div> : null}

        {!guidedPrd || task !== 'prd' ? <p
          aria-live="polite"
          className={error ? 'min-h-5 text-xs text-destructive' : 'min-h-5 text-xs text-muted-foreground'}
        >
          {error || status}
        </p> : null}
        {(!guidedPrd || task !== 'prd') && showActivityLink ? (
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto w-fit px-0 text-xs"
            onClick={() => void handleOpenActivity()}
          >
            OpenRouter Activity
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const TRANSLATION_RESUME_STORAGE_KEY = 'markdowner.ai.translation-resume.v1';

interface TranslationResumeRecord {
  version: 1;
  batchId: string;
  documents: AiDocumentRef[];
  nextIndex: number;
  currentStarted: boolean;
  scope: AiRunScope;
  model: string;
  targetLanguage: string;
  instruction: string | null;
  zdrOnly: boolean;
  maxOutputTokens: number;
}

function translationResumeRecord({
  batchId,
  documents,
  scope,
  model,
  targetLanguage,
  instruction,
  zdrOnly,
}: Omit<TranslationResumeRecord, 'version' | 'nextIndex' | 'currentStarted' | 'maxOutputTokens'>): TranslationResumeRecord {
  return {
    version: 1,
    batchId,
    documents,
    nextIndex: 0,
    currentStarted: false,
    scope,
    model,
    targetLanguage,
    instruction,
    zdrOnly,
    maxOutputTokens: 4_096,
  };
}

function loadTranslationResume(): TranslationResumeRecord | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(TRANSLATION_RESUME_STORAGE_KEY) ?? 'null');
    if (
      !value ||
      value.version !== 1 ||
      typeof value.batchId !== 'string' ||
      !Array.isArray(value.documents) ||
      value.documents.length === 0 ||
      value.documents.length > 10_000 ||
      !value.documents.every(isDocumentRef) ||
      !Number.isInteger(value.nextIndex) ||
      value.nextIndex < 0 ||
      value.nextIndex >= value.documents.length ||
      typeof value.currentStarted !== 'boolean' ||
      !isRunScope(value.scope) ||
      typeof value.model !== 'string' ||
      typeof value.targetLanguage !== 'string' ||
      !(value.instruction === null || typeof value.instruction === 'string') ||
      typeof value.zdrOnly !== 'boolean' ||
      value.maxOutputTokens !== 4_096
    ) {
      return null;
    }
    return value as TranslationResumeRecord;
  } catch {
    return null;
  }
}

function saveTranslationResume(record: TranslationResumeRecord | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (record) {
      localStorage.setItem(TRANSLATION_RESUME_STORAGE_KEY, JSON.stringify(record));
    } else {
      localStorage.removeItem(TRANSLATION_RESUME_STORAGE_KEY);
    }
  } catch {
    // Resume metadata is best-effort; the request itself remains usable.
  }
}

function isDocumentRef(value: unknown): value is AiDocumentRef {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiDocumentRef>;
  return (
    typeof candidate.documentId === 'string' &&
    typeof candidate.label === 'string' &&
    (candidate.path === null || typeof candidate.path === 'string')
  );
}

function isRunScope(value: unknown): value is AiRunScope {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  const candidate = value as Partial<AiRunScope>;
  if (candidate.kind === 'document') {
    return 'target' in candidate && isDocumentRef(candidate.target);
  }
  return (
    candidate.kind === 'workspace' &&
    'rootPath' in candidate &&
    typeof candidate.rootPath === 'string' &&
    'documentCount' in candidate &&
    typeof candidate.documentCount === 'number'
  );
}

function errorMessage(reason: unknown): string {
  const retryAfterSeconds =
    reason &&
    typeof reason === 'object' &&
    'retryAfterSeconds' in reason &&
    typeof reason.retryAfterSeconds === 'number'
      ? reason.retryAfterSeconds
      : null;
  let message: string;
  if (reason && typeof reason === 'object' && 'message' in reason) {
    message = String(reason.message);
  } else {
    message = reason instanceof Error ? reason.message : String(reason);
  }
  return retryAfterSeconds === null
    ? message
    : `${message} Retry after ${retryAfterSeconds} seconds.`;
}

function errorCode(reason: unknown): string | null {
  return reason &&
    typeof reason === 'object' &&
    'code' in reason &&
    typeof reason.code === 'string'
    ? reason.code
    : null;
}

function languageName(code: string): string {
  if (typeof Intl.DisplayNames !== 'function') return code.toLocaleUpperCase();
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
}

function taskLabel(task: AiTask): string {
  return task === 'prd'
    ? 'PRD'
    : task === 'summary'
      ? 'Summary'
      : task === 'translation'
        ? 'translation'
        : 'custom';
}

function defaultModelForTask(settings: Settings, task: AiTask): string {
  if (task === 'prd') return settings.aiPrdModel;
  if (task === 'summary') return settings.aiSummaryModel;
  if (task === 'translation') return settings.aiTranslationModel;
  return settings.aiCustomPromptModel;
}

function settingsWithDefaultModel(
  settings: Settings,
  task: AiTask,
  model: string,
): Settings {
  if (task === 'prd') return { ...settings, aiPrdModel: model };
  if (task === 'summary') return { ...settings, aiSummaryModel: model };
  if (task === 'translation') return { ...settings, aiTranslationModel: model };
  return { ...settings, aiCustomPromptModel: model };
}

function searchModels(
  models: readonly AiModelOption[],
  query: string,
): AiModelOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...models];
  return models.filter((model) =>
    [model.name, model.id, model.description ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}
