import { describe, expect, it } from 'vitest';

import {
  resolveSelectionInstruction,
  SELECTION_ACTIONS,
} from './selectionActions';

describe('selection actions', () => {
  it('provides deterministic actions and custom instructions', () => {
    expect(SELECTION_ACTIONS.map((action) => action.id)).toEqual([
      'improve',
      'rewrite',
      'shorten',
      'expand',
      'make_list',
      'make_table',
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
});
