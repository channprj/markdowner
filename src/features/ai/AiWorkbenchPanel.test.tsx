import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';

import { AiWorkbenchPanel } from './AiWorkbenchPanel';
import type { AiModel, AiRunRequest } from './types';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

const glm: AiModel = {
  id: 'z-ai/glm-5.2',
  name: 'GLM 5.2',
  description: null,
  contextLength: 1_048_576,
  maxCompletionTokens: 131_072,
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportedParameters: ['structured_outputs', 'response_format'],
  pricing: {
    prompt: 0.000_001,
    completion: 0.000_002,
    updatedAt: '2026-07-31T00:00:00Z',
  },
};

const solar: AiModel = {
  ...glm,
  id: 'upstage/solar-pro4',
  name: 'Solar Pro 4',
  contextLength: 524_288,
};

describe('AiWorkbenchPanel', () => {
  it('summarizes the current document in the source language without a selection', async () => {
    const run = vi.fn().mockImplementation(async (request: AiRunRequest) => runResult(request));
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        documentPath="/vault/notes.md"
        documentLabel="notes.md"
        source={'# Source\n\nOriginal facts.'}
        selection={{ start: 2, end: 8 }}
        workspaceRoot="/vault"
        workspaceDocumentCount={3}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'summary' },
    });

    expect(screen.getByText('Current document · notes.md')).toBeVisible();
    expect(screen.queryByRole('option', { name: /Workspace/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Summary language')).toHaveValue('source');
    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'summary',
        documentId: 'doc-1',
        source: '# Source\n\nOriginal facts.',
        selection: null,
        targetLanguage: null,
        maxOutputTokens: 32_768,
        recordHistory: true,
        scope: expect.objectContaining({ kind: 'document' }),
      }),
      expect.any(Function),
    );
  });

  it('persists and requests an explicit Summary language independently', async () => {
    const run = vi.fn().mockImplementation(async (request: AiRunRequest) => runResult(request));
    const onSettingsChange = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        documentLabel="notes.md"
        source={'# Source\n\nOriginal facts.'}
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={onSettingsChange}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'summary' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Korean · ko/i }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        aiSummaryTargetLanguage: 'ko',
        aiTranslationTargetLanguage: DEFAULT_SETTINGS.aiTranslationTargetLanguage,
      }),
    );
    const runButton = screen.getByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'summary', targetLanguage: 'ko' }),
      expect.any(Function),
    );
  });

  it('shows task defaults, estimate, key onboarding, and running cancellation', async () => {
    const run = vi.fn(
      () =>
        new Promise<never>(() => {
          // Intentionally pending so the running/cancel UI remains visible.
        }),
    );
    const cancel = vi.fn().mockResolvedValue(true);
    const openActivity = vi.fn().mockResolvedValue(undefined);
    const onStart = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="# Product\n\nClear requirements."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onStart={onStart}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel,
          openActivity,
        }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'AI task' })).toHaveValue('prd');
    expect(await screen.findByRole('option', { name: /GLM 5.2/ })).toHaveValue(
      'z-ai/glm-5.2',
    );
    expect(screen.getByText(/Estimated input/i)).toBeInTheDocument();
    expect(screen.getByText('Output cap · 65,536 tokens')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        task: 'prd',
        maxOutputTokens: 65_536,
      }),
    );
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    const activityLink = await screen.findByRole('button', {
      name: 'OpenRouter Activity',
    });
    fireEvent.click(activityLink);
    expect(openActivity).toHaveBeenCalledTimes(1);
  });

  it('blocks execution until cloud disclosure is accepted', async () => {
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="Document"
        selection={null}
        settings={DEFAULT_SETTINGS}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getAllByText(/approve cloud processing/i)).not.toHaveLength(0);
  });

  it('does not fetch a catalog or run a request when no key is configured', async () => {
    const listModels = vi.fn();
    const modelPricing = vi.fn();
    const run = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="Document"
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onOpenSettings={onOpenSettings}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          listModels,
          modelPricing,
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByText(/Connect OpenRouter/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(listModels).not.toHaveBeenCalled();
    expect(modelPricing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(run).not.toHaveBeenCalled();
  });

  it('stops refreshing and exposes a retry when the model catalog hangs', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(
      () =>
        new Promise<AiModel[]>(() => {
          // Intentionally pending to reproduce a stalled desktop request.
        }),
    );
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="Document"
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels,
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Refreshing')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.queryByText('Refreshing')).not.toBeInTheDocument();
    expect(screen.getByText(/model catalog did not respond/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry model catalog' }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('persists a translation target and blocks a detected same-language request', async () => {
    const onSettingsChange = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="# 요구사항\n\n사용자가 문서를 엽니다."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
          aiTranslationTargetLanguage: 'en',
        }}
        onSettingsChange={onSettingsChange}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'translation' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Korean · ko/i }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiTranslationTargetLanguage: 'ko' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/already appears to be Korean/i);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('keeps a model override request-local until the user saves it as default', async () => {
    const onSettingsChange = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={onSettingsChange}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([
            solar,
            glm,
            {
              ...glm,
              id: 'moonshotai/kimi-k3',
              name: 'Kimi K3',
            },
          ]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    const modelSelect = await screen.findByRole('combobox', {
      name: 'AI model',
    });
    fireEvent.change(modelSelect, {
      target: { value: 'moonshotai/kimi-k3' },
    });

    expect(onSettingsChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save as PRD default' }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiPrdModel: 'moonshotai/kimi-k3' }),
    );
  });

  it('searches the runtime model catalog by name or slug', async () => {
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([
            solar,
            glm,
            {
              ...glm,
              id: 'moonshotai/kimi-k3',
              name: 'Kimi K3',
            },
          ]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    await screen.findByRole('option', { name: /GLM 5.2/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'kimi' },
    });

    expect(screen.queryByRole('option', { name: /GLM 5.2/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Kimi K3/ })).toBeInTheDocument();
  });

  it('does not silently replace a saved model that is no longer available', async () => {
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
          aiPrdModel: 'vendor/removed-model',
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    const modelSelect = await screen.findByRole('combobox', {
      name: 'AI model',
    });
    expect(modelSelect).toHaveValue('vendor/removed-model');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /saved model is unavailable/i,
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('uses live endpoint pricing and waits for it before enabling Run', async () => {
    let resolvePricing: ((pricing: AiModel['pricing']) => void) | undefined;
    const modelPricing = vi.fn(
      () =>
        new Promise<AiModel['pricing']>((resolve) => {
          resolvePricing = resolve;
        }),
    );
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          modelPricing,
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() =>
      expect(modelPricing).toHaveBeenCalledWith('upstage/solar-pro4', true),
    );
    expect(runButton).toBeDisabled();

    resolvePricing?.({
      prompt: 0.000_003,
      completion: 0.000_004,
      updatedAt: '2026-07-31T01:00:00Z',
    });

    await waitFor(() => expect(runButton).toBeEnabled());
    expect(screen.getByText(/2026-07-31T01:00:00Z/)).toBeInTheDocument();
  });

  it('runs without request-level ZDR only after confirming that the model has no ZDR endpoint', async () => {
    const run = vi.fn().mockImplementation(async (request: AiRunRequest) => runResult(request));
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          modelPricing: vi.fn().mockResolvedValue({
            prompt: null,
            completion: null,
            updatedAt: '',
            eligibleEndpointCount: 0,
          }),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run' });
    const confirmation = await screen.findByRole('checkbox', {
      name: /run this request without Zero Data Retention/i,
    });
    expect(screen.getByText(/has no Zero Data Retention endpoint/i)).toBeVisible();
    expect(runButton).toBeDisabled();

    fireEvent.click(confirmation);
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'upstage/solar-pro4',
        zdrOnly: false,
      }),
      expect.any(Function),
    );
  });

  it('keeps request-level ZDR when endpoint pricing is unknown but an endpoint exists', async () => {
    const run = vi.fn().mockImplementation(async (request: AiRunRequest) => runResult(request));
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          modelPricing: vi.fn().mockResolvedValue({
            prompt: null,
            completion: null,
            updatedAt: '',
            eligibleEndpointCount: 1,
          }),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run' });
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'I understand and want to run this request.',
      }),
    );
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ zdrOnly: true }),
      expect.any(Function),
    );
  });

  it('shows Retry-After metadata without automatically retrying a paid request', async () => {
    const run = vi.fn().mockRejectedValue({
      code: 'rate_limited',
      message: 'OpenRouter rate-limited this request.',
      retryAfterSeconds: 12,
    });
    render(
      <AiWorkbenchPanel
        documentId="doc-1"
        source="A requirement."
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: true,
            maskedLabel: '••••secret',
          }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    expect(
      await screen.findByText(/Retry after 12 seconds/i),
    ).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs against an explicitly selected open document and its draft', async () => {
    const run = vi.fn(
      () =>
        new Promise<never>(() => {
          // Keep the request active so only its input contract is under test.
        }),
    );
    render(
      <AiWorkbenchPanel
        documentId="doc-current"
        documentPath="/vault/current.md"
        documentLabel="current.md"
        source="# Current"
        openDocuments={[
          { documentId: 'doc-current', path: '/vault/current.md', label: 'current.md' },
          { documentId: 'doc-other', path: '/vault/other.md', label: 'other.md' },
        ]}
        documentSources={{ 'doc-other': '# Other draft' }}
        selection={null}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onSettingsChange={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel: vi.fn(),
        }}
      />,
    );

    fireEvent.change(await screen.findByRole('combobox', { name: 'Document' }), {
      target: { value: 'doc-other' },
    });
    const runButton = screen.getByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-other',
        source: '# Other draft',
        recordHistory: true,
        scope: expect.objectContaining({ kind: 'document' }),
      }),
      expect.any(Function),
    );
  });

  it('translates workspace Markdown files sequentially without changing the selected model', async () => {
    const run = vi.fn().mockImplementation(async (request) => ({
      requestId: request.requestId,
      documentId: request.documentId,
      task: request.task,
      model: request.model,
      generationId: null,
      result: null,
      validationIssues: [],
      rawDiagnostic: null,
      usage: null,
      retryAfterSeconds: null,
    }));
    const onResult = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-current"
        documentPath="/vault/current.md"
        source="# Current draft"
        workspaceRoot="/vault"
        workspaceDocumentCount={2}
        workspaceDocumentPaths={['/vault/current.md', '/vault/other.md']}
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={vi.fn()}
        onResult={onResult}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel: vi.fn(),
          readDocuments: vi.fn().mockResolvedValue([
            { path: '/vault/current.md', contents: '# Stale disk copy' },
            { path: '/vault/other.md', contents: '# Other document' },
          ]),
        }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'translation' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), {
      target: { value: 'workspace' },
    });
    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls.map(([request]) => request.model)).toEqual([
      'upstage/solar-pro4',
      'upstage/solar-pro4',
    ]);
    expect(run.mock.calls[0][0]).toMatchObject({
      source: '# Current draft',
      scope: { kind: 'workspace' },
      maxOutputTokens: 32_768,
    });
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it('resumes a workspace batch at the failed file with the original model', async () => {
    const longTranslationSource = 'A'.repeat(80_000);
    const run = vi.fn()
      .mockImplementationOnce(async (request) => runResult(request))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async (request) => runResult(request));
    const onResult = vi.fn();
    render(
      <AiWorkbenchPanel
        documentId="doc-current"
        documentPath="/vault/current.md"
        source="# Current draft"
        workspaceRoot="/vault"
        workspaceDocumentCount={2}
        workspaceDocumentPaths={['/vault/current.md', '/vault/other.md']}
        selection={null}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onSettingsChange={vi.fn()}
        onResult={onResult}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: true, maskedLabel: '••••secret' }),
          listModels: vi.fn().mockResolvedValue([solar, glm]),
          run,
          cancel: vi.fn(),
          readDocuments: vi.fn().mockResolvedValue([
            { path: '/vault/current.md', contents: '# Current draft' },
            { path: '/vault/other.md', contents: longTranslationSource },
          ]),
        }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'AI task' }), {
      target: { value: 'translation' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), {
      target: { value: 'workspace' },
    });
    const runButton = await screen.findByRole('button', { name: 'Run' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    expect(await screen.findByText('offline')).toBeVisible();
    expect(localStorage.getItem('markdowner.ai.translation-resume.v1')).not.toContain(
      longTranslationSource,
    );
    const failedRequest = run.mock.calls[1][0];
    expect(
      JSON.parse(localStorage.getItem('markdowner.ai.translation-resume.v1') ?? '{}')
        .maxOutputTokens,
    ).toBe(failedRequest.maxOutputTokens);
    fireEvent.click(screen.getByRole('button', { name: 'Resume translation' }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(run.mock.calls[2][0]).toMatchObject({
      requestId: failedRequest.requestId,
      documentId: failedRequest.documentId,
      model: 'upstage/solar-pro4',
      resume: true,
    });
    expect(onResult).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Resume translation' })).not.toBeInTheDocument(),
    );
  });
});

function runResult(request: AiRunRequest) {
  return {
    requestId: request.requestId,
    documentId: request.documentId,
    task: request.task,
    model: request.model,
    generationId: null,
    result: null,
    validationIssues: [],
    rawDiagnostic: null,
    usage: null,
    retryAfterSeconds: null,
  };
}
