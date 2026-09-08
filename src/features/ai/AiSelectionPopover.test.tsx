import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';

import { AiSelectionPopover } from './AiSelectionPopover';
import type { AiSelectionServices } from './AiSelectionPopover';
import { captureSourceSelection } from './selection';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AiSelectionPopover', () => {
  it.each([
    ['z-ai/glm-5.3-flash', '', 'z-ai/glm-5.3-flash'],
    ['z-ai/glm-5.3', '', 'z-ai/glm-5.3'],
    ['z-ai/glm-5.3-flash', 'vendor/inline', 'vendor/inline'],
  ])('uses the primary model unless an inline override is set (%s)', async (primary, override, expected) => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1')!;
    const run = vi.fn<AiSelectionServices['run']>(() => new Promise(() => {}));
    render(<AiSelectionPopover snapshot={snapshot}
      settings={{ ...DEFAULT_SETTINGS, aiPrimaryModel: primary, aiCustomPromptModel: override,
        aiCloudDisclosureAccepted: true, aiZdrOnly: false }} onClose={vi.fn()} onResult={vi.fn()}
      services={{ keyStatus: async () => ({ configured: true, maskedLabel: null }),
        listModels: async () => [{ id: expected, name: expected, contextLength: 100_000,
          inputModalities: ['text'], outputModalities: ['text'], supportedParameters: ['structured_outputs'],
          pricing: { prompt: 0, completion: 0, updatedAt: '' } }], run, cancel: vi.fn() }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Run on selection' }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ model: expected }), expect.any(Function));
  });

  it('blocks an unavailable saved model instead of silently using the first model', async () => {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1')!;
    render(<AiSelectionPopover snapshot={snapshot}
      settings={{ ...DEFAULT_SETTINGS, aiCustomPromptModel: 'vendor/removed',
        aiCloudDisclosureAccepted: true, aiZdrOnly: false }} onClose={vi.fn()} onResult={vi.fn()}
      services={{ keyStatus: async () => ({ configured: true, maskedLabel: null }),
        listModels: async () => [], run: vi.fn(), cancel: vi.fn() }} />);
    expect(await screen.findByRole('option', { name: 'vendor/removed · unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run on selection' })).toBeDisabled();
  });

  function renderMovablePrompt(overrides: Partial<AiSelectionServices> = {}) {
    const snapshot = captureSourceSelection('alpha beta', 6, 10, 'doc-1');
    if (!snapshot) throw new Error('selection required');
    const onClose = vi.fn();
    const onResult = vi.fn();
    const services: AiSelectionServices = {
      keyStatus: async () => ({ configured: true, maskedLabel: null }),
      listModels: async () => [],
      run: vi.fn(),
      cancel: vi.fn(async () => true),
      ...overrides,
    };
    render(<AiSelectionPopover snapshot={snapshot}
      settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true, aiZdrOnly: false }}
      onClose={onClose} onResult={onResult} services={services} />);
    return { snapshot, onClose, onResult, services };
  }

  it('hides and restores the prompt without losing the draft or selected action', async () => {
    const { onClose } = renderMovablePrompt();
    fireEvent.change(screen.getByLabelText('Prompt for selected text'), { target: { value: 'Translate to Korean' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide AI prompt' }));
    expect(screen.queryByRole('textbox', { name: 'Prompt for selected text' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show AI prompt' }));
    expect(screen.getByRole('textbox', { name: 'Prompt for selected text' })).toHaveValue('Translate to Korean');
    expect(screen.getByRole('textbox', { name: 'Prompt for selected text' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Custom instruction' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a hidden request alive and delivers its result once for the captured selection', async () => {
    let finish: ((result: Awaited<ReturnType<AiSelectionServices['run']>>) => void) | undefined;
    const run = vi.fn<AiSelectionServices['run']>(() => new Promise((resolve) => { finish = resolve; }));
    const { onResult, snapshot, services } = renderMovablePrompt({ run });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Run on selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide AI prompt' }));
    expect(screen.getByRole('button', { name: 'Cancel AI request' })).toBeEnabled();
    expect(services.cancel).not.toHaveBeenCalled();
    const request = run.mock.calls[0][0];
    const result = {
      requestId: request.requestId, documentId: 'doc-1', task: 'custom' as const,
      model: request.model, generationId: null, result: null, validationIssues: [],
      rawDiagnostic: null, usage: null, retryAfterSeconds: null,
    };
    await act(async () => finish?.(result));
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result, snapshot, request);
  });

  it('lets Escape hide a running request and keeps cancellation available', async () => {
    const run = vi.fn<AiSelectionServices['run']>(() => new Promise(() => {}));
    const { services, onClose } = renderMovablePrompt({ run });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Run on selection' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Show AI prompt' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel AI request' }));
    expect(services.cancel).toHaveBeenCalledWith(run.mock.calls[0][0].requestId);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a hidden request failure and restores the draft for a deliberate retry', async () => {
    let reject: ((error: Error) => void) | undefined;
    const run = vi.fn<AiSelectionServices['run']>(() => new Promise((_, fail) => { reject = fail; }));
    renderMovablePrompt({ run });
    fireEvent.change(screen.getByLabelText('Prompt for selected text'), { target: { value: 'Improve this paragraph' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Run on selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide AI prompt' }));
    await act(async () => reject?.(new Error('The provider is unavailable.')));
    expect(screen.getAllByText('The provider is unavailable.').some((element) => !element.closest('[hidden]'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show AI prompt' }));
    expect(screen.getByLabelText('Prompt for selected text')).toHaveValue('Improve this paragraph');
    expect(screen.getByRole('button', { name: 'Run on selection' })).toBeEnabled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('moves by dragging the title and keeps the panel inside the viewport', async () => {
    renderMovablePrompt();
    const panel = screen.getByTestId('ai-selection-popover');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, width: 480, height: 400 } as DOMRect);
    const handle = screen.getByRole('button', { name: 'Move AI prompt' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 240, clientY: 320, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 160 });
    expect(panel).toHaveStyle({ left: '260px', top: '140px' });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -900, clientY: -900 });
    expect(panel).toHaveStyle({ left: '8px', top: '8px' });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(panel).toHaveStyle({ left: '8px', top: '8px' });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 240, clientY: 320, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 9000, clientY: 9000 });
    expect(panel).toHaveStyle({ left: `${window.innerWidth - 488}px`, top: `${window.innerHeight - 408}px` });
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: -900, clientY: -900 });
    expect(panel).toHaveStyle({ left: `${window.innerWidth - 488}px`, top: `${window.innerHeight - 408}px` });
  });

  it('supports keyboard movement and clamps its position when the window shrinks', () => {
    renderMovablePrompt();
    const panel = screen.getByTestId('ai-selection-popover');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, width: 480, height: 400 } as DOMRect);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move AI prompt' }), { key: 'ArrowUp' });
    expect(panel).toHaveStyle({ left: '200px', top: '280px' });
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    fireEvent(window, new Event('resize'));
    expect(panel).toHaveStyle({ top: '92px' });
    Object.defineProperty(window, 'innerHeight', { value: previousHeight, configurable: true });
  });

  it('reserves output for the selected text even in a document larger than the model context', async () => {
    const source = `Edit this.\n\n${'Unselected paragraph.\n'.repeat(8_000)}`;
    const snapshot = captureSourceSelection(source, 0, 10, 'doc-large');
    if (!snapshot) throw new Error('selection required');
    const run = vi.fn(async (request) => ({
      requestId: request.requestId, documentId: request.documentId,
      task: request.task, model: request.model, generationId: null,
      result: null, validationIssues: [], rawDiagnostic: null,
      usage: null, retryAfterSeconds: null,
    }));
    render(<AiSelectionPopover snapshot={snapshot}
      settings={{ ...DEFAULT_SETTINGS, aiCloudDisclosureAccepted: true, aiZdrOnly: false,
        aiSystemPrompts: { custom: 'Keep inline edits concise.' } }}
      onClose={vi.fn()} onResult={vi.fn()} services={{
        keyStatus: async () => ({ configured: true, maskedLabel: null }),
        listModels: async () => [{ id: DEFAULT_SETTINGS.aiPrimaryModel,
          name: 'Small model', contextLength: 8_192, maxCompletionTokens: 4_096,
          inputModalities: ['text'], outputModalities: ['text'],
          supportedParameters: ['structured_outputs'],
          pricing: { prompt: 0, completion: 0, updatedAt: '' } }],
        run, cancel: async () => true,
      }} />);
    const button = await screen.findByRole('button', { name: 'Run on selection' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0].maxOutputTokens).toBe(4_096);
    expect(run.mock.calls[0][0].systemPrompt).toBe('Keep inline edits concise.');
  });

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
      expect(modelPricing).toHaveBeenCalledWith('z-ai/glm-5.3-flash', true),
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
              id: DEFAULT_SETTINGS.aiPrimaryModel,
              name: 'GLM 5.3 Flash',
              description: null,
              contextLength: 1_310_720,
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
      model: 'z-ai/glm-5.3-flash',
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
              id: DEFAULT_SETTINGS.aiPrimaryModel,
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
