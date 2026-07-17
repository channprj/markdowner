import { describe, expect, it, vi } from 'vitest';

import {
  CODE_BLOCK_THEMES,
  DEFAULT_IGNORE_LIST,
  DEFAULT_SETTINGS,
  EDITOR_WRAP_COLUMN_MAX,
  EDITOR_WRAP_COLUMN_MIN,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  codeBlockThemeForThemeKind,
  getChangedSettingsKeys,
  loadSettings,
  normalizeEditorFontSize,
  normalizeTerminalFontSize,
  normalizeWrapColumn,
  resolveEditorFontSizeAdjustment,
  resolveOutlinePanelSizing,
  saveSettings,
} from './settings';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

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

describe('PDF paper settings', () => {
  it('migrates legacy PDF paper settings and rejects malformed values', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ pdfPaperSize: 'Letter' });
    await expect(loadSettings()).resolves.toMatchObject({
      pdfPaperSize: 'Letter',
      pdfPaperOrientation: 'portrait',
      pdfPaperWidthMm: 210,
      pdfPaperHeightMm: 297,
    });

    invokeMock.mockResolvedValue({
      pdfPaperSize: 'Legal',
      pdfPaperOrientation: 'sideways',
      pdfPaperWidthMm: Number.NaN,
    });
    await expect(loadSettings()).resolves.toMatchObject({
      pdfPaperSize: 'A4',
      pdfPaperOrientation: 'portrait',
      pdfPaperWidthMm: 210,
      pdfPaperHeightMm: 297,
    });
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

describe('terminal settings', () => {
  it('defaults terminal appearance and cwd preferences', () => {
    expect(DEFAULT_SETTINGS.terminalFontFamily).toBe('');
    expect(DEFAULT_SETTINGS.terminalFontSize).toBe(13);
    expect(DEFAULT_SETTINGS.terminalDefaultPath).toBe('');
    expect(DEFAULT_SETTINGS.terminalStartLocation).toBe('document');
  });

  it('normalizes terminal font size with persisted bounds', () => {
    expect(normalizeTerminalFontSize(Number.NaN)).toBe(DEFAULT_SETTINGS.terminalFontSize);
    expect(normalizeTerminalFontSize(4)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(normalizeTerminalFontSize(72)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(normalizeTerminalFontSize(14.6)).toBe(15);
  });

  it('trims persisted terminal fields and falls back on malformed values', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      terminalFontFamily: '  JetBrains Mono  ',
      terminalFontSize: 'large',
      terminalDefaultPath: '  /Volumes/990EVO+/workspace/chann  ',
      terminalStartLocation: 'workspace',
    });

    const settings = await loadSettings();

    expect(settings.terminalFontFamily).toBe('JetBrains Mono');
    expect(settings.terminalFontSize).toBe(DEFAULT_SETTINGS.terminalFontSize);
    expect(settings.terminalDefaultPath).toBe('/Volumes/990EVO+/workspace/chann');
    expect(settings.terminalStartLocation).toBe('workspace');
  });

  it('falls back to document-first terminal start location for malformed persisted values', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      terminalStartLocation: 'recent-folder',
    });

    const settings = await loadSettings();

    expect(settings.terminalStartLocation).toBe('document');
  });

  it('tracks terminal preference edits as changed settings', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        terminalFontSize: DEFAULT_SETTINGS.terminalFontSize + 1,
        terminalDefaultPath: '/tmp/project',
        terminalStartLocation: 'workspace',
      }),
    ).toEqual(['terminalFontSize', 'terminalDefaultPath', 'terminalStartLocation']);
  });
});

describe('focus and typewriter mode defaults', () => {
  it('keeps focus and typewriter mode off when persisted settings are missing or malformed', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      focusModeEnabled: 'true',
      typewriterModeEnabled: 1,
    });

    const settings = await loadSettings();

    expect(settings.focusModeEnabled).toBe(false);
    expect(settings.typewriterModeEnabled).toBe(false);
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

describe('ignore list', () => {
  it('defaults to the recommended folder names', () => {
    expect(DEFAULT_SETTINGS.ignoreList).toEqual([...DEFAULT_IGNORE_LIST]);
    expect(DEFAULT_SETTINGS.ignoreList).toContain('node_modules');
    expect(DEFAULT_SETTINGS.ignoreList).toContain('.venv');
    expect(DEFAULT_SETTINGS.ignoreList).not.toContain('.git');
  });

  it('falls back to defaults when persisted settings omit the list', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ autoSave: true });

    const settings = await loadSettings();

    expect(settings.ignoreList).toEqual([...DEFAULT_IGNORE_LIST]);
  });

  it('trims, drops blanks, and dedupes persisted entries while preserving order', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      ignoreList: ['  .claude  ', '', '   ', '.diffs', '.claude', 'node_modules'],
    });

    const settings = await loadSettings();

    expect(settings.ignoreList).toEqual(['.claude', '.diffs', 'node_modules']);
  });

  it('preserves an explicit empty list (ignore nothing but .git)', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ ignoreList: [] });

    const settings = await loadSettings();

    expect(settings.ignoreList).toEqual([]);
  });

  it('falls back to defaults when the persisted value is not an array', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ ignoreList: 'node_modules' });

    const settings = await loadSettings();

    expect(settings.ignoreList).toEqual([...DEFAULT_IGNORE_LIST]);
  });

  it('tracks ignore-list edits as a change', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        ignoreList: [...DEFAULT_SETTINGS.ignoreList, '.claude'],
      }),
    ).toEqual(['ignoreList']);
  });
});

describe('word wrap column + wrap line', () => {
  it('defaults to a 120-column cap with the wrap line on', () => {
    expect(DEFAULT_SETTINGS.editorWrapColumn).toBe(120);
    expect(DEFAULT_SETTINGS.editorShowWrapLine).toBe(true);
    expect(DEFAULT_SETTINGS.editorWordBreakKeepAll).toBe(true);
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

  it('keeps word-break keep-all enabled when persisted settings are missing or malformed', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      editorWordBreakKeepAll: 'false',
    });

    const settings = await loadSettings();

    expect(settings.editorWordBreakKeepAll).toBe(true);
  });

  it('tracks the word-break keep-all toggle as a change', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        editorWordBreakKeepAll: false,
      }),
    ).toEqual(['editorWordBreakKeepAll']);
  });
});

describe('WYSIWYG code block wrap setting', () => {
  it('defaults to off', () => {
    expect(DEFAULT_SETTINGS.wysiwygCodeBlockWrap).toBe(false);
  });

  it('normalizes malformed values before saving and preserves booleans', async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce({ wysiwygCodeBlockWrap: 'true' });
    const malformed = await loadSettings();
    expect(malformed.wysiwygCodeBlockWrap).toBe(false);

    invokeMock.mockResolvedValueOnce(undefined);
    await saveSettings(malformed);
    expect(invokeMock).toHaveBeenLastCalledWith('save_settings', {
      settings: expect.objectContaining({ wysiwygCodeBlockWrap: false }),
    });

    invokeMock.mockResolvedValueOnce({ wysiwygCodeBlockWrap: true });
    expect((await loadSettings()).wysiwygCodeBlockWrap).toBe(true);
  });

  it('tracks the preference as a changed setting', () => {
    expect(
      getChangedSettingsKeys(DEFAULT_SETTINGS, {
        ...DEFAULT_SETTINGS,
        wysiwygCodeBlockWrap: true,
      }),
    ).toEqual(['wysiwygCodeBlockWrap']);
  });
});
