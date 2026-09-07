import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenRouterSettings } from './OpenRouterSettings';

afterEach(() => cleanup());

const defaultProps = {
  primaryModel: 'upstage/solar-pro4',
  onPrimaryModelChange: vi.fn(),
  prdModel: 'upstage/solar-pro4',
  summaryModel: 'upstage/solar-pro4',
  translationModel: 'upstage/solar-pro4',
  customPromptModel: 'upstage/solar-pro4',
  summaryTargetLanguage: 'source',
  translationTargetLanguage: 'ko',
  defaultScope: 'document' as const,
  historyEnabled: true,
  onPrdModelChange: vi.fn(),
  onSummaryModelChange: vi.fn(),
  onTranslationModelChange: vi.fn(),
  onCustomPromptModelChange: vi.fn(),
  onSummaryTargetLanguageChange: vi.fn(),
  onTranslationTargetLanguageChange: vi.fn(),
  onDefaultScopeChange: vi.fn(),
  onHistoryEnabledChange: vi.fn(),
};

describe('OpenRouterSettings', () => {
  it('loads new catalog models, searches, refreshes, and keeps primary and task choices independent', async () => {
    const freshModel = { id: 'vendor/new-flagship', name: 'New Flagship', contextLength: 100_000,
      inputModalities: ['text'], outputModalities: ['text'], supportedParameters: ['structured_outputs'],
      pricing: { prompt: 0, completion: 0, updatedAt: '' } };
    const services = { keyStatus: async () => ({ configured: true, maskedLabel: null }),
      listModels: vi.fn().mockResolvedValueOnce([freshModel,
        { ...freshModel, id: 'vendor/plain', name: 'Plain model', supportedParameters: [] }])
        .mockResolvedValueOnce([{ ...freshModel, id: 'vendor/refreshed', name: 'Refreshed model' }]),
      saveKey: vi.fn(), verifyKey: vi.fn(), deleteKey: vi.fn() };
    function Settings() {
      const [primaryModel, setPrimaryModel] = useState('upstage/solar-pro4');
      const [summaryModel, setSummaryModel] = useState('');
      return <OpenRouterSettings {...defaultProps} zdrOnly disclosureAccepted
        primaryModel={primaryModel} onPrimaryModelChange={setPrimaryModel}
        summaryModel={summaryModel} onSummaryModelChange={setSummaryModel}
        onZdrOnlyChange={vi.fn()} onDisclosureAcceptedChange={vi.fn()} services={services} />;
    }
    render(<Settings />);
    const primary = screen.getByLabelText('Primary model');
    await waitFor(() => expect(within(primary).getByRole('option', { name: /New Flagship/ })).toBeEnabled());
    expect(within(primary).getByRole('option', { name: /Plain model/ })).toBeDisabled();
    fireEvent.change(primary, { target: { value: 'vendor/new-flagship' } });
    expect(primary).toHaveValue('vendor/new-flagship');
    expect(screen.getByLabelText('Summary default model')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Summary default model'), { target: { value: 'z-ai/glm-5.3' } });
    expect(primary).toHaveValue('vendor/new-flagship');
    fireEvent.change(screen.getByLabelText('Search default models'), { target: { value: 'glm-5.3' } });
    expect(within(primary).getByRole('option', { name: /GLM 5.3 ·/ })).toBeEnabled();
    expect(primary).toHaveValue('vendor/new-flagship');
    fireEvent.change(screen.getByLabelText('Search default models'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await waitFor(() => expect(within(primary).getByRole('option', { name: /Refreshed model/ })).toBeEnabled());
    expect(primary).toHaveValue('vendor/new-flagship');
    expect(screen.getByLabelText('Summary default model')).toHaveValue('z-ai/glm-5.3');
    fireEvent.change(screen.getByLabelText('Summary default model'), { target: { value: '' } });
    expect(screen.getByLabelText('Summary default model')).toHaveValue('');
  });

  it('keeps saved models and allows retry after a catalog failure', async () => {
    const services = { keyStatus: async () => ({ configured: true, maskedLabel: null }),
      listModels: vi.fn().mockRejectedValueOnce(new Error('Catalog offline')).mockResolvedValueOnce([]),
      saveKey: vi.fn(), verifyKey: vi.fn(), deleteKey: vi.fn() };
    render(<OpenRouterSettings {...defaultProps} primaryModel="vendor/saved" zdrOnly disclosureAccepted
      onZdrOnlyChange={vi.fn()} onDisclosureAcceptedChange={vi.fn()} services={services} />);
    expect(await screen.findByText(/Catalog offline/)).toBeVisible();
    expect(screen.getByLabelText('Primary model')).toHaveValue('vendor/saved');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await waitFor(() => expect(screen.queryByText(/Catalog offline/)).toBeNull());
    expect(screen.getByLabelText('Primary model')).toHaveValue('vendor/saved');
  });

  it('explains the per-request confirmation used when a model has no ZDR endpoint', () => {
    render(
      <OpenRouterSettings
        {...defaultProps}
        zdrOnly
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          saveKey: vi.fn(),
          verifyKey: vi.fn(),
          deleteKey: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText(/asks before allowing provider retention/i)).toBeVisible();
  });

  it('offers popular OpenRouter models for every task default', () => {
    render(
      <OpenRouterSettings
        {...defaultProps}
        zdrOnly
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          saveKey: vi.fn(),
          verifyKey: vi.fn(),
          deleteKey: vi.fn(),
        }}
      />,
    );

    const expectedModels = [
      'upstage/solar-pro4',
      'z-ai/glm-5.2',
      'moonshotai/kimi-k3',
      'deepseek/deepseek-v4-flash-0731',
      'google/gemini-3.6-flash',
      'minimax/minimax-m3',
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-oss-120b',
      'x-ai/grok-4.5',
    ];

    for (const label of [
      'PRD default model',
      'Summary default model',
      'Translation default model',
      'Custom prompt default model',
    ]) {
      const values = Array.from(
        (screen.getByLabelText(label) as HTMLSelectElement).options,
        (option) => option.value,
      );
      expect(values).toEqual(expect.arrayContaining([...expectedModels, '', 'z-ai/glm-5.3',
        'openai/gpt-6-astra', 'anthropic/claude-fable-5.1', 'google/gemini-3.8-flash']));
    }
  });

  it('changes Summary defaults without changing Translation language', async () => {
    const onSummaryModelChange = vi.fn();
    const onSummaryTargetLanguageChange = vi.fn();
    const onTranslationTargetLanguageChange = vi.fn();
    render(
      <OpenRouterSettings
        {...defaultProps}
        zdrOnly
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        onSummaryModelChange={onSummaryModelChange}
        onSummaryTargetLanguageChange={onSummaryTargetLanguageChange}
        onTranslationTargetLanguageChange={onTranslationTargetLanguageChange}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          saveKey: vi.fn(),
          verifyKey: vi.fn(),
          deleteKey: vi.fn(),
        }}
      />,
    );

    expect(screen.getByLabelText('Summary default model')).toHaveValue('upstage/solar-pro4');
    expect(screen.getByLabelText('Summary language')).toHaveValue('source');

    fireEvent.change(screen.getByLabelText('Summary default model'), {
      target: { value: 'moonshotai/kimi-k3' },
    });
    fireEvent.change(screen.getByLabelText('Summary language'), {
      target: { value: 'ko' },
    });

    expect(onSummaryModelChange).toHaveBeenCalledWith('moonshotai/kimi-k3');
    expect(onSummaryTargetLanguageChange).toHaveBeenCalledWith('ko');
    expect(onTranslationTargetLanguageChange).not.toHaveBeenCalled();
  });

  it('groups connection, defaults, and history and privacy controls', async () => {
    const onDefaultScopeChange = vi.fn();
    const onHistoryEnabledChange = vi.fn();
    render(
      <OpenRouterSettings
        {...defaultProps}
        zdrOnly
        disclosureAccepted
        prdModel="z-ai/glm-5.2"
        translationModel="z-ai/glm-5.2"
        customPromptModel="z-ai/glm-5.2"
        translationTargetLanguage="ko"
        defaultScope="document"
        historyEnabled
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        onPrdModelChange={vi.fn()}
        onTranslationModelChange={vi.fn()}
        onCustomPromptModelChange={vi.fn()}
        onTranslationTargetLanguageChange={vi.fn()}
        onDefaultScopeChange={onDefaultScopeChange}
        onHistoryEnabledChange={onHistoryEnabledChange}
        services={{
          keyStatus: vi.fn().mockResolvedValue({ configured: false, maskedLabel: null }),
          saveKey: vi.fn(),
          verifyKey: vi.fn(),
          deleteKey: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'OpenRouter Connection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Models & Task Defaults' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'History & Privacy' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-ai-connection')).toHaveAttribute(
      'aria-labelledby',
      'openrouter-connection-heading',
    );
    expect(screen.getByTestId('settings-ai-defaults')).toHaveAttribute(
      'aria-labelledby',
      'ai-task-defaults-heading',
    );
    expect(screen.getByTestId('settings-ai-privacy')).toHaveAttribute(
      'aria-labelledby',
      'ai-history-privacy-heading',
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Default AI scope' }), {
      target: { value: 'workspace' },
    });
    expect(onDefaultScopeChange).toHaveBeenCalledWith('workspace');

    fireEvent.click(screen.getByRole('switch', { name: /Keep local AI history/i }));
    expect(onHistoryEnabledChange).toHaveBeenCalledWith(false);
  });

  it('keeps the key write-only and returns to onboarding after delete', async () => {
    const saveKey = vi.fn().mockResolvedValue({
      configured: true,
      maskedLabel: '••••secret',
    });
    const verifyKey = vi.fn().mockResolvedValue({
      configured: true,
      maskedLabel: '••••secret',
      label: 'Markdowner',
      limit: 10,
      limitRemaining: 9,
      usage: 1,
      expiresAt: null,
      isFreeTier: false,
    });
    const deleteKey = vi.fn().mockResolvedValue({
      configured: false,
      maskedLabel: null,
    });
    render(
      <OpenRouterSettings
        {...defaultProps}
        zdrOnly
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          saveKey,
          verifyKey,
          deleteKey,
        }}
      />,
    );
    await screen.findByText('Connect OpenRouter to use AI tools.');

    fireEvent.change(screen.getByLabelText('OpenRouter API key'), {
      target: { value: 'sk-or-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }));

    await waitFor(() => expect(saveKey).toHaveBeenCalledWith('sk-or-secret'));
    expect(verifyKey).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue('sk-or-secret')).not.toBeInTheDocument();
    expect(await screen.findByText('Connected as Markdowner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));

    await waitFor(() => expect(deleteKey).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Connect OpenRouter to use AI tools.')).toBeInTheDocument();
  });

  it('warns when zero data retention is disabled', async () => {
    render(
      <OpenRouterSettings
        {...defaultProps}
        zdrOnly={false}
        disclosureAccepted
        onZdrOnlyChange={vi.fn()}
        onDisclosureAcceptedChange={vi.fn()}
        services={{
          keyStatus: vi.fn().mockResolvedValue({
            configured: false,
            maskedLabel: null,
          }),
          saveKey: vi.fn(),
          verifyKey: vi.fn(),
          deleteKey: vi.fn(),
        }}
      />,
    );

    expect(
      await screen.findByText(/providers may retain document input and output/i),
    ).toBeInTheDocument();
  });
});
