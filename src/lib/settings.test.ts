import { describe, expect, it } from 'vitest';

import {
  CODE_BLOCK_THEMES,
  DEFAULT_SETTINGS,
  codeBlockThemeForThemeKind,
} from './settings';

describe('code block syntax highlighting settings', () => {
  it('defaults to One Dark with theme sync enabled', () => {
    expect(DEFAULT_SETTINGS.codeBlockTheme).toBe('one-dark');
    expect(DEFAULT_SETTINGS.codeBlockThemeSync).toBe(true);
  });

  it('offers both light and dark variants for every code block theme family', () => {
    const values = CODE_BLOCK_THEMES.map((theme) => theme.value);

    expect(values).toEqual([
      'github-light',
      'github-dark',
      'one-light',
      'one-dark',
      'ayu-light',
      'ayu-dark',
      'flexoki-light',
      'flexoki-dark',
      'monokai-light',
      'monokai-dark',
    ]);
  });

  it('resolves the matching variant when syncing with the app theme', () => {
    expect(codeBlockThemeForThemeKind('one-dark', 'BuiltInLight')).toBe('one-light');
    expect(codeBlockThemeForThemeKind('one-light', 'BuiltInDark')).toBe('one-dark');
    expect(codeBlockThemeForThemeKind('monokai-dark', 'BuiltInLight')).toBe('monokai-light');
    expect(codeBlockThemeForThemeKind('monokai-light', 'BuiltInDark')).toBe('monokai-dark');
    expect(codeBlockThemeForThemeKind('github-dark', 'CustomCss')).toBe('github-dark');
  });
});
