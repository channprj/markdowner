import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_MODEL,
  PINNED_AI_MODELS,
  SUMMARY_SOURCE_LANGUAGE,
  detectDocumentLanguage,
  estimateAiRun,
  estimateInputTokens,
  orderModels,
  outputTokenLimitForTask,
  resolveUsageCost,
  resolveRunGate,
  searchLanguages,
  type AiModel,
} from './model';

function model(overrides: Partial<AiModel>): AiModel {
  return {
    id: 'vendor/model',
    name: 'Model',
    contextLength: 100_000,
    maxCompletionTokens: 100_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: ['response_format', 'structured_outputs'],
    pricing: {
      prompt: 0.000001,
      completion: 0.000002,
      updatedAt: '2026-07-31T00:00:00Z',
    },
    ...overrides,
  };
}

describe('AI model policy', () => {
  it('uses Solar Pro 4 by default and pins the curated popular model catalog', () => {
    expect(DEFAULT_AI_MODEL).toBe('upstage/solar-pro4');
    expect(PINNED_AI_MODELS).toEqual([
      'upstage/solar-pro4',
      'z-ai/glm-5.2',
      'moonshotai/kimi-k3',
      'deepseek/deepseek-v4-flash-0731',
      'google/gemini-3.6-flash',
      'minimax/minimax-m3',
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-oss-120b',
      'x-ai/grok-4.5',
    ]);
  });

  it('pins the fixed models and disables non-structured models for built-ins', () => {
    const options = orderModels(
      [
        model({ id: 'plain/text', supportedParameters: [] }),
        model({ id: 'moonshotai/kimi-k3', name: 'Kimi K3' }),
        model({ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }),
      ],
      'translation',
    );

    expect(options.slice(0, PINNED_AI_MODELS.length).map((entry) => entry.id)).toEqual(
      PINNED_AI_MODELS,
    );
    expect(options.find((entry) => entry.id === 'upstage/solar-pro4')).toMatchObject({
      name: 'Solar Pro 4',
      contextLength: 524_288,
      supportedParameters: ['response_format', 'structured_outputs'],
      pinned: true,
      enabled: true,
    });
    expect(options.find((entry) => entry.id === 'openai/gpt-oss-120b')).toMatchObject({
      contextLength: 131_072,
      pinned: true,
      enabled: true,
    });
    expect(options.find((entry) => entry.id === 'plain/text')).toMatchObject({
      enabled: false,
      disabledReason: 'Structured output is required for this task.',
    });
  });

  it('keeps text-only custom prompt models enabled without structured output', () => {
    const [option] = orderModels(
      [model({ id: 'plain/text', supportedParameters: [] })],
      'custom',
    );

    expect(option.enabled).toBe(true);
  });

  it('requires structured output and gives structured tasks enough output headroom', () => {
    const structured = orderModels(
      [model({ id: 'structured/text' })],
      'summary',
    ).find((option) => option.id === 'structured/text');
    const plain = orderModels(
      [model({ id: 'plain/text', supportedParameters: [] })],
      'summary',
    ).find((option) => option.id === 'plain/text');

    expect(structured?.enabled).toBe(true);
    expect(plain?.disabledReason).toMatch(/Structured output/);
    expect(
      outputTokenLimitForTask(
        'summary',
        '# Source\n\nOriginal facts.',
        model({ contextLength: 524_288, maxCompletionTokens: 131_072 }),
      ),
    ).toBe(32_768);
    expect(
      outputTokenLimitForTask(
        'prd',
        '# Product\n\nClear requirements.',
        model({ contextLength: 524_288, maxCompletionTokens: 131_072 }),
      ),
    ).toBe(65_536);
    expect(SUMMARY_SOURCE_LANGUAGE).toBe('source');
  });

  it('clamps adaptive output headroom to the provider and remaining context', () => {
    expect(
      outputTokenLimitForTask(
        'custom',
        'Expand this.',
        model({ contextLength: 524_288, maxCompletionTokens: 8_192 }),
      ),
    ).toBe(8_192);

    const source = 'A'.repeat(12_000);
    const contextLength = 8_000;
    expect(
      outputTokenLimitForTask(
        'translation',
        source,
        model({ contextLength, maxCompletionTokens: 131_072 }),
      ),
    ).toBe(contextLength - estimateInputTokens(source));
  });
});

describe('AI estimates and run gates', () => {
  it('keeps provider cost authoritative and calculates a missing cost from pricing', () => {
    expect(
      resolveUsageCost(
        {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          costUsd: 0.004,
          costCalculated: true,
        },
        { prompt: 0.000001, completion: 0.000002, updatedAt: 'now' },
      ),
    ).toMatchObject({ costUsd: 0.004, costCalculated: false });

    expect(
      resolveUsageCost(
        {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          costUsd: null,
          costCalculated: false,
        },
        { prompt: 0.000001, completion: 0.000002, updatedAt: 'now' },
      ),
    ).toMatchObject({ costUsd: 0.00014, costCalculated: true });
  });

  it('calculates a safe maximum cost from prompt and completion prices', () => {
    const estimate = estimateAiRun({
      source: '한글과 English text',
      scope: 'document',
      model: model({
        contextLength: 200_000,
        pricing: {
          prompt: 0.000001,
          completion: 0.000002,
          updatedAt: '2026-07-31T00:00:00Z',
        },
      }),
      maxOutputTokens: 4_000,
    });

    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.maxCostUsd).toBeCloseTo(
      estimate.inputTokens * 0.000001 + 4_000 * 0.000002,
    );
    expect(estimate.pricingUpdatedAt).toBe('2026-07-31T00:00:00Z');
  });

  it('requires confirmation at one dollar or eighty percent context', () => {
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 800,
        contextLength: 1_000,
        maxCostUsd: 0.2,
        zdrOnly: false,
        eligibleEndpointCount: null,
      }).kind,
    ).toBe('confirm');
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 100,
        contextLength: 1_000,
        maxCostUsd: 1,
        zdrOnly: false,
        eligibleEndpointCount: null,
      }).kind,
    ).toBe('confirm');
  });

  it('confirms unknown cost while never truncating scope limits', () => {
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 50_001,
        contextLength: 1_000_000,
        maxCostUsd: 0.2,
        zdrOnly: false,
        eligibleEndpointCount: null,
      }),
    ).toMatchObject({ kind: 'blocked', code: 'input_limit' });
    expect(
      resolveRunGate({
        scope: 'selection',
        inputTokens: 20_001,
        contextLength: 1_000_000,
        maxCostUsd: 0.2,
        zdrOnly: false,
        eligibleEndpointCount: null,
      }),
    ).toMatchObject({ kind: 'blocked', code: 'input_limit' });
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 100,
        contextLength: 1_000_000,
        maxCostUsd: null,
        zdrOnly: true,
        eligibleEndpointCount: null,
      }),
    ).toMatchObject({ kind: 'confirm', code: 'unknown_cost' });
  });

  it('distinguishes a missing ZDR endpoint from merely unknown pricing', () => {
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 100,
        contextLength: 1_000_000,
        maxCostUsd: null,
        zdrOnly: true,
        eligibleEndpointCount: 0,
      }),
    ).toMatchObject({ kind: 'confirm', code: 'no_zdr_endpoint' });
    expect(
      resolveRunGate({
        scope: 'document',
        inputTokens: 100,
        contextLength: 1_000_000,
        maxCostUsd: null,
        zdrOnly: true,
        eligibleEndpointCount: 1,
      }),
    ).toMatchObject({ kind: 'confirm', code: 'unknown_cost' });
  });
});

describe('translation languages', () => {
  it('detects the four built-in source-language families locally', () => {
    expect(detectDocumentLanguage('# 제품 요구사항\n\n사용자가 문서를 엽니다.')).toBe(
      'ko',
    );
    expect(detectDocumentLanguage('# Requirements\n\nThe user opens a document.')).toBe(
      'en',
    );
    expect(detectDocumentLanguage('# 要件\n\nユーザーが文書を開きます。')).toBe(
      'ja',
    );
    expect(detectDocumentLanguage('# 需求\n\n用户打开文档。')).toBe('zh');
    expect(detectDocumentLanguage('`pnpm test` 123')).toBeNull();
  });

  it('searches by BCP 47 code and localized language name', () => {
    expect(searchLanguages('ja', 'en').slice(0, 1)).toMatchObject([
      { code: 'ja' },
    ]);
    expect(searchLanguages('Korean', 'en')).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ko' })]),
    );
  });
});
