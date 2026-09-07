import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  aiDeleteKey,
  aiKeyStatus,
  aiListModels,
  aiSaveKey,
  aiVerifyKey,
} from '@/lib/desktop';

import { orderModels } from './model';
import type { AiKeyMetadata, AiKeyStatus, AiModel, AiModelOption } from './types';
import { AiSystemPromptSettings } from './AiSystemPromptSettings';
import type { AiSystemPrompts } from './systemPrompts';
import { AI_METADATA_UI_TIMEOUT_MS } from './requestTimeout';

export interface OpenRouterSettingsServices {
  keyStatus: () => Promise<AiKeyStatus>;
  saveKey: (apiKey: string) => Promise<AiKeyStatus>;
  verifyKey: () => Promise<AiKeyMetadata>;
  deleteKey: () => Promise<AiKeyStatus>;
  listModels?: () => Promise<AiModel[]>;
}

export interface OpenRouterSettingsProps {
  primaryModel: string;
  onPrimaryModelChange: (model: string) => void;
  zdrOnly: boolean;
  disclosureAccepted: boolean;
  prdModel: string;
  summaryModel: string;
  translationModel: string;
  customPromptModel: string;
  summaryTargetLanguage: string;
  translationTargetLanguage: string;
  defaultScope: 'document' | 'workspace';
  historyEnabled: boolean;
  systemPrompts?: AiSystemPrompts;
  onSystemPromptsChange?: (prompts: AiSystemPrompts) => void;
  onZdrOnlyChange: (enabled: boolean) => void;
  onDisclosureAcceptedChange: (accepted: boolean) => void;
  onPrdModelChange: (model: string) => void;
  onSummaryModelChange: (model: string) => void;
  onTranslationModelChange: (model: string) => void;
  onCustomPromptModelChange: (model: string) => void;
  onSummaryTargetLanguageChange: (language: string) => void;
  onTranslationTargetLanguageChange: (language: string) => void;
  onDefaultScopeChange: (scope: 'document' | 'workspace') => void;
  onHistoryEnabledChange: (enabled: boolean) => void;
  services?: OpenRouterSettingsServices;
}

const DEFAULT_SERVICES: OpenRouterSettingsServices = {
  keyStatus: aiKeyStatus,
  saveKey: aiSaveKey,
  verifyKey: aiVerifyKey,
  deleteKey: aiDeleteKey,
  listModels: aiListModels,
};

export function OpenRouterSettings({
  primaryModel,
  onPrimaryModelChange,
  zdrOnly,
  disclosureAccepted,
  prdModel,
  summaryModel,
  translationModel,
  customPromptModel,
  summaryTargetLanguage,
  translationTargetLanguage,
  defaultScope,
  historyEnabled,
  systemPrompts = {},
  onSystemPromptsChange,
  onZdrOnlyChange,
  onDisclosureAcceptedChange,
  onPrdModelChange,
  onSummaryModelChange,
  onTranslationModelChange,
  onCustomPromptModelChange,
  onSummaryTargetLanguageChange,
  onTranslationTargetLanguageChange,
  onDefaultScopeChange,
  onHistoryEnabledChange,
  services = DEFAULT_SERVICES,
}: OpenRouterSettingsProps) {
  const [status, setStatus] = useState<AiKeyStatus>({
    configured: false,
    maskedLabel: null,
  });
  const [metadata, setMetadata] = useState<AiKeyMetadata | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const modelOptions = orderModels(models, 'prd');

  useEffect(() => {
    if (!status.configured || !services.listModels) {
      setCatalogLoading(false);
      setCatalogError('');
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError('');
    const timeout = window.setTimeout(() => {
      cancelled = true;
      setCatalogLoading(false);
      setCatalogError('The model catalog did not respond. Try refreshing the models.');
    }, AI_METADATA_UI_TIMEOUT_MS);
    Promise.resolve().then(() => services.listModels!())
      .then((catalog) => { if (!cancelled) setModels(catalog); })
      .catch((reason) => { if (!cancelled) setCatalogError(errorMessage(reason)); })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setCatalogLoading(false);
      });
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [status.configured, services, catalogAttempt]);

  useEffect(() => {
    let cancelled = false;
    services
      .keyStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  const handleSaveAndVerify = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await services.saveKey(draft);
      setStatus(saved);
      setDraft('');
      const verified = await services.verifyKey();
      setMetadata(verified);
      setStatus({
        configured: verified.configured,
        maskedLabel: verified.maskedLabel,
      });
      setMessage('OpenRouter connection verified.');
    } catch (reason) {
      setDraft('');
      setError(errorMessage(reason));
      try {
        setStatus(await services.keyStatus());
      } catch {
        // Keep the last known masked status. The plaintext draft is already gone.
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setStatus(await services.deleteKey());
      setMetadata(null);
      setDraft('');
      setMessage('OpenRouter key deleted from Keychain.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const connectedLabel = metadata?.label?.trim() || status.maskedLabel;

  return (
    <section
      id="settings-ai-feature"
      aria-labelledby="openrouter-settings-heading"
      data-testid="settings-openrouter"
      className="flex min-w-0 scroll-mt-4 flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3
            id="openrouter-settings-heading"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Sparkles className="size-4" />
            AI Feature Settings
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Configure OpenRouter, task defaults, local history, and cloud privacy.
          </p>
        </div>
        {status.configured ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" />
            Connected
          </span>
        ) : null}
      </div>

      <section
        aria-labelledby="openrouter-connection-heading"
        data-testid="settings-ai-connection"
        className="flex flex-col gap-3 rounded-xl border border-border bg-muted/15 p-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <h4 id="openrouter-connection-heading" className="text-sm font-medium">
            OpenRouter Connection
          </h4>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The API key is stored in macOS Keychain and is never read back into the editor.
        </p>

        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            Checking Keychain…
          </p>
        ) : status.configured ? (
          <div className="rounded-md border border-border bg-background/70 p-3">
            <p className="text-sm font-medium">
              {metadata?.label
                ? `Connected as ${metadata.label}`
                : `Connected · ${connectedLabel}`}
            </p>
            {metadata ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCreditMetadata(metadata)}
              </p>
            ) : (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {status.maskedLabel}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            Connect OpenRouter to use AI tools.
          </p>
        )}

        <div className="grid gap-2">
          <Label htmlFor="openrouter-api-key">
            {status.configured ? 'Replace OpenRouter API key' : 'OpenRouter API key'}
          </Label>
          <Input
            id="openrouter-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="sk-or-…"
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSaveAndVerify()}
              disabled={busy || !draft.trim()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
              Save and verify
            </Button>
            {status.configured ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                <Trash2 />
                Delete key
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="ai-task-defaults-heading"
        data-testid="settings-ai-defaults"
        className="flex flex-col gap-3 rounded-xl border border-border bg-muted/15 p-4"
      >
        <div>
          <h4 id="ai-task-defaults-heading" className="text-sm font-medium">
            Models & Task Defaults
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Choose your primary model, then override it for individual tasks as needed.
            New requests use these defaults, including inline editing and PRD interviews.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Label htmlFor="ai-default-model-search">Search default models</Label>
            <Input id="ai-default-model-search" type="search" value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)} placeholder="Search by model name or ID" />
          </div>
          <Button type="button" variant="outline" disabled={catalogLoading || !status.configured || !services.listModels}
            onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>
            {catalogLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {catalogLoading ? 'Refreshing models…' : 'Refresh models'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {status.configured ? 'Search the OpenRouter catalog or refresh to discover newly released models.'
            : 'Featured models are available below. Connect OpenRouter to load the full catalog.'}
          {' '}Models without structured output support cannot be used for these tasks.
        </p>
        {catalogError ? <p role="alert" className="text-xs text-destructive">{catalogError} Saved model choices are kept.</p> : null}
        {modelQuery && !modelOptions.some((model) => matchesModel(model, modelQuery)) ?
          <p role="status" className="text-xs text-muted-foreground">No matching models. Clear the search or refresh the catalog.</p> : null}
        <ModelDefaultSelect id="ai-primary-model" label="Primary model" value={primaryModel}
          onChange={onPrimaryModelChange} models={modelOptions} query={modelQuery} />
        <div className="grid gap-3 sm:grid-cols-2">
          <ModelDefaultSelect
            id="ai-prd-default-model"
            label="PRD default model"
            value={prdModel}
            onChange={onPrdModelChange}
            models={modelOptions} query={modelQuery} primaryModel={primaryModel}
          />
          <ModelDefaultSelect
            id="ai-summary-default-model"
            label="Summary default model"
            value={summaryModel}
            onChange={onSummaryModelChange}
            models={modelOptions} query={modelQuery} primaryModel={primaryModel}
          />
          <ModelDefaultSelect
            id="ai-translation-default-model"
            label="Translation default model"
            value={translationModel}
            onChange={onTranslationModelChange}
            models={modelOptions} query={modelQuery} primaryModel={primaryModel}
          />
          <ModelDefaultSelect
            id="ai-custom-default-model"
            label="Custom prompt default model"
            value={customPromptModel}
            onChange={onCustomPromptModelChange}
            models={modelOptions} query={modelQuery} primaryModel={primaryModel}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="ai-summary-language">Summary language</Label>
            <select
              id="ai-summary-language"
              aria-label="Summary language"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={summaryTargetLanguage}
              onChange={(event) => onSummaryTargetLanguageChange(event.target.value)}
            >
              <option value="source">Same as source</option>
              <option value="ko">Korean · ko</option>
              <option value="en">English · en</option>
              <option value="ja">Japanese · ja</option>
              <option value="zh">Chinese · zh</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-default-target-language">Translation target</Label>
            <Input
              id="ai-default-target-language"
              value={translationTargetLanguage}
              onChange={(event) => onTranslationTargetLanguageChange(event.target.value)}
              placeholder="BCP 47 code, e.g. ko"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ai-default-scope">Default AI scope</Label>
            <select
              id="ai-default-scope"
              aria-label="Default AI scope"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[18rem]"
              value={defaultScope}
              onChange={(event) =>
                onDefaultScopeChange(event.target.value as 'document' | 'workspace')
              }
            >
              <option value="document">Current document</option>
              <option value="workspace">Current workspace</option>
            </select>
          </div>
        </div>
      </section>

      {onSystemPromptsChange ? (
        <AiSystemPromptSettings prompts={systemPrompts} onChange={onSystemPromptsChange} />
      ) : null}

      <section
        aria-labelledby="ai-history-privacy-heading"
        data-testid="settings-ai-privacy"
        className="flex flex-col gap-4 rounded-xl border border-border bg-muted/15 p-4"
      >
        <h4 id="ai-history-privacy-heading" className="text-sm font-medium">
          History &amp; Privacy
        </h4>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <Label
            htmlFor="ai-history-enabled"
            className="flex flex-col items-start gap-1 text-left"
          >
            <span>Keep local AI history</span>
            <span className="text-xs font-normal leading-relaxed text-muted-foreground">
              Store up to 500 local run records. Source document text is not copied into
              history.
            </span>
          </Label>
          <Switch
            id="ai-history-enabled"
            checked={historyEnabled}
            onCheckedChange={onHistoryEnabledChange}
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <Label
            htmlFor="ai-cloud-disclosure"
            className="flex flex-col items-start gap-1 text-left"
          >
            <span>Allow cloud AI processing</span>
            <span className="text-xs font-normal leading-relaxed text-muted-foreground">
              Document content is sent to OpenRouter and the selected model provider only
              when you press Run.
            </span>
          </Label>
          <Switch
            id="ai-cloud-disclosure"
            checked={disclosureAccepted}
            onCheckedChange={onDisclosureAcceptedChange}
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <Label
            htmlFor="ai-zdr-only"
            className="flex flex-col items-start gap-1 text-left"
          >
            <span>Zero Data Retention endpoints only</span>
            <span className="text-xs font-normal leading-relaxed text-muted-foreground">
              If a model has no ZDR endpoint, Markdowner asks before allowing
              provider retention for that request.
            </span>
          </Label>
          <Switch id="ai-zdr-only" checked={zdrOnly} onCheckedChange={onZdrOnlyChange} />
        </div>

        {!zdrOnly ? (
          <p
            role="alert"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200"
          >
            Zero Data Retention is off. Selected providers may retain document input and
            output under their own policies.
          </p>
        ) : null}
      </section>

      <p
        aria-live="polite"
        className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
      >
        {error || message}
      </p>
    </section>
  );
}

function ModelDefaultSelect({
  id,
  label,
  value,
  onChange,
  models,
  query,
  primaryModel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  models: AiModelOption[];
  query: string;
  primaryModel?: string;
}) {
  const known = models.some((choice) => choice.id === value);
  const primaryLabel = models.find((choice) => choice.id === primaryModel)?.name ?? primaryModel;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {primaryModel !== undefined ? <option value="">Use primary model · {primaryLabel}</option> : null}
        {value && !known ? <option value={value}>{value} · not in catalog</option> : null}
        {models.filter((choice) => choice.id === value || matchesModel(choice, query)).map((choice) => (
          <option key={choice.id} value={choice.id} disabled={!choice.enabled}>
            {choice.name} · {choice.id}{choice.enabled ? '' : ' · structured output unavailable'}
          </option>
        ))}
      </select>
    </div>
  );
}

function matchesModel(model: AiModelOption, query: string): boolean {
  return `${model.name} ${model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

function formatCreditMetadata(metadata: AiKeyMetadata): string {
  const parts: string[] = [];
  if (metadata.limitRemaining !== null) {
    parts.push(`USD ${metadata.limitRemaining.toFixed(2)} remaining`);
  } else if (metadata.usage !== null) {
    parts.push(`USD ${metadata.usage.toFixed(2)} used`);
  }
  if (metadata.isFreeTier !== null) {
    parts.push(metadata.isFreeTier ? 'free tier' : 'paid account');
  }
  return parts.length > 0 ? parts.join(' · ') : 'Credential verified';
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    return String(reason.message);
  }
  return reason instanceof Error ? reason.message : String(reason);
}
