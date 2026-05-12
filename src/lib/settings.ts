import { invoke } from '@tauri-apps/api/core';

export interface Settings {
  autoSave: boolean;
  editorFontSize: number;
  editorFontFamily: string;
  editorLineWrap: boolean;
  outlineFontSize: number;
  outlineRowSpacing: number;
  defaultMode: 'Editor' | 'Wysiwyg' | 'SplitView';
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  assetFolder: string;
  themeFollowSystem: boolean;
  pdfPaperSize: 'A4' | 'Letter';
  diagnosticsEnabled: boolean;
}

export interface DiagnosticsLogStatus {
  enabled: boolean;
  logPath: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  autoSave: false,
  editorFontSize: 14,
  editorFontFamily: '',
  editorLineWrap: true,
  outlineFontSize: 13,
  outlineRowSpacing: 2,
  defaultMode: 'Wysiwyg',
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  assetFolder: 'assets',
  themeFollowSystem: true,
  pdfPaperSize: 'A4',
  diagnosticsEnabled: false,
};

export const OUTLINE_FONT_SIZE_MIN = 10;
export const OUTLINE_FONT_SIZE_MAX = 18;
export const OUTLINE_ROW_SPACING_MIN = 0;
export const OUTLINE_ROW_SPACING_MAX = 8;

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
  if (typeof merged.assetFolder !== 'string' || merged.assetFolder.trim().length === 0) {
    merged.assetFolder = DEFAULT_SETTINGS.assetFolder;
  } else {
    merged.assetFolder = merged.assetFolder.trim();
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
