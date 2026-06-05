import { describe, expect, it } from 'vitest';

import {
  CODE_BLOCK_THEMES,
  DEFAULT_SETTINGS,
  codeBlockThemeForThemeKind,
  getChangedSettingsKeys,
  normalizeEditorFontSize,
  resolveEditorFontSizeAdjustment,
  resolveOutlinePanelSizing,
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

describe('settings change tracking', () => {
  it('returns only keys whose values changed', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        autoSave: !DEFAULT_SETTINGS.autoSave,
        defaultMode: 'Editor',
      }),
    ).toEqual(['autoSave', 'defaultMode']);
  });

  it('uses Object.is semantics when comparing values', () => {
    const current = {
      ...DEFAULT_SETTINGS,
      editorFontSize: Number.NaN,
    };
    const next = {
      ...DEFAULT_SETTINGS,
      editorFontSize: Number.NaN,
    };

    expect(getChangedSettingsKeys(current, next)).toEqual([]);
  });
});

describe('settings numeric display helpers', () => {
  it('normalizes editor font size with the persisted settings bounds', () => {
    expect(normalizeEditorFontSize(Number.NaN)).toBe(DEFAULT_SETTINGS.editorFontSize);
    expect(normalizeEditorFontSize(4)).toBe(8);
    expect(normalizeEditorFontSize(52)).toBe(48);
    expect(normalizeEditorFontSize(15.6)).toBe(16);
  });

  it('resolves editor font size adjustments from a normalized current value', () => {
    expect(resolveEditorFontSizeAdjustment(48, 'increase')).toEqual({
      current: 48,
      next: 48,
    });
    expect(resolveEditorFontSizeAdjustment(Number.NaN, 'decrease')).toEqual({
      current: DEFAULT_SETTINGS.editorFontSize,
      next: DEFAULT_SETTINGS.editorFontSize - 1,
    });
  });

  it('resolves outline panel sizing with defaults and bounds', () => {
    expect(
      resolveOutlinePanelSizing({
        outlineFontSize: Number.NaN,
        outlineRowSpacing: 20,
      }),
    ).toEqual({
      outlineFontSize: DEFAULT_SETTINGS.outlineFontSize,
      outlineRowSpacing: 8,
    });
  });
});

describe('update-check settings defaults', () => {
  it('defaults update checking on with no prior timestamp or dismissal', () => {
    expect(DEFAULT_SETTINGS.updateCheckEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.lastUpdateCheckAt).toBeNull();
    expect(DEFAULT_SETTINGS.dismissedUpdateVersion).toBeNull();
  });
});
