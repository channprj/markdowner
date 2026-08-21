import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenRouterSettings } from './OpenRouterSettings';

afterEach(() => cleanup());

const defaultProps = {
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
      expect(values).toEqual(expectedModels);
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
    expect(screen.getByRole('heading', { name: 'Task Defaults' })).toBeInTheDocument();
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
