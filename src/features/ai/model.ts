import type {
  AiModel,
  AiModelOption,
  AiModelPricing,
  AiScope,
  AiTask,
  AiUsage,
} from './types';

export type { AiModel, AiModelOption, AiScope, AiTask } from './types';

export const DEFAULT_AI_MODEL = 'upstage/solar-pro4';
export const PINNED_AI_MODEL_CHOICES = [
  {
    id: DEFAULT_AI_MODEL,
    label: 'Solar Pro 4',
    contextLength: 524_288,
  },
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2', contextLength: 1_048_576 },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', contextLength: 1_048_576 },
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash',
    contextLength: 1_048_576,
  },
  {
    id: 'google/gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    contextLength: 1_048_576,
  },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3', contextLength: 1_048_576 },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    contextLength: 1_000_000,
  },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', contextLength: 131_072 },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5', contextLength: 500_000 },
] as const;
type PinnedAiModelId = (typeof PINNED_AI_MODEL_CHOICES)[number]['id'];
export const PINNED_AI_MODELS: readonly PinnedAiModelId[] =
  PINNED_AI_MODEL_CHOICES.map((choice) => choice.id);
export const WHOLE_DOCUMENT_TOKEN_LIMIT = 50_000;
export const SELECTION_TOKEN_LIMIT = 20_000;
export const DEFAULT_AI_OUTPUT_TOKEN_LIMIT = 4_096;
export const PRD_AI_OUTPUT_TOKEN_LIMIT = 16_384;
export const SUMMARY_SOURCE_LANGUAGE = 'source';
export const NO_ZDR_ENDPOINT_REASON =
  'The selected model has no Zero Data Retention endpoint on OpenRouter. Confirm to run this request with provider retention allowed.';
export const NON_ZDR_CONFIRMATION_LABEL =
  'I understand provider retention may apply and want to run this request without Zero Data Retention.';

const COMMON_LANGUAGE_CODES = [
  'ko',
  'en',
  'ja',
  'zh',
  'ar',
  'bg',
  'bn',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'es',
  'et',
  'fa',
  'fi',
  'fil',
  'fr',
  'gu',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'is',
  'it',
  'kn',
  'lt',
  'lv',
  'ml',
  'mr',
  'ms',
  'nl',
  'no',
  'pa',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'sw',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
] as const;

export interface AiEstimate {
  inputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number | null;
  pricingUpdatedAt: string | null;
}

export interface AiRunGateInput {
  scope: AiScope;
  inputTokens: number;
  contextLength: number;
  maxCostUsd: number | null;
  zdrOnly: boolean;
  eligibleEndpointCount: number | null;
}

export type AiRunGate =
  | { kind: 'ready'; code: null; reason: null }
  | {
      kind: 'confirm';
      code:
        | 'high_cost'
        | 'context_pressure'
        | 'unknown_cost'
        | 'no_zdr_endpoint';
      reason: string;
    }
  | { kind: 'blocked'; code: 'input_limit'; reason: string };

export interface TranslationLanguage {
  code: string;
  name: string;
  quick: boolean;
}

export type DetectedDocumentLanguage = 'en' | 'ja' | 'ko' | 'zh';

function fallbackPinnedModel(id: PinnedAiModelId): AiModel {
  const choice = PINNED_AI_MODEL_CHOICES.find((candidate) => candidate.id === id)!;
  return {
    id,
    name: choice.label,
    description: 'Pinned OpenRouter model; live availability is checked before running.',
    contextLength: choice.contextLength,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportedParameters: ['response_format', 'structured_outputs'],
    pricing: {
      prompt: null,
      completion: null,
      updatedAt: '',
    },
  };
}

export function modelSupportsStructuredOutput(model: AiModel): boolean {
  const parameters = new Set(model.supportedParameters);
  return (
    parameters.has('structured_outputs') ||
    parameters.has('response_format')
  );
}

export function orderModels(
  models: readonly AiModel[],
  task: AiTask,
): AiModelOption[] {
  const byId = new Map(
    models
      .filter(
        (model) =>
          model.outputModalities.length === 0 ||
          model.outputModalities.includes('text'),
      )
      .map((model) => [model.id, model]),
  );
  for (const pinned of PINNED_AI_MODELS) {
    if (!byId.has(pinned)) {
      byId.set(pinned, fallbackPinnedModel(pinned));
    }
  }

  return [...byId.values()]
    .sort((left, right) => {
      const leftPinned = PINNED_AI_MODELS.indexOf(
        left.id as PinnedAiModelId,
      );
      const rightPinned = PINNED_AI_MODELS.indexOf(
        right.id as PinnedAiModelId,
      );
      if (leftPinned >= 0 || rightPinned >= 0) {
        if (leftPinned < 0) return 1;
        if (rightPinned < 0) return -1;
        return leftPinned - rightPinned;
      }
      return left.name.localeCompare(right.name);
    })
    .map((model): AiModelOption => {
      const needsStructured = task !== 'custom';
      const structured = modelSupportsStructuredOutput(model);
      const enabled = !needsStructured || structured;
      return {
        ...model,
        pinned: PINNED_AI_MODELS.includes(
          model.id as PinnedAiModelId,
        ),
        enabled,
        disabledReason: enabled
          ? null
          : 'Structured output is required for this task.',
      };
    });
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function estimateInputTokens(source: string): number {
  const contentEstimate = Math.max(
    Math.ceil(source.length / 3),
    Math.ceil(utf8Length(source) / 4),
  );
  return contentEstimate + 1_200;
}

export function outputTokenLimitForTask(task: AiTask): number {
  return task === 'prd'
    ? PRD_AI_OUTPUT_TOKEN_LIMIT
    : DEFAULT_AI_OUTPUT_TOKEN_LIMIT;
}

export function estimateAiRun({
  source,
  model,
  maxOutputTokens,
}: {
  source: string;
  scope: AiScope;
  model: AiModel;
  maxOutputTokens: number;
}): AiEstimate {
  const inputTokens = estimateInputTokens(source);
  const promptPrice = model.pricing.prompt;
  const completionPrice = model.pricing.completion;
  const maxCostUsd =
    promptPrice === null || completionPrice === null
      ? null
      : inputTokens * promptPrice + maxOutputTokens * completionPrice;
  return {
    inputTokens,
    maxOutputTokens,
    maxCostUsd,
    pricingUpdatedAt: model.pricing.updatedAt || null,
  };
}

export function resolveUsageCost(
  usage: AiUsage,
  pricing: AiModelPricing,
): AiUsage {
  if (usage.costUsd !== null) {
    return { ...usage, costCalculated: false };
  }
  if (pricing.prompt === null || pricing.completion === null) {
    return { ...usage, costCalculated: false };
  }
  return {
    ...usage,
    costUsd:
      usage.promptTokens * pricing.prompt +
      usage.completionTokens * pricing.completion,
    costCalculated: true,
  };
}

export function resolveRunGate(input: AiRunGateInput): AiRunGate {
  const limit =
    input.scope === 'document'
      ? WHOLE_DOCUMENT_TOKEN_LIMIT
      : SELECTION_TOKEN_LIMIT;
  if (input.inputTokens > limit) {
    return {
      kind: 'blocked',
      code: 'input_limit',
      reason: `The input exceeds the ${limit.toLocaleString()} token limit. Select a smaller range; Markdowner will not truncate it.`,
    };
  }
  if (hasNoZdrEndpoint(input.zdrOnly, input.eligibleEndpointCount)) {
    return {
      kind: 'confirm',
      code: 'no_zdr_endpoint',
      reason: NO_ZDR_ENDPOINT_REASON,
    };
  }
  if (input.maxCostUsd === null) {
    return {
      kind: 'confirm',
      code: 'unknown_cost',
      reason:
        'Eligible endpoint pricing is unavailable. Confirm that you want to run without a cost estimate.',
    };
  }
  if (input.maxCostUsd >= 1) {
    return {
      kind: 'confirm',
      code: 'high_cost',
      reason: 'The estimated maximum cost is at least USD 1.00.',
    };
  }
  if (
    input.contextLength > 0 &&
    input.inputTokens >= input.contextLength * 0.8
  ) {
    return {
      kind: 'confirm',
      code: 'context_pressure',
      reason: 'The input uses at least 80% of the model context.',
    };
  }
  return { kind: 'ready', code: null, reason: null };
}

export function hasNoZdrEndpoint(
  zdrOnly: boolean,
  eligibleEndpointCount: number | null | undefined,
): boolean {
  return zdrOnly && eligibleEndpointCount === 0;
}

export function searchLanguages(
  query: string,
  displayLocale = 'en',
): TranslationLanguage[] {
  const normalized = query.trim().toLocaleLowerCase(displayLocale);
  const displayNames =
    typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames([displayLocale], { type: 'language' })
      : null;
  return COMMON_LANGUAGE_CODES.map((code) => ({
    code,
    name: displayNames?.of(code) ?? code,
    quick: code === 'ko' || code === 'en' || code === 'ja' || code === 'zh',
  }))
    .filter(
      (language) =>
        normalized.length === 0 ||
        language.code.toLocaleLowerCase(displayLocale).includes(normalized) ||
        language.name.toLocaleLowerCase(displayLocale).includes(normalized),
    )
    .sort((left, right) => {
      if (left.code === normalized) return -1;
      if (right.code === normalized) return 1;
      if (left.quick !== right.quick) return left.quick ? -1 : 1;
      return left.name.localeCompare(right.name, displayLocale);
    });
}

export function detectDocumentLanguage(
  source: string,
): DetectedDocumentLanguage | null {
  const prose = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\r\n]*`/g, ' ')
    .replace(/!?\[([^\]]*)]\([^)]*\)/g, '$1');
  const counts: Record<DetectedDocumentLanguage, number> = {
    en: 0,
    ja: 0,
    ko: 0,
    zh: 0,
  };
  for (const character of prose) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (
      isInRanges(codePoint, [
        [0xac00, 0xd7af],
        [0x1100, 0x11ff],
      ])
    ) {
      counts.ko += 1;
    } else if (
      isInRanges(codePoint, [
        [0x3040, 0x309f],
        [0x30a0, 0x30ff],
      ])
    ) {
      counts.ja += 1;
    } else if (
      isInRanges(codePoint, [
        [0x3400, 0x4dbf],
        [0x4e00, 0x9fff],
      ])
    ) {
      counts.zh += 1;
    } else if (
      (codePoint >= 0x41 && codePoint <= 0x5a) ||
      (codePoint >= 0x61 && codePoint <= 0x7a)
    ) {
      counts.en += 1;
    }
  }

  // Japanese prose normally combines kana with Han characters. Attribute Han
  // characters to Japanese when kana is present so mixed-script text is not
  // classified as Chinese.
  if (counts.ja > 0) counts.ja += counts.zh;
  const detected = (
    Object.entries(counts) as Array<[DetectedDocumentLanguage, number]>
  ).sort((left, right) => right[1] - left[1])[0];
  return detected && detected[1] > 0 ? detected[0] : null;
}

function isInRanges(
  codePoint: number,
  ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}
