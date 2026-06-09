import { invoke } from '@tauri-apps/api/core';
import type { ThemeKind } from './desktop';

export type CodeBlockTheme =
  | 'github-light'
  | 'github-dark'
  | 'one-light'
  | 'one-dark'
  | 'ayu-light'
  | 'ayu-dark'
  | 'flexoki-light'
  | 'flexoki-dark'
  | 'monokai-light'
  | 'monokai-dark';

type CodeBlockThemeFamily = 'github' | 'one' | 'ayu' | 'flexoki' | 'monokai';
type CodeBlockThemeTone = 'light' | 'dark';

const CODE_BLOCK_THEME_VARIANTS: Record<
  CodeBlockThemeFamily,
  Record<CodeBlockThemeTone, CodeBlockTheme>
> = {
  github: { light: 'github-light', dark: 'github-dark' },
  one: { light: 'one-light', dark: 'one-dark' },
  ayu: { light: 'ayu-light', dark: 'ayu-dark' },
  flexoki: { light: 'flexoki-light', dark: 'flexoki-dark' },
  monokai: { light: 'monokai-light', dark: 'monokai-dark' },
};

const CODE_BLOCK_THEME_METADATA: Record<
  CodeBlockTheme,
  { family: CodeBlockThemeFamily; tone: CodeBlockThemeTone }
> = Object.entries(CODE_BLOCK_THEME_VARIANTS).reduce(
  (metadata, [family, variants]) => {
    metadata[variants.light] = { family: family as CodeBlockThemeFamily, tone: 'light' };
    metadata[variants.dark] = { family: family as CodeBlockThemeFamily, tone: 'dark' };
    return metadata;
  },
  {} as Record<CodeBlockTheme, { family: CodeBlockThemeFamily; tone: CodeBlockThemeTone }>,
);

const LEGACY_CODE_BLOCK_THEME_ALIASES: Record<string, CodeBlockTheme> = {
  monokai: 'monokai-dark',
};

export const CODE_BLOCK_THEMES: ReadonlyArray<{ value: CodeBlockTheme; label: string }> = [
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'one-light', label: 'One Light' },
  { value: 'one-dark', label: 'One Dark' },
  { value: 'ayu-light', label: 'Ayu Light' },
  { value: 'ayu-dark', label: 'Ayu Dark' },
  { value: 'flexoki-light', label: 'Flexoki Light' },
  { value: 'flexoki-dark', label: 'Flexoki Dark' },
  { value: 'monokai-light', label: 'Monokai Light' },
  { value: 'monokai-dark', label: 'Monokai Dark' },
];

export interface Settings {
  autoSave: boolean;
  editorFontSize: number;
  editorLineHeight: number;
  editorFontFamily: string;
  editorLineWrap: boolean;
  /** Wrap column; 0 = wrap to window width (VS Code `wordWrap: "on"`). */
  editorWrapColumn: number;
  /** Show a vertical guide line at the wrap column (column mode only). */
  editorShowWrapLine: boolean;
  outlineFontSize: number;
  outlineRowSpacing: number;
  defaultMode: 'Editor' | 'Wysiwyg' | 'SplitView';
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  assetFolder: string;
  themeFollowSystem: boolean;
  pdfPaperSize: 'A4' | 'Letter';
  diagnosticsEnabled: boolean;
  showMinimap: boolean;
  tableDensity: 'compact' | 'normal';
  tableViewMode: 'normal' | 'inline';
  codeBlockHighlight: boolean;
  codeBlockTheme: CodeBlockTheme;
  codeBlockThemeSync: boolean;
  updateCheckEnabled: boolean;
  lastUpdateCheckAt: number | null;
  dismissedUpdateVersion: string | null;
}

export interface DiagnosticsLogStatus {
  enabled: boolean;
  logPath: string | null;
}

export interface CliLauncherInstallResult {
  shellConfigPath: string;
  aliasCommand: string;
  alreadyInstalled: boolean;
}

export interface CliBinaryStatus {
  installPath: string;
  targetExecutable: string;
  installed: boolean;
  inPath: boolean;
}

export interface CliBinaryActionResult {
  installPath: string;
  targetExecutable: string;
  alreadyDone: boolean;
}

export interface CtrlGLauncherStatus {
  shellConfigPath: string;
  /**
   * The two-line shell snippet (`export EDITOR="mdner"` / `export VISUAL="mdner"`)
   * the install would (or did) append. Surfaced so the Settings UI can render
   * the exact text and offer a Copy button for users who'd rather paste it
   * into a different rc file or a CLI tool's own config.
   */
  snippet: string;
  installed: boolean;
}

export interface CtrlGLauncherActionResult {
  shellConfigPath: string;
  alreadyDone: boolean;
}

export const CLI_BINARY_INSTALL_PATH = '/usr/local/bin/mdner';

export const CLI_ALIAS_COMMAND =
  'alias markdowner="/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop"';

export const DEFAULT_SETTINGS: Settings = {
  autoSave: false,
  editorFontSize: 14,
  editorLineHeight: 1.6,
  editorFontFamily: '',
  editorLineWrap: true,
  editorWrapColumn: 120,
  editorShowWrapLine: true,
  outlineFontSize: 12,
  outlineRowSpacing: 0,
  defaultMode: 'Wysiwyg',
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  assetFolder: 'assets',
  themeFollowSystem: true,
  pdfPaperSize: 'A4',
  diagnosticsEnabled: false,
  showMinimap: false,
  tableDensity: 'compact',
  tableViewMode: 'normal',
  codeBlockHighlight: true,
  codeBlockTheme: 'one-dark',
  codeBlockThemeSync: true,
  updateCheckEnabled: true,
  lastUpdateCheckAt: null,
  dismissedUpdateVersion: null,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;

export function getChangedSettingsKeys(
  current: Settings,
  next: Settings,
): Array<keyof Settings> {
  return SETTINGS_KEYS.filter((key) => !Object.is(current[key], next[key]));
}

export const EDITOR_FONT_SIZE_MIN = 8;
export const EDITOR_FONT_SIZE_MAX = 48;
// Line-height is stored as a unitless multiplier so it tracks with font-size:
// rendered line-height ends up at `fontSize * editorLineHeight`. ⌘+/⌘- can
// therefore stay font-size-only while the displayed leading still scales.
export const EDITOR_LINE_HEIGHT_MIN = 1.0;
export const EDITOR_LINE_HEIGHT_MAX = 2.5;
export const EDITOR_LINE_HEIGHT_STEP = 0.1;
export const OUTLINE_FONT_SIZE_MIN = 10;
export const OUTLINE_FONT_SIZE_MAX = 18;
export const OUTLINE_ROW_SPACING_MIN = 0;
export const OUTLINE_ROW_SPACING_MAX = 8;
export const EDITOR_WRAP_COLUMN_MIN = 40;
export const EDITOR_WRAP_COLUMN_MAX = 240;

export type EditorFontSizeAdjustmentKind = 'increase' | 'decrease';

export type EditorFontSizeAdjustment = {
  current: number;
  next: number;
};

export type OutlinePanelSizing = {
  outlineFontSize: number;
  outlineRowSpacing: number;
};

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Wrap column accepts 0 as a special "wrap to window width" value (VS Code's
 * `wordWrap: "on"`). Any positive value is clamped to [MIN, MAX]; a non-finite
 * value falls back to the default.
 */
export function normalizeWrapColumn(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.editorWrapColumn;
  const rounded = Math.round(parsed);
  if (rounded <= 0) return 0;
  return Math.min(EDITOR_WRAP_COLUMN_MAX, Math.max(EDITOR_WRAP_COLUMN_MIN, rounded));
}

export function normalizeEditorFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SETTINGS.editorFontSize;
  }
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value)),
  );
}

export function resolveEditorFontSizeAdjustment(
  value: unknown,
  kind: EditorFontSizeAdjustmentKind,
): EditorFontSizeAdjustment {
  const current = normalizeEditorFontSize(value);
  const delta = kind === 'increase' ? 1 : -1;
  return {
    current,
    next: Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, current + delta)),
  };
}

export function resolveOutlinePanelSizing(
  settings: Pick<Settings, 'outlineFontSize' | 'outlineRowSpacing'>,
): OutlinePanelSizing {
  return {
    outlineFontSize: normalizeBoundedInteger(
      settings.outlineFontSize,
      DEFAULT_SETTINGS.outlineFontSize,
      OUTLINE_FONT_SIZE_MIN,
      OUTLINE_FONT_SIZE_MAX,
    ),
    outlineRowSpacing: normalizeBoundedInteger(
      settings.outlineRowSpacing,
      DEFAULT_SETTINGS.outlineRowSpacing,
      OUTLINE_ROW_SPACING_MIN,
      OUTLINE_ROW_SPACING_MAX,
    ),
  };
}

function normalizeCodeBlockTheme(value: unknown): CodeBlockTheme {
  if (typeof value !== 'string') {
    return DEFAULT_SETTINGS.codeBlockTheme;
  }
  const aliased = LEGACY_CODE_BLOCK_THEME_ALIASES[value] ?? value;
  return CODE_BLOCK_THEMES.some((entry) => entry.value === aliased)
    ? (aliased as CodeBlockTheme)
    : DEFAULT_SETTINGS.codeBlockTheme;
}

export function codeBlockThemeForThemeKind(
  theme: CodeBlockTheme,
  themeKind: ThemeKind,
): CodeBlockTheme {
  if (themeKind === 'CustomCss') {
    return theme;
  }
  const metadata = CODE_BLOCK_THEME_METADATA[theme];
  const tone: CodeBlockThemeTone = themeKind === 'BuiltInLight' ? 'light' : 'dark';
  return CODE_BLOCK_THEME_VARIANTS[metadata.family][tone];
}

export function resolveCodeBlockTheme(settings: Settings, themeKind: ThemeKind): CodeBlockTheme {
  const normalizedTheme = normalizeCodeBlockTheme(settings.codeBlockTheme);
  return settings.codeBlockThemeSync
    ? codeBlockThemeForThemeKind(normalizedTheme, themeKind)
    : normalizedTheme;
}

function normalizeSettings(value: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  merged.editorFontSize = normalizeEditorFontSize(merged.editorFontSize);
  if (!Number.isFinite(merged.editorLineHeight) || merged.editorLineHeight <= 0) {
    merged.editorLineHeight = DEFAULT_SETTINGS.editorLineHeight;
  } else {
    // Round to one decimal place so the stored value matches the 0.1 step
    // shown in the UI (1.0, 1.1, 1.2, …) and a Cmd-driven adjustment never
    // accumulates floating-point drift.
    const clamped = Math.min(
      EDITOR_LINE_HEIGHT_MAX,
      Math.max(EDITOR_LINE_HEIGHT_MIN, merged.editorLineHeight),
    );
    merged.editorLineHeight = Math.round(clamped * 10) / 10;
  }
  Object.assign(merged, resolveOutlinePanelSizing(merged));
  if (typeof merged.editorLineWrap !== 'boolean') {
    merged.editorLineWrap = DEFAULT_SETTINGS.editorLineWrap;
  }
  merged.editorWrapColumn = normalizeWrapColumn(merged.editorWrapColumn);
  if (typeof merged.editorShowWrapLine !== 'boolean') {
    merged.editorShowWrapLine = DEFAULT_SETTINGS.editorShowWrapLine;
  }
  if (typeof merged.assetFolder !== 'string' || merged.assetFolder.trim().length === 0) {
    merged.assetFolder = DEFAULT_SETTINGS.assetFolder;
  } else {
    merged.assetFolder = merged.assetFolder.trim();
  }
  if (typeof merged.showMinimap !== 'boolean') {
    merged.showMinimap = DEFAULT_SETTINGS.showMinimap;
  }
  if (merged.tableDensity !== 'compact' && merged.tableDensity !== 'normal') {
    merged.tableDensity = DEFAULT_SETTINGS.tableDensity;
  }
  if (merged.tableViewMode !== 'normal' && merged.tableViewMode !== 'inline') {
    merged.tableViewMode = DEFAULT_SETTINGS.tableViewMode;
  }
  if (typeof merged.codeBlockHighlight !== 'boolean') {
    merged.codeBlockHighlight = DEFAULT_SETTINGS.codeBlockHighlight;
  }
  merged.codeBlockTheme = normalizeCodeBlockTheme(merged.codeBlockTheme);
  if (typeof merged.codeBlockThemeSync !== 'boolean') {
    merged.codeBlockThemeSync = DEFAULT_SETTINGS.codeBlockThemeSync;
  }
  if (typeof merged.updateCheckEnabled !== 'boolean') {
    merged.updateCheckEnabled = DEFAULT_SETTINGS.updateCheckEnabled;
  }
  if (
    typeof merged.lastUpdateCheckAt !== 'number' ||
    !Number.isFinite(merged.lastUpdateCheckAt)
  ) {
    merged.lastUpdateCheckAt = null;
  }
  if (
    typeof merged.dismissedUpdateVersion !== 'string' ||
    merged.dismissedUpdateVersion.length === 0
  ) {
    merged.dismissedUpdateVersion = null;
  }
  return merged;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const result = await invoke<Partial<Settings> | null | undefined>('load_settings');
    return normalizeSettings(result);
  } catch (error) {
    console.error('Failed to load settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await invoke('save_settings', { settings: normalizeSettings(settings) });
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

export async function installCliLauncher(): Promise<CliLauncherInstallResult> {
  try {
    return await invoke<CliLauncherInstallResult>('install_cli_launcher');
  } catch (error) {
    console.error('Failed to install CLI launcher:', error);
    throw error;
  }
}

export const DEFAULT_CLI_BINARY_STATUS: CliBinaryStatus = {
  installPath: CLI_BINARY_INSTALL_PATH,
  targetExecutable: '',
  installed: false,
  inPath: true,
};

/**
 * Returns the current CLI binary status from the Rust backend.
 * When the Tauri command is unavailable (tests, web preview) or returns a
 * non-object value, returns `null` so the caller can choose to leave their
 * default state intact rather than triggering a no-op re-render.
 */
export async function cliBinaryStatus(): Promise<CliBinaryStatus | null> {
  try {
    const result = await invoke<CliBinaryStatus | null | undefined>('cli_binary_status');
    if (!result || typeof result !== 'object') {
      return null;
    }
    return {
      installPath: typeof result.installPath === 'string' ? result.installPath : CLI_BINARY_INSTALL_PATH,
      targetExecutable: typeof result.targetExecutable === 'string' ? result.targetExecutable : '',
      installed: Boolean(result.installed),
      inPath: Boolean(result.inPath ?? true),
    };
  } catch (error) {
    console.error('Failed to read CLI binary status:', error);
    return null;
  }
}

export async function installCliBinary(): Promise<CliBinaryActionResult> {
  return invoke<CliBinaryActionResult>('install_cli_binary');
}

export async function uninstallCliBinary(): Promise<CliBinaryActionResult> {
  return invoke<CliBinaryActionResult>('uninstall_cli_binary');
}

/**
 * Reads whether the Ctrl+G shell launcher is currently installed in the user's
 * rc file. Returns null when the backend isn't reachable (tests, web preview)
 * so callers can keep their default UI state instead of false-flagging.
 */
export async function ctrlGLauncherStatus(): Promise<CtrlGLauncherStatus | null> {
  try {
    const result = await invoke<CtrlGLauncherStatus | null | undefined>(
      'ctrl_g_launcher_status',
    );
    if (!result || typeof result !== 'object') return null;
    return {
      shellConfigPath: typeof result.shellConfigPath === 'string' ? result.shellConfigPath : '',
      snippet: typeof result.snippet === 'string' ? result.snippet : '',
      installed: Boolean(result.installed),
    };
  } catch (error) {
    console.error('Failed to read Ctrl+G launcher status:', error);
    return null;
  }
}

export async function installCtrlGLauncher(): Promise<CtrlGLauncherActionResult> {
  return invoke<CtrlGLauncherActionResult>('install_ctrl_g_launcher');
}

export async function uninstallCtrlGLauncher(): Promise<CtrlGLauncherActionResult> {
  return invoke<CtrlGLauncherActionResult>('uninstall_ctrl_g_launcher');
}

export async function diagnosticsStatus(): Promise<DiagnosticsLogStatus> {
  try {
    const result = await invoke<Partial<DiagnosticsLogStatus> | null | undefined>(
      'diagnostics_status',
    );
    return {
      enabled: Boolean(result?.enabled),
      logPath: result?.logPath ?? null,
    };
  } catch (error) {
    console.error('Failed to read diagnostics status:', error);
    return { enabled: false, logPath: null };
  }
}

export async function recordDiagnosticsEvent(
  eventName: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await invoke('record_diagnostics_event', { eventName, payload });
  } catch (error) {
    console.error('Failed to record diagnostics event:', error);
  }
}
