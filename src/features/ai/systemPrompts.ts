import defaults from './systemPrompts.json';

export const DEFAULT_SYSTEM_PROMPTS = defaults;
export type AiPromptTask = keyof typeof defaults;
export type AiSystemPrompts = Partial<Record<AiPromptTask, string>>;

export function systemPromptForTask(task: AiPromptTask, overrides: AiSystemPrompts = {}): string {
  return overrides[task]?.trim() || defaults[task];
}

export function normalizeSystemPrompts(value: unknown): AiSystemPrompts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(defaults).flatMap((task) => {
    const prompt = (value as Record<string, unknown>)[task];
    return typeof prompt === 'string' ? [[task, prompt]] : [];
  }));
}
