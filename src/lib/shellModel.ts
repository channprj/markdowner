import type { EditorMode, ThemeKind } from './desktop';
import type { DocumentTab } from './documentTabs';
import { formatEditorMode, formatThemeLabel } from './shellDisplay';
import { displayFileName, displayWorkspacePath } from './workspaceTree';

export interface OpenEditorItem {
  id: string;
  name: string;
  path: string | null;
  isActive: boolean;
  isDirty: boolean;
  missing: boolean;
}

export interface TabStripItem {
  id: string;
  kind: DocumentTab['kind'];
  name: string;
  isDirty: boolean;
  missing: boolean;
  shortcutLabel: string | null;
}

type DirtyResolver = (tab: DocumentTab) => boolean;

export interface StatusBarModel {
  mode: string;
  theme: string;
  busy: boolean;
  isDirty: boolean | null;
  documentName: string | null;
  documentPath: string | null;
  workspaceName: string | null;
  activeDocumentLabel: string | null;
  cursorLine: number | null;
  cursorColumn: number | null;
  wordCount: number | null;
  characterCount: number | null;
  readingTimeMinutes: number | null;
}

export interface StatusBarModelInput {
  currentMode: EditorMode;
  themeKind: ThemeKind;
  busy: boolean;
  activeDocumentOpen: boolean;
  activeDocumentDirty: boolean;
  activeDocumentName: string | null;
  activeDocumentPath: string | null;
  rootDir: string | null;
  cursorPosition: {
    line: number;
    column: number;
  };
  documentStats: {
    words: number;
    characters: number;
    readingTimeMinutes: number;
  };
}

export function buildOpenEditorItems({
  tabs,
  activeTabId,
  isDirty,
}: {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  isDirty: DirtyResolver;
}): OpenEditorItem[] {
  return tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    path: tab.path,
    isActive: tab.id === activeTabId,
    isDirty: isDirty(tab),
    missing: tab.missing,
  }));
}

export function buildTabStripItems({
  tabs,
  isDirty,
}: {
  tabs: readonly DocumentTab[];
  isDirty: DirtyResolver;
}): TabStripItem[] {
  return tabs.map((tab, index) => ({
    id: tab.id,
    kind: tab.kind,
    name: tab.name,
    isDirty: isDirty(tab),
    missing: tab.missing,
    shortcutLabel: index < 9 ? `⌘${index + 1}` : index === 9 ? '⌘0' : null,
  }));
}

export function buildDocumentMeta({
  activeDocumentPath,
  rootDir,
  activeDocumentOpen,
}: {
  activeDocumentPath: string | null;
  rootDir: string | null;
  activeDocumentOpen: boolean;
}): string {
  if (activeDocumentPath) {
    return displayWorkspacePath(activeDocumentPath, rootDir);
  }
  if (activeDocumentOpen) {
    return 'Save As to choose where this draft lives.';
  }
  return 'Open a workspace or a Markdown file to begin.';
}

export function buildStatusBarModel({
  currentMode,
  themeKind,
  busy,
  activeDocumentOpen,
  activeDocumentDirty,
  activeDocumentName,
  activeDocumentPath,
  rootDir,
  cursorPosition,
  documentStats,
}: StatusBarModelInput): StatusBarModel {
  const showSourceCursor = currentMode !== 'Wysiwyg';

  return {
    mode: formatEditorMode(currentMode),
    theme: formatThemeLabel(themeKind),
    busy,
    isDirty: activeDocumentOpen ? activeDocumentDirty : null,
    documentName: activeDocumentName,
    documentPath: activeDocumentPath,
    workspaceName: rootDir ? displayFileName(rootDir) : null,
    activeDocumentLabel: activeDocumentPath
      ? displayWorkspacePath(activeDocumentPath, rootDir)
      : null,
    cursorLine: showSourceCursor ? cursorPosition.line : null,
    cursorColumn: showSourceCursor ? cursorPosition.column : null,
    wordCount: activeDocumentOpen ? documentStats.words : null,
    characterCount: activeDocumentOpen ? documentStats.characters : null,
    readingTimeMinutes: activeDocumentOpen ? documentStats.readingTimeMinutes : null,
  };
}
