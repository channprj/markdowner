import { Channel, invoke } from '@tauri-apps/api/core';

import type {
  AiKeyMetadata,
  AiKeyStatus,
  AiActiveRun,
  AiHistoryDetail,
  AiHistoryPage,
  AiInterviewContinueRequest,
  AiInterviewSession,
  AiInterviewStartRequest,
  AiModel,
  AiModelPricing,
  AiRunRequest,
  AiRunResult,
  AiStreamEvent,
} from '@/features/ai/types';
import type {
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentStatus,
  LocalAgentStreamEvent,
} from '@/features/ai/localAgents/types';
import {
  normalizeDraftBackupEntries,
  type DraftBackupEntry,
} from './draftBackups';
import type {
  ImageExportFormat,
  ImageExportLayout,
  ImageExportScale,
} from './imageExport';
import type { LocalAgentExecutablePaths } from './settings';

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
  /** Last disk-synced source for a dirty document, when supplied by desktop. */
  activeDocumentSyncedSource?: string | null;
  activeDocumentDirty: boolean;
  mode: EditorMode;
  theme: ThemeSelection;
  lastError: string | null;
}

export const TERMINAL_OUTPUT_EVENT = 'markdowner://terminal-output';
export const TERMINAL_EXIT_EVENT = 'markdowner://terminal-exit';
export const AI_ACTIVITY_CHANGED_EVENT = 'markdowner://ai-activity-changed';
export const AI_HISTORY_CHANGED_EVENT = 'markdowner://ai-history-changed';

export interface TerminalSession {
  id: number;
}

export interface TerminalOutputEvent {
  id: number;
  data: string;
}

export interface TerminalExitEvent {
  id: number;
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

export type ReloadActiveDocumentFromDiskRequest = {
  path: string;
  expectedSource: string;
  expectedDirty: boolean;
};

export async function reloadActiveDocumentFromDisk({
  path,
  expectedSource,
  expectedDirty,
}: ReloadActiveDocumentFromDiskRequest) {
  return invoke<AppSnapshot>('reload_active_document_from_disk', {
    path,
    expectedSource,
    expectedDirty,
  });
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

export interface TextExportFile {
  path: string;
  contents: string;
}

export async function exportTextFiles(files: readonly TextExportFile[]): Promise<void> {
  await invoke<void>('write_export_files', { files });
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

export interface PdfExportFile {
  path: string;
  html: string;
  paperWidthMm: number;
  paperHeightMm: number;
}

export async function exportPdfFile(
  path: string,
  html: string,
  paperWidthMm: number,
  paperHeightMm: number,
): Promise<void> {
  await invoke<void>('write_pdf_file', {
    path,
    html,
    paperWidthMm,
    paperHeightMm,
  });
}

export async function exportPdfFiles(files: readonly PdfExportFile[]): Promise<void> {
  await invoke<void>('write_pdf_files', { files });
}

export interface ImageExportRequest {
  path: string;
  html: string;
  format: ImageExportFormat;
  layout: ImageExportLayout;
  scale: ImageExportScale;
  quality: number;
  paperWidthMm: number;
  paperHeightMm: number;
  backgroundColor: string;
}

export interface ImageExportResult {
  paths: string[];
  width: number;
  height: number;
  pageCount: number;
}

export async function exportImageFile(
  request: ImageExportRequest,
): Promise<ImageExportResult> {
  return invoke<ImageExportResult>('write_image_file', { request });
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

export async function startTerminal(input: {
  cwd: string | null;
  cols: number;
  rows: number;
}): Promise<TerminalSession> {
  return invoke<TerminalSession>('terminal_start', input);
}

export async function writeTerminal(id: number, data: string): Promise<void> {
  await invoke<void>('terminal_write', { id, data });
}

export async function resizeTerminal(id: number, cols: number, rows: number): Promise<void> {
  await invoke<void>('terminal_resize', { id, cols, rows });
}

export async function closeTerminal(id: number): Promise<void> {
  await invoke<void>('terminal_close', { id });
}

export async function aiKeyStatus(): Promise<AiKeyStatus> {
  return invoke<AiKeyStatus>('ai_key_status');
}

export async function aiSaveKey(apiKey: string): Promise<AiKeyStatus> {
  return invoke<AiKeyStatus>('ai_save_key', { apiKey });
}

export async function aiVerifyKey(): Promise<AiKeyMetadata> {
  return invoke<AiKeyMetadata>('ai_verify_key');
}

export async function aiDeleteKey(): Promise<AiKeyStatus> {
  return invoke<AiKeyStatus>('ai_delete_key');
}

export async function aiListModels(): Promise<AiModel[]> {
  return invoke<AiModel[]>('ai_list_models');
}

export async function aiModelPricing(
  modelId: string,
  zdrOnly: boolean,
): Promise<AiModelPricing> {
  return invoke<AiModelPricing>('ai_model_pricing', { modelId, zdrOnly });
}

export async function aiRun(
  request: AiRunRequest,
  onEvent: (event: AiStreamEvent) => void,
): Promise<AiRunResult> {
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<AiRunResult>('ai_run', { request, onEvent: channel });
}

export async function aiCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>('ai_cancel', { requestId });
}

export async function localAgentStatuses(
  executablePaths: LocalAgentExecutablePaths,
  options: { forceRefresh?: boolean } = {},
): Promise<LocalAgentStatus[]> {
  const cacheKey = JSON.stringify(executablePaths);
  if (!options.forceRefresh) {
    if (
      localAgentStatusCache?.key === cacheKey &&
      Date.now() - localAgentStatusCache.loadedAt < LOCAL_AGENT_STATUS_CACHE_TTL_MS
    ) {
      return localAgentStatusCache.statuses;
    }
    if (localAgentStatusRequest?.key === cacheKey) {
      return localAgentStatusRequest.promise;
    }
  } else if (localAgentStatusRequest?.key === cacheKey) {
    return localAgentStatusRequest.promise;
  }

  const promise = invoke<LocalAgentStatus[]>('local_agent_statuses', {
    executablePaths,
  })
    .then((statuses) => {
      if (Array.isArray(statuses)) {
        localAgentStatusCache = {
          key: cacheKey,
          loadedAt: Date.now(),
          statuses,
        };
      }
      return statuses;
    })
    .finally(() => {
      if (localAgentStatusRequest?.promise === promise) {
        localAgentStatusRequest = null;
      }
    });
  localAgentStatusRequest = { key: cacheKey, promise };
  return promise;
}

const LOCAL_AGENT_STATUS_CACHE_TTL_MS = 60_000;
let localAgentStatusCache: {
  key: string;
  loadedAt: number;
  statuses: LocalAgentStatus[];
} | null = null;
let localAgentStatusRequest: {
  key: string;
  promise: Promise<LocalAgentStatus[]>;
} | null = null;

export async function localAgentRun(
  request: LocalAgentRunRequest,
  onEvent: (event: LocalAgentStreamEvent) => void,
): Promise<LocalAgentRunResult> {
  const channel = new Channel<LocalAgentStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<LocalAgentRunResult>('local_agent_run', { request, onEvent: channel });
}

export async function localAgentCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>('local_agent_cancel', { requestId });
}

export async function aiListActive(): Promise<AiActiveRun[]> {
  return invoke<AiActiveRun[]>('ai_list_active');
}

export async function aiHistoryPage(page: number, pageSize = 20): Promise<AiHistoryPage> {
  return invoke<AiHistoryPage>('ai_history_page', { page, pageSize });
}

export async function aiHistoryDetail(requestId: string): Promise<AiHistoryDetail | null> {
  return invoke<AiHistoryDetail | null>('ai_history_detail', { requestId });
}

export async function aiHistoryDelete(requestId: string): Promise<boolean> {
  return invoke<boolean>('ai_history_delete', { requestId });
}

export async function aiHistoryClear(): Promise<number> {
  return invoke<number>('ai_history_clear');
}

export async function aiInterviewStart(
  request: AiInterviewStartRequest,
): Promise<AiInterviewSession> {
  return invoke<AiInterviewSession>('ai_interview_start', { request });
}

export async function aiInterviewAnswer(
  request: AiInterviewContinueRequest,
): Promise<AiInterviewSession> {
  return invoke<AiInterviewSession>('ai_interview_answer', { request });
}

export async function aiInterviewSkip(
  request: AiInterviewContinueRequest,
): Promise<AiInterviewSession> {
  return invoke<AiInterviewSession>('ai_interview_skip', { request });
}

export async function aiInterviewUpdateAnswer(
  requestId: string,
  position: number,
  answer: string,
): Promise<AiInterviewSession> {
  return invoke<AiInterviewSession>('ai_interview_update_answer', {
    request: { requestId, position, answer },
  });
}

export async function aiInterviewFinish(
  requestId: string,
  answer: string | null,
): Promise<AiInterviewSession> {
  return invoke<AiInterviewSession>('ai_interview_finish', {
    request: { requestId, answer },
  });
}

export async function aiInterviewResume(
  requestId: string,
): Promise<AiInterviewSession | null> {
  return invoke<AiInterviewSession | null>('ai_interview_resume', { requestId });
}

export async function aiRenderSelectedOperations(
  requestId: string,
  operationIds: string[],
): Promise<string> {
  return invoke<string>('ai_render_selected_operations', {
    requestId,
    operationIds,
  });
}

export async function aiDiscardResult(requestId: string): Promise<void> {
  await invoke<void>('ai_discard_result', { requestId });
}
