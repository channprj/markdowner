import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';

import { AiSelectionPopover } from './AiSelectionPopover';
import { captureSourceSelection } from './selection';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AiSelectionPopover', () => {
  it('waits for endpoint eligibility before enabling a selected-text request', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    let resolvePricing:
      | ((pricing: {
          prompt: number | null;
          completion: number | null;
          updatedAt: string;
          eligibleEndpointCount: number;
        }) => void)
      | undefined;
    const modelPricing = vi.fn(
      () =>
        new Promise<{
          prompt: number | null;
          completion: number | null;
          updatedAt: string;
          eligibleEndpointCount: number;
        }>((resolve) => {
          resolvePricing = resolve;
        }),
    );

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onClose={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({ configured: true, maskedLabel: 'sk-or-…test' })),
          listModels: vi.fn(async () => []),
          modelPricing,
          run: vi.fn(),
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run on selection' });
    await waitFor(() =>
      expect(modelPricing).toHaveBeenCalledWith('upstage/solar-pro4', true),
    );
    expect(runButton).toBeDisabled();

    resolvePricing?.({
      prompt: 0.000_000_03,
      completion: 0.000_000_12,
      updatedAt: '2026-08-22T00:00:00Z',
      eligibleEndpointCount: 1,
    });

    await waitFor(() => expect(runButton).toBeEnabled());
  });

  it('requires explicit confirmation before using a selected-text model without a ZDR endpoint', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn(async (request) => ({
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

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onClose={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({ configured: true, maskedLabel: 'sk-or-…test' })),
          listModels: vi.fn(async () => [
            {
              id: DEFAULT_SETTINGS.aiCustomPromptModel,
              name: 'Solar Pro 4',
              description: null,
              contextLength: 524_288,
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportedParameters: ['structured_outputs'],
              pricing: { prompt: null, completion: null, updatedAt: '' },
            },
          ]),
          modelPricing: vi.fn(async () => ({
            prompt: null,
            completion: null,
            updatedAt: '',
            eligibleEndpointCount: 0,
          })),
          run,
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run on selection' });
    const confirmation = await screen.findByRole('checkbox', {
      name: /run this request without Zero Data Retention/i,
    });
    expect(runButton).toBeDisabled();
    fireEvent.click(confirmation);
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({
      model: 'upstage/solar-pro4',
      zdrOnly: false,
    });
  });

  it('runs a custom prompt against the captured range without mutating it first', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn(async (request) => ({
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
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onClose={vi.fn()}
        onResult={onResult}
        services={{
          keyStatus: vi.fn(async () => ({
            configured: true,
            maskedLabel: 'sk-or-…test',
          })),
          listModels: vi.fn(async () => [
            {
              id: 'z-ai/glm-5.2',
              name: 'GLM 5.2',
              description: null,
              contextLength: 131_072,
              maxCompletionTokens: 131_072,
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportedParameters: ['structured_outputs'],
              pricing: {
                prompt: 0.0000001,
                completion: 0.0000001,
                updatedAt: '2026-07-31T00:00:00Z',
              },
            },
          ]),
          run,
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    const prompt = screen.getByLabelText('Prompt for selected text');
    expect(prompt).toHaveFocus();
    fireEvent.change(prompt, {
      target: { value: 'Make this uppercase' },
    });
    const runButton = screen.getByRole('button', { name: 'Run on selection' });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.keyDown(prompt, { key: 'Enter' });

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({
      documentId: 'doc-1',
      source: 'alpha beta',
      selection: { start: 6, end: 10 },
      task: 'custom',
      instruction: 'Make this uppercase',
      maxOutputTokens: 65_536,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('keeps Shift+Enter for multiline input and ignores IME Enter events', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn(async (request) => ({
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

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onClose={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({
            configured: true,
            maskedLabel: 'sk-or-…test',
          })),
          listModels: vi.fn(async () => [
            {
              id: DEFAULT_SETTINGS.aiCustomPromptModel,
              name: 'Default model',
              description: null,
              contextLength: 131_072,
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportedParameters: ['structured_outputs'],
              pricing: {
                prompt: 0.0000001,
                completion: 0.0000001,
                updatedAt: '2026-07-31T00:00:00Z',
              },
            },
          ]),
          run,
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    const prompt = screen.getByLabelText('Prompt for selected text');
    fireEvent.change(prompt, { target: { value: 'First line' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled();
    });

    expect(fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: true })).toBe(true);
    fireEvent.change(prompt, { target: { value: 'First line\nSecond line' } });
    expect(prompt).toHaveValue('First line\nSecond line');
    fireEvent.keyDown(prompt, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(prompt, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(prompt, { key: 'Process' });

    expect(run).not.toHaveBeenCalled();
  });

  it('closes with Escape before a request starts', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const onClose = vi.fn();

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{
          ...DEFAULT_SETTINGS,
          aiCloudDisclosureAccepted: true,
        }}
        onClose={onClose}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({
            configured: false,
            maskedLabel: null,
          })),
          listModels: vi.fn(),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    await screen.findByText(/Add and verify an OpenRouter key/i);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('recovers from a stalled model catalog without treating the key as missing', async () => {
    vi.useFakeTimers();
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const listModels = vi.fn(
      () =>
        new Promise<never>(() => {
          // Intentionally pending to reproduce a stalled desktop request.
        }),
    );

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onClose={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({
            configured: true,
            maskedLabel: 'sk-or-…test',
          })),
          listModels,
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Loading models…')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.queryByText('Loading models…')).not.toBeInTheDocument();
    expect(screen.queryByText(/Add and verify an OpenRouter key/i)).toBeNull();
    expect(screen.getByText(/model catalog did not respond/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry model catalog' }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('selects presets without running and delegates local-agent actions', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn();
    const onLocalAgent = vi.fn();

    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true }}
        onClose={vi.fn()}
        onResult={vi.fn()}
        onLocalAgent={onLocalAgent}
        services={{
          keyStatus: vi.fn(async () => ({ configured: true, maskedLabel: 'sk-or-…test' })),
          listModels: vi.fn(async () => []),
          run,
          cancel: vi.fn(async () => true),
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Improve' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make table' }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use local agent' }));
    expect(onLocalAgent).toHaveBeenCalledWith(snapshot);
    expect(run).not.toHaveBeenCalled();
  });

  it('focuses the custom instruction field when selected', () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    render(
      <AiSelectionPopover
        snapshot={snapshot}
        settings={DEFAULT_SETTINGS}
        onClose={vi.fn()}
        onResult={vi.fn()}
        services={{
          keyStatus: vi.fn(async () => ({ configured: false, maskedLabel: null })),
          listModels: vi.fn(),
          run: vi.fn(),
          cancel: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Custom instruction' }));
    expect(screen.getByLabelText('Prompt for selected text')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Use local agent' })).toBeNull();
  });
});
