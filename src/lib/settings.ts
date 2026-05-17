import { invoke } from '@tauri-apps/api/core';

export type CodeBlockTheme =
  | 'github-light'
  | 'github-dark'
  | 'one-dark'
  | 'ayu-dark'
  | 'flexoki-light'
  | 'flexoki-dark'
  | 'monokai';

export const CODE_BLOCK_THEMES: ReadonlyArray<{ value: CodeBlockTheme; label: string }> = [
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'one-dark', label: 'One Dark' },
  { value: 'ayu-dark', label: 'Ayu Dark' },
  { value: 'flexoki-light', label: 'Flexoki Light' },
  { value: 'flexoki-dark', label: 'Flexoki Dark' },
  { value: 'monokai', label: 'Monokai' },
];

export interface Settings {
  autoSave: boolean;
  editorFontSize: number;
  editorFontFamily: string;
  editorLineWrap: boolean;
  editorWrapColumn: number;
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
  codeBlockHighlight: boolean;
  codeBlockTheme: CodeBlockTheme;
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

export const CLI_BINARY_INSTALL_PATH = '/usr/local/bin/mdner';

export const CLI_ALIAS_COMMAND =
  'alias markdowner="/Applications/Markdowner.app/Contents/MacOS/markdowner-desktop"';

export const DEFAULT_SETTINGS: Settings = {
  autoSave: false,
  editorFontSize: 12,
  editorFontFamily: '',
  editorLineWrap: true,
  editorWrapColumn: 120,
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
  codeBlockHighlight: true,
  codeBlockTheme: 'github-light',
};

export const OUTLINE_FONT_SIZE_MIN = 10;
export const OUTLINE_FONT_SIZE_MAX = 18;
export const OUTLINE_ROW_SPACING_MIN = 0;
export const OUTLINE_ROW_SPACING_MAX = 8;
export const EDITOR_WRAP_COLUMN_MIN = 40;
export const EDITOR_WRAP_COLUMN_MAX = 240;

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

function normalizeSettings(value: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  if (!Number.isFinite(merged.editorFontSize) || merged.editorFontSize <= 0) {
    merged.editorFontSize = DEFAULT_SETTINGS.editorFontSize;
  }
  merged.outlineFontSize = normalizeBoundedInteger(
    merged.outlineFontSize,
    DEFAULT_SETTINGS.outlineFontSize,
    OUTLINE_FONT_SIZE_MIN,
    OUTLINE_FONT_SIZE_MAX,
  );
  merged.outlineRowSpacing = normalizeBoundedInteger(
    merged.outlineRowSpacing,
    DEFAULT_SETTINGS.outlineRowSpacing,
    OUTLINE_ROW_SPACING_MIN,
    OUTLINE_ROW_SPACING_MAX,
  );
  if (typeof merged.editorLineWrap !== 'boolean') {
    merged.editorLineWrap = DEFAULT_SETTINGS.editorLineWrap;
  }
  merged.editorWrapColumn = normalizeBoundedInteger(
    merged.editorWrapColumn,
    DEFAULT_SETTINGS.editorWrapColumn,
    EDITOR_WRAP_COLUMN_MIN,
    EDITOR_WRAP_COLUMN_MAX,
  );
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
  if (typeof merged.codeBlockHighlight !== 'boolean') {
    merged.codeBlockHighlight = DEFAULT_SETTINGS.codeBlockHighlight;
  }
  if (
    typeof merged.codeBlockTheme !== 'string' ||
    !CODE_BLOCK_THEMES.some((entry) => entry.value === merged.codeBlockTheme)
  ) {
    merged.codeBlockTheme = DEFAULT_SETTINGS.codeBlockTheme;
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
    await invoke('save_settings', { settings });
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
