import { invoke } from '@tauri-apps/api/core';

export type EditorMode = 'Wysiwyg' | 'Editor' | 'SplitView';
export type ThemeKind = 'BuiltInLight' | 'BuiltInDark' | 'CustomCss';

export interface ThemeSelection {
  kind: ThemeKind;
  stylesheet: string | null;
  stylesheetPath: string | null;
}

export interface AppSnapshot {
  rootDir: string | null;
  workspaceDocuments: string[];
  recentDocuments: string[];
  activeDocumentName: string | null;
  activeDocumentPath: string | null;
  activeDocumentSource: string | null;
  activeDocumentDirty: boolean;
  mode: EditorMode;
  theme: ThemeSelection;
  lastError: string | null;
}

export async function bootstrap() {
  return invoke<AppSnapshot>('bootstrap');
}

export async function newDocument() {
  return invoke<AppSnapshot>('new_document');
}

export async function openDocument(path: string) {
  return invoke<AppSnapshot>('open_document', { path });
}

export async function openWorkspace(path: string) {
  return invoke<AppSnapshot>('open_workspace', { path });
}

export async function openWorkspaceDocument(path: string) {
  return invoke<AppSnapshot>('open_workspace_document', { path });
}

export async function replaceActiveDocumentSource(source: string) {
  return invoke<AppSnapshot>('replace_active_document_source', { source });
}

export async function saveActiveDocument() {
  return invoke<AppSnapshot>('save_active_document');
}

export async function saveActiveDocumentAs(path: string) {
  return invoke<AppSnapshot>('save_active_document_as', { path });
}

export async function hasActiveDocumentExternalChanges() {
  return invoke<boolean>('has_active_document_external_changes');
}

export async function activeDocumentDiskSource() {
  return invoke<string>('active_document_disk_source');
}

export async function setMode(mode: EditorMode) {
  return invoke<AppSnapshot>('set_mode', { mode });
}

export async function setTheme(themeKind: ThemeKind) {
  return invoke<AppSnapshot>('set_theme', { themeKind });
}

export async function importTheme(path: string) {
  return invoke<AppSnapshot>('import_theme', { path });
}

export async function openDroppedPath(path: string) {
  return invoke<AppSnapshot>('open_dropped_path', { path });
}

export async function quitApp() {
  return invoke<void>('quit_app');
}
