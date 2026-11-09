import { describe, expect, it } from 'vitest';

import {
  resolveSelectionInstruction,
  SELECTION_ACTIONS,
} from './selectionActions';

describe('selection actions', () => {
  it('provides deterministic actions and custom instructions', () => {
    expect(SELECTION_ACTIONS.map((action) => action.id)).toEqual([
      'improve',
      'fix',
      'rewrite',
      'shorten',
      'expand',
      'make_list',
      'make_table',
      'translate_ko',
      'translate_en',
      'custom',
    ]);
    expect(resolveSelectionInstruction('custom', '  Keep the links  ')).toBe(
      'Keep the links',
    );
    expect(resolveSelectionInstruction('custom', '   ')).toBeNull();
    expect(resolveSelectionInstruction('make_table', '')).toContain(
      'Return exactly one valid GFM table',
    );
  });

  it('lets format and free-form actions restructure Markdown', () => {
    const formats = Object.fromEntries(
      SELECTION_ACTIONS.map((action) => [action.id, action.format]),
    );
    expect(formats).toMatchObject({
      improve: 'text',
      shorten: 'text',
      make_list: 'markdown',
      make_table: 'markdown',
      custom: 'markdown',
    });
    expect(resolveSelectionInstruction('make_list', '')).toContain('Markdown bullet list');
  });

  it('corrects spelling without translating and translates with an explicit target', () => {
    const fix = SELECTION_ACTIONS.find((action) => action.id === 'fix');
    const korean = SELECTION_ACTIONS.find((action) => action.id === 'translate_ko');
    const english = SELECTION_ACTIONS.find((action) => action.id === 'translate_en');

    expect(fix).toMatchObject({ format: 'text', targetLanguage: null });
    expect(fix?.instruction).toContain('Keep the meaning, wording, tone, language');
    expect(korean).toMatchObject({ format: 'text', targetLanguage: 'ko' });
    expect(english).toMatchObject({ format: 'text', targetLanguage: 'en' });
    expect(korean?.instruction).toContain('into Korean');
    expect(english?.instruction).toContain('into English');
  });
});
