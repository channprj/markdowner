import { invoke } from '@tauri-apps/api/core';

export interface Settings {
  autoSave: boolean;
  editorFontSize: number;
  editorFontFamily: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoSave: false,
  editorFontSize: 14,
  editorFontFamily: '',
};

function normalizeSettings(value: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  if (!Number.isFinite(merged.editorFontSize) || merged.editorFontSize <= 0) {
    merged.editorFontSize = DEFAULT_SETTINGS.editorFontSize;
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
