import { invoke } from '@tauri-apps/api/core';

import {
  normalizeDraftBackupEntries,
  type DraftBackupEntry,
} from './draftBackups';

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

export async function newWindow() {
  return invoke<void>('new_window');
}

export async function openDocument(path: string) {
  // Defense-in-depth: a nullish path means a caller (e.g. a link resolved to
  // a markdown target whose `absolutePath` was missing) lost the path before
  // reaching here. Surface a clear, actionable error instead of Tauri's
  // cryptic "command open_document missing required key path".
  if (path == null || path === '') {
    throw new Error(
      `Cannot open document: no file path was provided (received ${JSON.stringify(path)}).`,
    );
  }
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

/**
 * Copy a picked image into the active document's asset folder (the
 * `assetFolder` setting, default "assets"). Resolves to the doc-relative
 * path to embed in markdown; rejects when the document is unsaved.
 */
export async function importImageAsset(sourcePath: string) {
  return invoke<string>('import_image_asset', { sourcePath });
}

/**
 * Release every `mdner --wait` CLI process blocked on this document — the
 * user closed its tab, so the spawning terminal flow (Ctrl+G editors, git
 * commit, …) resumes.
 */
export async function completeCliWait(path: string) {
  return invoke<void>('complete_cli_wait', { path });
}

export async function quitApp() {
  return invoke<void>('quit_app');
}

/**
 * Write exported document text (e.g. HTML) to a path the user picked via the
 * save dialog. Distinct from the document-save commands: it never touches the
 * active-document state.
 */
export async function exportTextFile(path: string, contents: string): Promise<void> {
  await invoke<void>('write_export_file', { path, contents });
}

export interface ReadTextFileResult {
  path: string;
  contents: string;
}

export async function readTextFiles(paths: readonly string[]): Promise<ReadTextFileResult[]> {
  return invoke<ReadTextFileResult[]>('read_text_files', { paths });
}

export interface EmbeddedImageResult {
  /** The source passed in — an absolute local path or an http(s) URL. */
  source: string;
  /** `data:` URI for the image bytes, or `null` if it could not be read. */
  dataUri: string | null;
}

/**
 * Read the given local files / fetch the given remote URLs and return each as a
 * base64 `data:` URI, so exported documents can embed images self-contained.
 */
export async function readImagesBase64(
  sources: readonly string[],
): Promise<EmbeddedImageResult[]> {
  return invoke<EmbeddedImageResult[]>('read_images_base64', { sources });
}

export type PdfPaperSize = 'A4' | 'Letter';

export interface PdfExportFile {
  path: string;
  html: string;
  paperSize: PdfPaperSize;
}

export async function exportPdfFile(
  path: string,
  html: string,
  paperSize: PdfPaperSize,
): Promise<void> {
  await invoke<void>('write_pdf_file', { path, html, paperSize });
}

export async function exportPdfFiles(files: readonly PdfExportFile[]): Promise<void> {
  await invoke<void>('write_pdf_files', { files });
}

/**
 * Outcome of asking the Rust shell to classify a markdown link's href.
 * Mirrors the `ResolvedLink` enum in `src-tauri/src/link_actions.rs`.
 */
export type ResolvedLink =
  | { kind: 'markdown'; absolutePath: string }
  | { kind: 'file'; absolutePath: string }
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; fragment: string }
  | { kind: 'unresolved'; reason: string };

export async function resolveMarkdownLink(
  href: string,
  basePath: string | null,
): Promise<ResolvedLink> {
  return invoke<ResolvedLink>('resolve_markdown_link', {
    href,
    basePath,
  });
}

export async function openExternalUrl(href: string): Promise<void> {
  return invoke<void>('open_external_url', { href });
}

export async function openExternalUrlInNewWindow(href: string): Promise<void> {
  return invoke<void>('open_external_url_in_new_window', { href });
}

export async function openPathInDefaultApp(path: string): Promise<void> {
  return invoke<void>('open_path_in_default_app', { path });
}

export async function revealPathInFinder(path: string): Promise<void> {
  return invoke<void>('reveal_path_in_finder', { path });
}

export interface WorkspaceSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface WorkspaceSearchMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
  absoluteOffset: number;
}

export interface WorkspaceSearchFile {
  path: string;
  matches: WorkspaceSearchMatch[];
}

export interface WorkspaceSearchResult {
  files: WorkspaceSearchFile[];
}

export async function searchWorkspace(
  query: string,
  options: WorkspaceSearchOptions,
  paths: string[],
): Promise<WorkspaceSearchResult> {
  return invoke<WorkspaceSearchResult>('search_workspace', {
    query,
    options,
    paths,
  });
}

export interface PersistedCursorPosition {
  line: number;
  column: number;
}

export interface OpenTabsPayload {
  openTabs: string[];
  activeTabPath: string | null;
  /**
   * Remembered caret per file path. Stored alongside the open-tabs list so the
   * frontend can restore the caret at app launch and on tab switches without
   * a second round trip. Absent for paths that have never been edited.
   */
  cursorPositions: Record<string, PersistedCursorPosition>;
}

function normalizeCursorPositions(
  value: unknown,
): Record<string, PersistedCursorPosition> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, PersistedCursorPosition> = {};
  for (const [path, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as { line?: unknown; column?: unknown };
    const line = Number(candidate.line);
    const column = Number(candidate.column);
    if (!Number.isFinite(line) || !Number.isFinite(column)) continue;
    out[path] = {
      line: Math.max(1, Math.round(line)),
      column: Math.max(1, Math.round(column)),
    };
  }
  return out;
}

export async function loadOpenTabs(): Promise<OpenTabsPayload> {
  const result = await invoke<{
    openTabs?: string[];
    activeTabPath?: string | null;
    cursorPositions?: Record<string, PersistedCursorPosition>;
  }>('load_open_tabs');
  return {
    openTabs: result.openTabs ?? [],
    activeTabPath: result.activeTabPath ?? null,
    cursorPositions: normalizeCursorPositions(result.cursorPositions),
  };
}

export async function saveOpenTabs(payload: OpenTabsPayload): Promise<void> {
  await invoke('save_open_tabs', {
    openTabs: payload.openTabs,
    activeTabPath: payload.activeTabPath,
    cursorPositions: payload.cursorPositions,
  });
}

export async function loadDraftBackups(): Promise<DraftBackupEntry[]> {
  const result = await invoke<unknown>('load_draft_backups');
  return normalizeDraftBackupEntries(result);
}

export async function saveDraftBackups(entries: DraftBackupEntry[]): Promise<void> {
  await invoke('save_draft_backups', { entries });
}
