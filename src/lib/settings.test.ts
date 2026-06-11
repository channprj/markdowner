import { describe, expect, it } from 'vitest';

import {
  CODE_BLOCK_THEMES,
  DEFAULT_SETTINGS,
  EDITOR_WRAP_COLUMN_MAX,
  EDITOR_WRAP_COLUMN_MIN,
  codeBlockThemeForThemeKind,
  getChangedSettingsKeys,
  normalizeEditorFontSize,
  normalizeWrapColumn,
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

describe('table view defaults', () => {
  it('defaults to the normal (text-wrapping) table layout', () => {
    expect(DEFAULT_SETTINGS.tableViewMode).toBe('normal');
  });

  it('tracks table view mode as a change', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        tableViewMode: 'inline',
      }),
    ).toEqual(['tableViewMode']);
  });
});

describe('minimap defaults', () => {
  it('shows the minimap by default', () => {
    expect(DEFAULT_SETTINGS.showMinimap).toBe(true);
  });
});

describe('diagnostics logging defaults', () => {
  it('enables diagnostics logging by default', () => {
    expect(DEFAULT_SETTINGS.diagnosticsEnabled).toBe(true);
  });
});

describe('default app prompt defaults', () => {
  it('starts unseen so the first launch asks once', () => {
    expect(DEFAULT_SETTINGS.defaultAppPromptSeen).toBe(false);
  });
});

describe('word wrap column + wrap line', () => {
  it('defaults to a 120-column cap with the wrap line on', () => {
    expect(DEFAULT_SETTINGS.editorWrapColumn).toBe(120);
    expect(DEFAULT_SETTINGS.editorShowWrapLine).toBe(true);
  });

  it('treats 0 as the special "wrap to window" value', () => {
    expect(normalizeWrapColumn(0)).toBe(0);
  });

  it('coerces negative or non-finite columns to 0 / the default', () => {
    expect(normalizeWrapColumn(-10)).toBe(0);
    expect(normalizeWrapColumn(Number.NaN)).toBe(DEFAULT_SETTINGS.editorWrapColumn);
    expect(normalizeWrapColumn('nope')).toBe(DEFAULT_SETTINGS.editorWrapColumn);
  });

  it('clamps positive columns into [MIN, MAX]', () => {
    expect(normalizeWrapColumn(10)).toBe(EDITOR_WRAP_COLUMN_MIN);
    expect(normalizeWrapColumn(1000)).toBe(EDITOR_WRAP_COLUMN_MAX);
    expect(normalizeWrapColumn(100)).toBe(100);
  });

  it('rounds fractional columns', () => {
    expect(normalizeWrapColumn(99.6)).toBe(100);
  });

  it('tracks the wrap line toggle as a change', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        editorShowWrapLine: false,
      }),
    ).toEqual(['editorShowWrapLine']);
  });
});
