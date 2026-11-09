import type { AiSelectionFormat } from './types';

export type SelectionActionId =
  | 'improve'
  | 'fix'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'make_list'
  | 'make_table'
  | 'translate_ko'
  | 'translate_en'
  | 'custom';

export interface SelectionAction {
  id: SelectionActionId;
  label: string;
  description: string;
  instruction: string | null;
  /**
   * `text` rewrites prose and keeps every Markdown token in place. `markdown`
   * lets the model restructure the selection with Markdown syntax, so format
   * requests become real lists, tables, or headings.
   */
  format: AiSelectionFormat;
  /** Set for translation actions so the provider receives an explicit target. */
  targetLanguage: string | null;
}

export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  {
    id: 'improve',
    label: 'Improve',
    description: 'Fix clarity, grammar, and flow. Formatting stays as is.',
    instruction:
      'Improve clarity, grammar, flow, and readability while preserving meaning, facts, language, links, and useful Markdown structure.',
    format: 'text',
    targetLanguage: null,
  },
  {
    id: 'fix',
    label: 'Fix spelling & grammar',
    description: 'Correct spelling, grammar, and typos only.',
    instruction:
      'Correct spelling, grammar, punctuation, and obvious typos only. Keep the meaning, wording, tone, language, links, and Markdown structure unchanged.',
    format: 'text',
    targetLanguage: null,
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Rewrite substantially; may restructure with Markdown.',
    instruction:
      'Rewrite substantially while preserving intent, supported facts, language, links, and Markdown semantics.',
    format: 'markdown',
    targetLanguage: null,
  },
  {
    id: 'shorten',
    label: 'Shorten',
    description: 'Make it concise without losing essentials.',
    instruction:
      'Make the selection concise without dropping essential facts, decisions, constraints, or links.',
    format: 'text',
    targetLanguage: null,
  },
  {
    id: 'expand',
    label: 'Expand',
    description: 'Add useful explanation from the surrounding context.',
    instruction:
      'Add useful explanation from the selection and surrounding document context without inventing facts or commitments.',
    format: 'markdown',
    targetLanguage: null,
  },
  {
    id: 'make_list',
    label: 'Make list',
    description: 'Turn the selection into a Markdown bullet list.',
    instruction:
      'Return the selection as one Markdown bullet list ("- " items), one item per distinct point, preserving the language and supported facts. Return no surrounding explanation.',
    format: 'markdown',
    targetLanguage: null,
  },
  {
    id: 'make_table',
    label: 'Make table',
    description: 'Turn the selection into a GFM table.',
    instruction:
      'Return exactly one valid GFM table with neutral headers and only facts supported by the selection. Leave missing source fields empty. Return no surrounding explanation.',
    format: 'markdown',
    targetLanguage: null,
  },
  {
    id: 'translate_ko',
    label: 'Translate to Korean',
    description: 'Translate the selection into Korean.',
    instruction:
      'Translate the selected text into Korean. Preserve meaning, tone, terminology, proper nouns, links, and Markdown structure. Return only the translation.',
    format: 'text',
    targetLanguage: 'ko',
  },
  {
    id: 'translate_en',
    label: 'Translate to English',
    description: 'Translate the selection into English.',
    instruction:
      'Translate the selected text into English. Preserve meaning, tone, terminology, proper nouns, links, and Markdown structure. Return only the translation.',
    format: 'text',
    targetLanguage: 'en',
  },
  {
    id: 'custom',
    label: 'Custom instruction',
    description: 'Follow your prompt, including Markdown formatting requests.',
    instruction: null,
    format: 'markdown',
    targetLanguage: null,
  },
];

export function selectionActionById(actionId: SelectionActionId): SelectionAction {
  return (
    SELECTION_ACTIONS.find((candidate) => candidate.id === actionId) ??
    SELECTION_ACTIONS[SELECTION_ACTIONS.length - 1]
  );
}

export function resolveSelectionInstruction(
  actionId: SelectionActionId,
  customInstruction: string,
): string | null {
  const action = SELECTION_ACTIONS.find((candidate) => candidate.id === actionId);
  if (action?.instruction) return action.instruction;
  const trimmed = customInstruction.trim();
  return trimmed.length > 0 ? trimmed : null;
}
