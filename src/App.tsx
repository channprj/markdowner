import { markdown } from '@codemirror/lang-markdown';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  message,
  open as openDialog,
  save as saveDialog,
} from '@tauri-apps/plugin-dialog';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { createCodeBlockExtension } from '@/components/wysiwyg/codeBlockExtension';
import { PreventTableHoverSelection } from '@/components/wysiwyg/preventTableHoverSelection';
import { SourceEditorView } from '@/components/SourceEditorView';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { ChevronDown, ChevronRight, FileText, FolderOpen } from 'lucide-react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  UIEvent as ReactUIEvent,
} from 'react';
import {
  createElement,
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SelectionToolbar } from '@/components/wysiwyg/SelectionToolbar';
import { SlashCommandMenu } from '@/components/wysiwyg/SlashCommandMenu';
import { TableToolbar } from '@/components/wysiwyg/TableToolbar';
import { cn } from '@/lib/utils';
import { ActivityBar } from '@/shell/ActivityBar';
import { AppMenu } from '@/shell/AppMenu';
import { CommandPalette, type CommandPaletteCommand } from '@/shell/CommandPalette';
import { DocumentStatsDialog } from '@/shell/DocumentStatsDialog';
import { EditorArea } from '@/shell/EditorArea';
import { FindReplaceBar } from '@/shell/FindReplaceBar';
import { ShortcutsDialog } from '@/shell/ShortcutsDialog';
import { Tabs } from '@/shell/Tabs';
import { QuickOpen, type QuickOpenItem } from '@/shell/QuickOpen';
import {
  SideBar,
  type OutlineItem,
  type SearchResultFile,
  type SearchResultMatch,
  type SideBarPanel,
} from '@/shell/SideBar';
import { StatusBar } from '@/shell/StatusBar';
import { SettingsPanel } from '@/shell/SettingsPanel';

import {
  type AppSnapshot,
  type EditorMode,
  type ThemeKind,
  bootstrap,
  hasActiveDocumentExternalChanges,
  activeDocumentDiskSource,
  importTheme,
  newDocument,
  openDocument,
  openWorkspace,
  openWorkspaceDocument,
  replaceActiveDocumentSource,
  saveActiveDocument,
  saveActiveDocumentAs,
  setMode,
  setTheme,
  openDroppedPath,
  quitApp,
  loadOpenTabs,
  saveOpenTabs,
  searchWorkspace,
} from './lib/desktop';
import {
  findTextMatches,
  replaceAllMatches,
  replaceSingleMatch,
  type FindReplaceOptions,
} from './lib/findReplace';
import { nextCursorPositionFromStatistics } from './lib/cursorPosition';
import { wysiwygCursorSourceLine, wysiwygPositionAtSourceLine } from './lib/modeCursor';
import {
  DEFAULT_SETTINGS,
  OUTLINE_FONT_SIZE_MAX,
  OUTLINE_FONT_SIZE_MIN,
  OUTLINE_ROW_SPACING_MAX,
  OUTLINE_ROW_SPACING_MIN,
  type Settings,
  installCliLauncher,
  loadSettings,
  recordDiagnosticsEvent,
  saveSettings,
} from './lib/settings';
import { moveTab } from './lib/tabs';
import {
  MARKDOWN_CONTENT_SCOPE_CLASS,
  scopeImportedStylesheet,
} from './lib/themeScope';
import {
  findWysiwygTextMatches,
  isWysiwygFindMatch,
  replaceWysiwygTextMatch,
  replaceWysiwygTextMatches,
  selectWysiwygFindMatch,
} from './lib/wysiwygFind';

const EMPTY_SNAPSHOT: AppSnapshot = {
  rootDir: null,
  workspaceDocuments: [],
  recentDocuments: [],
  activeDocumentName: null,
  activeDocumentPath: null,
  activeDocumentSource: null,
  activeDocumentDirty: false,
  mode: 'Wysiwyg',
  theme: {
    kind: 'BuiltInDark',
    stylesheet: null,
    stylesheetPath: null,
  },
  lastError: null,
};

const MARKDOWN_FILE_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];
const WINDOW_TITLE = 'Markdowner';
const MENU_COMMAND_EVENT = 'markdowner://menu-command';
const SNAPSHOT_UPDATE_EVENT = 'markdowner://update-snapshot';
const MENU_COMMAND_CLOSE_WINDOW = 'close-window';
const MENU_COMMAND_QUIT_APP = 'quit-app';
const STARTUP_OPEN_TABS_RETRY_MS = 100;

type CloseTarget = 'window' | 'app';

// One open tab. The active tab's path/name/source are also reflected in
// the Rust-side AppSnapshot; tabs adds the rest of the open documents and
// preserves their unsaved drafts across switches.
//
// `kind: 'settings'` is a special UI tab that renders SettingsPanel instead of
// the editor surface. It never round-trips through Rust, so its path/source
// fields stay empty.
type DocumentTabKind = 'document' | 'settings';

type DocumentTab = {
  id: string;
  kind: DocumentTabKind;
  path: string | null;
  name: string;
  source: string;
  draft: string;
  /** True when the tab references a file path that does not exist on disk. */
  missing: boolean;
};

const SETTINGS_TAB_ID = '__markdowner_settings__';
const SETTINGS_TAB_NAME = 'Settings';

type ThemeMode = 'system' | 'manual';
type MarkdownSourceNode = {
  position?: {
    start?: {
      line?: number;
      offset?: number;
    };
    end?: {
      offset?: number;
    };
  };
};
type MarkdownSourceLineProps = {
  node?: MarkdownSourceNode;
};
type CaretDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function resolveOsTheme(): ThemeKind {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'BuiltInDark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'BuiltInDark' : 'BuiltInLight';
}

function usesCommandModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

function createSourceLineComponent(tagName: keyof HTMLElementTagNameMap) {
  return function SourceLineComponent(props: MarkdownSourceLineProps) {
    const { node, ...elementProps } = props as MarkdownSourceLineProps & Record<string, unknown>;
    const sourceLine = node?.position?.start?.line;
    const sourceOffset = node?.position?.start?.offset;
    const sourceEndOffset = node?.position?.end?.offset;

    return createElement(tagName, {
      ...elementProps,
      'data-source-line': Number.isFinite(sourceLine) ? sourceLine : undefined,
      'data-source-offset': Number.isFinite(sourceOffset) ? sourceOffset : undefined,
      'data-source-end-offset': Number.isFinite(sourceEndOffset) ? sourceEndOffset : undefined,
    });
  };
}

const sourceLineMarkdownComponents = {
  h1: createSourceLineComponent('h1'),
  h2: createSourceLineComponent('h2'),
  h3: createSourceLineComponent('h3'),
  h4: createSourceLineComponent('h4'),
  h5: createSourceLineComponent('h5'),
  h6: createSourceLineComponent('h6'),
  p: createSourceLineComponent('p'),
  li: createSourceLineComponent('li'),
  blockquote: createSourceLineComponent('blockquote'),
  pre: createSourceLineComponent('pre'),
  table: createSourceLineComponent('table'),
  tr: createSourceLineComponent('tr'),
} satisfies Components;

const SIDEBAR_STATE_KEY = 'markdowner.sidebarOpen';
const SIDEBAR_WIDTH_KEY = 'markdowner.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_KEYBOARD_STEP = 8;
const SIDEBAR_KEYBOARD_PAGE_STEP = 32;
const CHORD_PREFIX_TIMEOUT_MS = 1500;

function readSidebarState(): boolean {
  try {
    const value = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (value === null) return false; // Collapsed by default
    return value === 'true';
  } catch {
    return false;
  }
}

function writeSidebarState(isOpen: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STATE_KEY, String(isOpen));
  } catch {
    // localStorage unavailable; ignore
  }
}

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    return clampSidebarWidth(parsed);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function writeSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    // localStorage unavailable; ignore
  }
}

function buildLineStartOffsets(source: string) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function lineTextFromOffset(source: string, offset: number) {
  const lineEnd = source.indexOf('\n', offset);
  const text = source.slice(offset, lineEnd === -1 ? source.length : lineEnd);
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

function syncScrollPosition(source: HTMLElement, target: HTMLElement | null) {
  if (!target) return;

  const sourceMax = source.scrollHeight - source.clientHeight;
  const targetMax = target.scrollHeight - target.clientHeight;
  const nextScrollTop =
    sourceMax > 0 && targetMax > 0 ? Math.round((source.scrollTop / sourceMax) * targetMax) : 0;

  if (target.scrollTop !== nextScrollTop) {
    target.scrollTop = nextScrollTop;
  }
}

function clampSelectionOffset(offset: number, sourceLength: number) {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(sourceLength, Math.round(offset)));
}

function readSourceNumber(element: HTMLElement, key: keyof DOMStringMap) {
  const value = element.dataset[key];
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getTextLength(node: Node): number {
  return node.textContent?.length ?? 0;
}

function getTextOffsetWithinElement(root: HTMLElement, targetNode: Node, targetOffset: number) {
  if (!root.contains(targetNode)) return null;

  const nodeFilter = root.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = root.ownerDocument.createTreeWalker(root, nodeFilter);
  let offset = 0;

  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (currentNode === targetNode) {
      return offset + Math.max(0, Math.min(targetOffset, getTextLength(currentNode)));
    }
    offset += getTextLength(currentNode);
  }

  if (targetNode instanceof HTMLElement && root.contains(targetNode)) {
    return Array.from(targetNode.childNodes)
      .slice(0, targetOffset)
      .reduce((total, childNode) => total + getTextLength(childNode), offset);
  }

  return null;
}

function getRenderedTextOffset(element: HTMLElement, clientX: number, clientY: number) {
  const ownerDocument = element.ownerDocument as CaretDocument;
  const caretPosition = ownerDocument.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition) {
    const offset = getTextOffsetWithinElement(
      element,
      caretPosition.offsetNode,
      caretPosition.offset,
    );
    if (offset !== null) return offset;
  }

  const caretRange = ownerDocument.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange) {
    const offset = getTextOffsetWithinElement(
      element,
      caretRange.startContainer,
      caretRange.startOffset,
    );
    if (offset !== null) return offset;
  }

  return null;
}

function estimateRenderedTextOffset(
  element: HTMLElement,
  event: ReactMouseEvent<HTMLDivElement>,
  renderedTextLength: number,
) {
  if (renderedTextLength <= 0) return 0;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return 0;

  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(ratio * renderedTextLength);
}

function mapRenderedTextOffsetToSourceOffset(
  element: HTMLElement,
  source: string,
  sourceOffset: number,
  sourceEndOffset: number,
  renderedOffset: number,
) {
  const renderedText = element.textContent ?? '';
  const rawStart = clampSelectionOffset(sourceOffset, source.length);
  const rawEnd = Math.max(rawStart, clampSelectionOffset(sourceEndOffset, source.length));
  const rawText = source.slice(rawStart, rawEnd);

  if (renderedText.length > 0) {
    const renderedTextStart = rawText.indexOf(renderedText);
    if (renderedTextStart >= 0) {
      return clampSelectionOffset(rawStart + renderedTextStart + renderedOffset, source.length);
    }
  }

  return clampSelectionOffset(rawStart + renderedOffset, source.length);
}

function matchesShortcut(
  event: KeyboardEvent,
  key: string,
  options: { shift?: boolean } = {},
) {
  if (event.defaultPrevented || event.altKey || !usesCommandModifier(event)) {
    return false;
  }

  return event.key.toLowerCase() === key && event.shiftKey === (options.shift ?? false);
}

function countLiteralOccurrencesBefore(source: string, needle: string, endOffset: number) {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0 && index < endOffset) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }

  return count;
}

function normalizeCloseDecision(decision: unknown) {
  return typeof decision === 'string'
    ? decision.trim().toLowerCase().replace(/[’']/g, "'")
    : decision;
}

function isSaveCloseDecision(decision: unknown) {
  const normalized = normalizeCloseDecision(decision);
  return normalized === true || normalized === 'save' || normalized === 'yes';
}

function isDiscardCloseDecision(decision: unknown) {
  const normalized = normalizeCloseDecision(decision);
  return (
    normalized === false ||
    normalized === 'no' ||
    normalized === "don't save" ||
    normalized === 'dont save' ||
    normalized === 'discard'
  );
}

function getErrorMessage(error: unknown, fallback = 'Operation failed') {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

function normalizeDisplayPath(path: string) {
  return path.replace(/\\/g, '/');
}

function displayFileName(path: string) {
  const normalizedPath = normalizeDisplayPath(path);
  const segments = normalizedPath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function displayWorkspacePath(path: string, rootDir: string | null) {
  const normalizedPath = normalizeDisplayPath(path);
  if (!rootDir) {
    return normalizedPath;
  }

  const normalizedRoot = normalizeDisplayPath(rootDir).replace(/\/+$/, '');
  const pathPrefix = `${normalizedRoot}/`;

  if (normalizedPath.toLowerCase().startsWith(pathPrefix.toLowerCase())) {
    return normalizedPath.slice(pathPrefix.length);
  }

  return normalizedPath;
}

type WorkspaceTreeFileNode = {
  kind: 'file';
  key: string;
  path: string;
  name: string;
  relativePath: string;
};

type WorkspaceTreeFolderNode = {
  kind: 'folder';
  key: string;
  name: string;
  children: WorkspaceTreeNode[];
};

type WorkspaceTreeNode = WorkspaceTreeFileNode | WorkspaceTreeFolderNode;

function buildWorkspaceTree(paths: string[], rootDir: string | null): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];

  for (const path of paths) {
    const relativePath = displayWorkspacePath(path, rootDir);
    const segments = normalizeDisplayPath(relativePath).split('/').filter(Boolean);
    let level = root;
    let folderKey = '';

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? '';
      const isFile = index === segments.length - 1;

      if (isFile) {
        level.push({
          kind: 'file',
          key: path,
          path,
          name: segment || displayFileName(path),
          relativePath,
        });
        continue;
      }

      folderKey = folderKey ? `${folderKey}/${segment}` : segment;

      let folderNode = level.find(
        (node): node is WorkspaceTreeFolderNode =>
          node.kind === 'folder' && node.key === folderKey,
      );

      if (!folderNode) {
        folderNode = {
          kind: 'folder',
          key: folderKey,
          name: segment,
          children: [],
        };
        level.push(folderNode);
      }

      level = folderNode.children;
    }
  }

  return root;
}

// VS Code-style subsequence ("full fuzzy") match: every character of
// `needle` must appear in `haystack` in the same order, not necessarily
// adjacent. Returns true for an empty query so callers treat "no filter"
// naturally.
function fuzzyMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  let cursor = 0;
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack.charCodeAt(i) === needle.charCodeAt(cursor)) {
      cursor += 1;
      if (cursor === needle.length) return true;
    }
  }
  return false;
}

function filterWorkspaceTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return nodes;
  }

  const filteredNodes: WorkspaceTreeNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'file') {
      const haystack = `${node.name}\u0000${node.relativePath}`.toLowerCase();
      if (fuzzyMatch(haystack, normalizedQuery)) {
        filteredNodes.push(node);
      }
      continue;
    }

    const filteredChildren = filterWorkspaceTree(node.children, normalizedQuery);
    if (filteredChildren.length > 0) {
      filteredNodes.push({
        ...node,
        children: filteredChildren,
      });
    }
  }

  return filteredNodes;
}

function collectWorkspaceFolderKeys(nodes: WorkspaceTreeNode[], folderKeys: Set<string>) {
  for (const node of nodes) {
    if (node.kind !== 'folder') {
      continue;
    }

    folderKeys.add(node.key);
    collectWorkspaceFolderKeys(node.children, folderKeys);
  }
}

type EditorModeOption = {
  mode: EditorMode;
  label: string;
  shortcutSymbol: string;
  shortcutText: string;
  ariaKeyshortcuts: string;
};

const EDITOR_MODE_OPTIONS: EditorModeOption[] = [
  { mode: 'Wysiwyg', label: 'WYSIWYG', shortcutSymbol: '⌥1', shortcutText: 'Opt+1', ariaKeyshortcuts: 'Alt+Digit1' },
  { mode: 'Editor', label: 'Editor', shortcutSymbol: '⌥2', shortcutText: 'Opt+2', ariaKeyshortcuts: 'Alt+Digit2' },
  { mode: 'SplitView', label: 'Split View', shortcutSymbol: '⌥3', shortcutText: 'Opt+3', ariaKeyshortcuts: 'Alt+Digit3' },
];
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;

const sourceFocusModeExtension = EditorView.theme({
  '&.cm-focused .cm-line': {
    opacity: '0.46',
    transition: 'opacity 120ms ease',
  },
  '&.cm-focused .cm-line:hover, &.cm-focused .cm-line:has(.cm-selectionBackground)': {
    opacity: '1',
  },
});

const sourceTypewriterModeExtension = EditorView.theme({
  '.cm-scroller': {
    scrollPaddingBlock: '45%',
  },
  '.cm-content': {
    paddingTop: '35vh',
    paddingBottom: '35vh',
  },
});

const EDITOR_MODE_LABELS: Record<EditorMode, string> = EDITOR_MODE_OPTIONS.reduce(
  (acc, option) => {
    acc[option.mode] = option.label;
    return acc;
  },
  {} as Record<EditorMode, string>,
);

function formatEditorMode(mode: EditorMode): string {
  return EDITOR_MODE_LABELS[mode] ?? mode;
}

const THEME_KIND_LABELS: Record<ThemeKind, string> = {
  BuiltInLight: 'Light',
  BuiltInDark: 'Dark',
  CustomCss: 'Custom',
};

function formatThemeLabel(kind: ThemeKind): string {
  return THEME_KIND_LABELS[kind] ?? kind;
}

function applyThemeSelection(themeKind: ThemeKind) {
  document.documentElement.dataset.theme = themeKind;
}

function applyImportedStylesheet(snapshot: AppSnapshot) {
  const existing = document.getElementById('markdowner-imported-theme');
  if (snapshot.theme.kind !== 'CustomCss' || !snapshot.theme.stylesheet) {
    existing?.remove();
    return;
  }

  const style = existing ?? document.createElement('style');
  style.id = 'markdowner-imported-theme';
  style.textContent = scopeImportedStylesheet(snapshot.theme.stylesheet);
  if (!existing) {
    document.head.appendChild(style);
  }
}

function buildWindowTitle(snapshot: AppSnapshot) {
  if (snapshot.activeDocumentSource === null || !snapshot.activeDocumentName) {
    return WINDOW_TITLE;
  }

  const prefix = snapshot.activeDocumentDirty ? '● ' : '';
  return `${prefix}${snapshot.activeDocumentName} — ${WINDOW_TITLE}`;
}

function centerSourceEditorLine(view: EditorView) {
  const scrollElement = view.scrollDOM;
  if (!scrollElement || scrollElement.clientHeight <= 0) return;

  const selectionHead = view.state.selection.main.head;
  const lineBlock = view.lineBlockAt(selectionHead);
  const nextScrollTop = Math.max(
    0,
    lineBlock.top + lineBlock.height / 2 - scrollElement.clientHeight / 2,
  );

  if (Number.isFinite(nextScrollTop)) {
    scrollElement.scrollTop = nextScrollTop;
  }
}

/**
 * Move the ProseMirror caret by one viewport-page (PageUp/PageDown parity).
 * Browser contenteditable surfaces only scroll on these keys by default — this
 * brings the caret along the way and extends the selection when `extend` is
 * true (Shift+PageUp/Down).
 */
function movePageInProseMirror(
  view: any,
  direction: 1 | -1,
  extend: boolean,
): boolean {
  const state = view?.state;
  if (!state) return false;
  const head = state.selection.head;
  const headCoords = view.coordsAtPos(head);

  // The Wysiwyg pane wraps `view.dom` in an `overflow-auto` container, so its
  // clientHeight matches the visible viewport. Fall back gracefully when
  // running inside a test harness or unusual layout.
  const viewportHeight =
    view.dom.parentElement?.clientHeight ||
    view.dom.clientHeight ||
    window.innerHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;

  // Leave a small overlap so the reader keeps a line of context.
  const step = direction * Math.max(viewportHeight * 0.9, 40);
  const computedStyle = window.getComputedStyle(view.dom);
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
  const fallbackLineHeight = Number.isFinite(parsedFontSize) && parsedFontSize > 0
    ? parsedFontSize * 1.4
    : 20;
  const lineHeight = Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
    ? parsedLineHeight
    : fallbackLineHeight;
  const targetY = headCoords.top + step - lineHeight * 2;
  const found = view.posAtCoords({ left: headCoords.left, top: targetY });
  const targetPos = found?.pos ?? (direction > 0 ? state.doc.content.size : 0);

  const SelectionCtor = state.selection.constructor as {
    create: (doc: any, anchor: number, head?: number) => any;
  };
  const anchor = extend ? state.selection.anchor : targetPos;
  const nextSelection = SelectionCtor.create(state.doc, anchor, targetPos);
  view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
  return true;
}

function moveLineBoundaryInProseMirror(
  view: any,
  boundary: 'start' | 'end',
  extend: boolean,
): boolean {
  const state = view?.state;
  const dom = view?.dom as HTMLElement | undefined;
  if (!state || !dom) return false;

  const head = state.selection.head;
  const headCoords = view.coordsAtPos(head);
  const editorRect = dom.getBoundingClientRect();
  const targetY = (headCoords.top + headCoords.bottom) / 2;
  const targetX = boundary === 'start'
    ? editorRect.left + 1
    : editorRect.right - 1;
  const found = view.posAtCoords({ left: targetX, top: targetY });
  if (!found || typeof found.pos !== 'number') return false;

  const SelectionCtor = state.selection.constructor as {
    create: (doc: any, anchor: number, head?: number) => any;
  };
  const targetPos = found.pos;
  const anchor = extend ? state.selection.anchor : targetPos;
  const nextSelection = SelectionCtor.create(state.doc, anchor, targetPos);
  view.dispatch(state.tr.setSelection(nextSelection).scrollIntoView());
  return true;
}

function centerTiptapEditorLine(editor: any) {
  const scrollElement = document.querySelector('[data-testid="editor-surface-wysiwyg"]');
  if (!scrollElement || scrollElement.clientHeight <= 0) return;

  const { view } = editor;
  if (!view || !view.state) return;
  const { selection } = view.state;
  
  try {
    const coords = view.coordsAtPos(selection.head);
    const scrollRect = scrollElement.getBoundingClientRect();
    const offsetToCenter = coords.top - scrollRect.top + scrollElement.scrollTop;
    
    const nextScrollTop = Math.max(0, offsetToCenter - scrollElement.clientHeight / 2);

    if (Number.isFinite(nextScrollTop)) {
      scrollElement.scrollTop = nextScrollTop;
    }
  } catch (e) {
    // coordsAtPos might fail if the position is not drawn yet
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [localDraft, setLocalDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [externalChangeMessage, setExternalChangeMessage] = useState<string | null>(null);
  const [showExternalChangeActions, setShowExternalChangeActions] = useState(false);
  const [externalCompareSource, setExternalCompareSource] = useState<string | null>(null);
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<string[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [sidebarPanel, setSidebarPanel] = useState<SideBarPanel>('files');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(readSidebarState());
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isDocumentStatsOpen, setIsDocumentStatsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isFindReplaceReplaceMode, setIsFindReplaceReplaceMode] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findReplacement, setFindReplacement] = useState('');
  const [findOptions, setFindOptions] = useState<FindReplaceOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [activeFindMatchIndex, setActiveFindMatchIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState<FindReplaceOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [searchResults, setSearchResults] = useState<SearchResultFile[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchHasRun, setSearchHasRun] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchRequestIdRef = useRef(0);
  const [shellAnnouncement, setShellAnnouncement] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [debouncedLocalDraft, setDebouncedLocalDraft] = useState(localDraft);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });
  const sourceEditorViewRef = useRef<EditorView | null>(null);
  const sourceEditorContainerRef = useRef<HTMLDivElement | null>(null);
  const splitSourceScrollRef = useRef<HTMLDivElement | null>(null);
  const splitPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const modeRequestIdRef = useRef(0);
  const liveRegionTimerRef = useRef<number | null>(null);
  const lastAnnouncedModeRef = useRef<EditorMode | null>(null);
  const lastAnnouncedTabIdRef = useRef<string | null>(null);
  const chordPrefixActiveRef = useRef(false);
  const chordPrefixTimerRef = useRef<number | null>(null);
  const isFindReplaceOpenRef = useRef(false);
  // Tracks the most recent focused row inside sidebar panels so shortcuts can
  // restore the user's last position instead of jumping to the first row.
  const lastExplorerFocusRef = useRef<HTMLElement | null>(null);
  const lastOutlineFocusRef = useRef<HTMLElement | null>(null);
  // Mirror of the markdown most recently emitted by the Tiptap editor. The
  // localDraft <-> editor sync effect compares against this instead of
  // re-reading editor.getMarkdown(), which can change between keystrokes due
  // to markdown renormalization and would otherwise cause setContent to fire
  // mid-typing — breaking IME composition (e.g. typing Korean "안녕하세요"
  // would split into two lines).
  const lastEditorMarkdownRef = useRef<string>('');
  // Tracks which tab's content the editor currently displays. Allows the
  // sync effect to detect tab switches even when both tabs share identical
  // markdown (e.g. a fresh untitled doc after closing another empty one),
  // which the markdown-only comparison would silently skip.
  const lastEditorActiveTabIdRef = useRef<string | null>(null);
  const isWysiwygComposingRef = useRef(false);
  const wysiwygCompositionFlushTimerRef = useRef<number | null>(null);
  // Wall-clock timestamp of the most recent WYSIWYG compositionend. Used to
  // suppress synthetic Enter keys that ProseMirror's readDOMChange dispatches
  // when WebKit's Korean IME injects block-level DOM nodes (an empty <p>
  // after the heading) between syllables — without this, every Hangul
  // syllable after the first splits the heading into heading + paragraph.
  const lastWysiwygCompositionEndAtRef = useRef<number>(0);
  // Most-recent compositionend payload — kept for diagnostics / future use.
  // The actual duplicate-syllable detection lives in handleTextInput and
  // compares against the live editor state rather than this ref, so the
  // detection survives multi-syllable runs (the bug never depended on the
  // buffered data anyway — the IME duplicates the in-progress syllable
  // before compositionend fires).
  const lastWysiwygCompositionDataRef = useRef<string>('');
  // Mirrors the live Tiptap editor instance so memoized handleDOMEvents
  // callbacks (which capture closures at first render) can always reach the
  // current editor — without this, `editor` inside `compositionend` would be
  // null after we stabilise the editorProps reference below.
  const editorInstanceRef = useRef<TiptapEditor | null>(null);
  useEffect(() => {
    isFindReplaceOpenRef.current = isFindReplaceOpen;
  }, [isFindReplaceOpen]);

  useEffect(() => {
    return () => {
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
        wysiwygCompositionFlushTimerRef.current = null;
      }
    };
  }, []);

  // Remember the most recent focused element inside sidebar panels so
  // shortcuts can restore that exact row instead of jumping to the first item.
  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const explorerRoot = target.closest?.('[data-explorer-root]');
      if (explorerRoot) {
        lastExplorerFocusRef.current = target;
      }
      const outlineRoot = target.closest?.('[data-outline-root]');
      if (outlineRoot) {
        lastOutlineFocusRef.current = target;
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  const clearChordPrefix = () => {
    chordPrefixActiveRef.current = false;
    if (chordPrefixTimerRef.current !== null) {
      window.clearTimeout(chordPrefixTimerRef.current);
      chordPrefixTimerRef.current = null;
    }
  };
  const activeDocumentOpen = snapshot.activeDocumentSource !== null;

  const announceShell = (message: string) => {
    if (liveRegionTimerRef.current !== null) {
      window.clearTimeout(liveRegionTimerRef.current);
    }
    setShellAnnouncement('');
    liveRegionTimerRef.current = window.setTimeout(() => {
      setShellAnnouncement(message);
      liveRegionTimerRef.current = null;
    }, 10);
  };

  useEffect(() => {
    return () => {
      if (liveRegionTimerRef.current !== null) {
        window.clearTimeout(liveRegionTimerRef.current);
      }
    };
  }, []);

  // Tab state lives entirely in the frontend. The active tab's path/source
  // is mirrored through Rust's single-active-document model on switch.
  const [tabs, setTabs] = useState<DocumentTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [startupTabsReady, setStartupTabsReady] = useState(false);
  // Mirror tabs/activeTabId in refs so async callbacks (bootstrap.then,
  // openDocument.then) can read the *current* values instead of stale
  // closures — without this, a user opening Settings before bootstrap
  // finishes loses the settings tab when upsertActiveTabFromSnapshot fires.
  const tabsRef = useRef<DocumentTab[]>(tabs);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  // Monotonic counter for file/tab operations. Each open/new/switch flow
  // captures the value at start; after every async hop it re-checks against
  // the current value and aborts if a newer operation has begun. Without
  // this guard, two overlapping flows (e.g. CMD+N fired while a close-then-
  // switch is mid-await) commit state in arrival order rather than user
  // intent order, leaving the editor on the previous file's contents.
  const editorOpRequestIdRef = useRef(0);
  const nextEditorOpRequest = () => ++editorOpRequestIdRef.current;
  const isEditorOpStale = (token: number) =>
    editorOpRequestIdRef.current !== token;
  // Tracks the document tab that was active immediately before the settings
  // tab was opened. Closing the settings tab restores this without
  // round-tripping through Rust (the snapshot never changed while settings
  // was on screen).
  const preSettingsDocTabIdRef = useRef<string | null>(null);

  const generateTabId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  // Find a tab matching the given path; null path means untitled. Only
  // considers document tabs — the settings tab has path=null but is not a
  // valid match for "find me the untitled document."
  const findTabByPath = (path: string | null): DocumentTab | undefined => {
    if (path === null) {
      return tabs.find((tab) => tab.kind === 'document' && tab.path === null);
    }
    return tabs.find((tab) => tab.kind === 'document' && tab.path === path);
  };

  // Stash the live editor draft into the active tab so a later switch back
  // restores the user's in-flight edits. No-op when the active tab is a
  // non-document surface (settings) since it has no editor draft to preserve.
  const stashActiveTabDraft = () => {
    const id = activeTabId;
    if (!id) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id && tab.kind === 'document' ? { ...tab, draft: localDraft } : tab,
      ),
    );
  };

  // Replace (or append) a tab matching the snapshot's active document and
  // mark it active. Used after open/new/save flows. The state updates run
  // inside startTransition so they batch with applySnapshot — otherwise the
  // tabs commit before the snapshot and the keyboard listener briefly sees
  // activeDocumentOpen=false right after a fresh open.
  const upsertActiveTabFromSnapshot = (
    next: AppSnapshot,
    options: {
      reuseTabId?: string | null;
      markStartupTabsReady?: boolean;
      preserveSettingsActive?: boolean;
    } = {},
  ) => {
    const path = next.activeDocumentPath ?? null;
    const name = next.activeDocumentName ?? 'Untitled';
    const source = next.activeDocumentSource ?? '';
    const reuseId = options.reuseTabId ?? null;
    const current = tabsRef.current;

    let newTabs = current;
    let newActiveId: string | null = null;

    const replaceAt = (index: number) => {
      newTabs = current.map((tab, i) =>
        i === index
          ? { ...tab, kind: 'document', path, name, source, draft: source, missing: false }
          : tab,
      );
      newActiveId = newTabs[index].id;
    };

    if (reuseId) {
      const reusedAt = current.findIndex(
        (tab) => tab.kind === 'document' && tab.id === reuseId,
      );
      if (reusedAt >= 0) replaceAt(reusedAt);
    }

    if (newActiveId === null && path !== null) {
      const matchAt = current.findIndex(
        (tab) => tab.kind === 'document' && tab.path === path,
      );
      if (matchAt >= 0) replaceAt(matchAt);
    }

    if (newActiveId === null && path === null) {
      const untitledAt = current.findIndex(
        (tab) => tab.kind === 'document' && tab.path === null,
      );
      if (untitledAt >= 0) replaceAt(untitledAt);
    }

    if (newActiveId === null) {
      const newTab: DocumentTab = {
        id: generateTabId(),
        kind: 'document',
        path,
        name,
        source,
        draft: source,
        missing: false,
      };
      newTabs = [...current, newTab];
      newActiveId = newTab.id;
    }

    tabsRef.current = newTabs;
    // Startup can finish after the user has already opened Settings. In that
    // narrow path, keep Settings active while still adding the document tab.
    const currentActive = activeTabIdRef.current;
    const currentActiveIsSettings =
      options.preserveSettingsActive === true &&
      currentActive !== null &&
      newTabs.some((tab) => tab.id === currentActive && tab.kind === 'settings');
    const committedActiveId = currentActiveIsSettings ? currentActive : newActiveId;
    activeTabIdRef.current = committedActiveId;
    startTransition(() => {
      setTabs(newTabs);
      setActiveTabId(committedActiveId);
      if (options.markStartupTabsReady) {
        setStartupTabsReady(true);
      }
    });
  };

  // Update only the active tab's metadata (after save / save-as). Settings
  // tabs are never the target of a snapshot refresh.
  const refreshActiveTabFromSnapshot = (next: AppSnapshot) => {
    if (!activeTabId) return;
    const path = next.activeDocumentPath ?? null;
    const name = next.activeDocumentName ?? 'Untitled';
    const source = next.activeDocumentSource ?? '';
    startTransition(() => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId && tab.kind === 'document'
            ? { ...tab, path, name, source, draft: source, missing: false }
            : tab,
        ),
      );
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLocalDraft(localDraft);
    }, 250);
    return () => clearTimeout(timer);
  }, [localDraft]);

  const documentStats = useMemo(() => {
    const characters = localDraft.length;
    const trimmed = localDraft.trim();
    const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
    const readingTimeMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));

    const headingMatches = localDraft.match(/^#{1,6}\s+.+$/gm) ?? [];
    const imageMatches = localDraft.match(/!\[[^\]]*]\([^\n)]+\)/g) ?? [];
    const links = localDraft.replace(/!\[[^\]]*]\([^\n)]+\)/g, '').match(/\[[^\]]+]\([^\n)]+\)/g) ?? [];

    const lines = localDraft.split(/\r?\n/);
    const isTableRow = (line: string) => line.includes('|') && line.trim().length > 0;
    const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

    let tables = 0;
    for (let index = 1; index < lines.length - 1; index += 1) {
      if (!isTableSeparator(lines[index] ?? '')) {
        continue;
      }

      if (isTableRow(lines[index - 1] ?? '') && isTableRow(lines[index + 1] ?? '')) {
        tables += 1;
      }
    }

    return {
      words,
      characters,
      readingTimeMinutes,
      headings: headingMatches.length,
      links: links.length,
      images: imageMatches.length,
      tables,
    };
  }, [localDraft]);
  const outlineItems = useMemo<OutlineItem[]>(() => {
    if (!activeDocumentOpen) {
      return [];
    }

    const matches = Array.from(localDraft.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm));
    return matches.map((match, index) => {
      const lineStart = match.index ?? 0;
      const rawTitle = match[2] ?? '';
      const title = rawTitle.trim();
      const rawTitleStartInLine = match[0].indexOf(rawTitle);
      const trimmedPrefixLength = rawTitle.length - rawTitle.trimStart().length;
      const titleStart =
        lineStart + Math.max(0, rawTitleStartInLine) + trimmedPrefixLength;

      return {
        id: `${index}-${lineStart}`,
        depth: match[1]?.length ?? 1,
        title,
        titleStart,
        titleEnd: titleStart + title.length,
        selectionStart: lineStart,
        selectionEnd: lineStart + match[0].trimEnd().length,
      };
    });
  }, [activeDocumentOpen, localDraft]);
  const sourceLineStartOffsets = useMemo(() => buildLineStartOffsets(localDraft), [localDraft]);
  const themeMode: ThemeMode = settings.themeFollowSystem ? 'system' : 'manual';

  const getSourceOffsetForLine = (lineNumber: number) => {
    if (!Number.isFinite(lineNumber) || lineNumber < 1) {
      return 0;
    }
    return sourceLineStartOffsets[lineNumber - 1] ?? localDraft.length;
  };

  const focusSourceSelection = (
    selectionStart: number,
    selectionEnd = selectionStart,
    options: { focusEditor?: boolean } = {},
  ) => {
    const nextSelectionStart = clampSelectionOffset(selectionStart, localDraft.length);
    const nextSelectionEnd = clampSelectionOffset(selectionEnd, localDraft.length);
    const selection = { anchor: nextSelectionStart, head: nextSelectionEnd };
    const shouldFocus = options.focusEditor !== false;

    if (sourceEditorViewRef.current) {
      sourceEditorViewRef.current.dispatch({ selection, scrollIntoView: true });
      if (shouldFocus) {
        sourceEditorViewRef.current.focus();
      }
      return;
    }

    const sourceTextarea = sourceEditorContainerRef.current?.querySelector('textarea');
    if (sourceTextarea instanceof HTMLTextAreaElement) {
      if (shouldFocus) {
        sourceTextarea.focus();
      }
      sourceTextarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    }
  };

  const handleStartWindowDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  };

  const handleOpenFilesPanel = useEffectEvent(() => {
    setSidebarPanel('files');
    setIsSidebarOpen((current) => {
      const next = current && sidebarPanel === 'files' ? !current : true;
      writeSidebarState(next);
      announceShell(next ? 'Files sidebar shown' : 'Sidebar hidden');
      return next;
    });
  });

  const handleShowExplorerPanel = useEffectEvent(() => {
    const wasVisible = isSidebarOpen && sidebarPanel === 'files';
    setSidebarPanel('files');
    setIsSidebarOpen(true);
    writeSidebarState(true);
    if (!wasVisible) {
      announceShell('Files sidebar shown');
    }
  });

  const handleToggleSidebar = useEffectEvent(() => {
    if (isSidebarOpen) {
      setIsSidebarOpen(false);
      writeSidebarState(false);
      announceShell('Sidebar hidden');
      return;
    }

    setSidebarPanel('files');
    setIsSidebarOpen(true);
    writeSidebarState(true);
    announceShell('Files sidebar shown');
  });

  /**
   * Move keyboard focus into the Explorer sidebar (VS Code "Show Explorer"
   * parity). Restores the last focused row when available so toggling Cmd+0
   * back and forth keeps the caret in place; otherwise falls back to the first
   * tree button / open editor / filter input.
   */
  const focusExplorerTree = () => {
    const restoreLast = () => {
      const remembered = lastExplorerFocusRef.current;
      if (
        remembered &&
        remembered.isConnected &&
        remembered.closest('[data-explorer-root]')
      ) {
        remembered.focus({ preventScroll: false });
        return true;
      }
      return false;
    };

    const focusFallback = () => {
      const root = document.querySelector<HTMLElement>('[data-explorer-root]');
      if (!root) return false;
      const firstTreeButton = root.querySelector<HTMLButtonElement>(
        '[data-testid="explorer-workspace-tree"] button',
      );
      if (firstTreeButton) {
        firstTreeButton.focus();
        return true;
      }
      const firstOpenEditor = root.querySelector<HTMLButtonElement>(
        '[data-testid="explorer-open-editors"] button',
      );
      if (firstOpenEditor) {
        firstOpenEditor.focus();
        return true;
      }
      const filter = root.querySelector<HTMLInputElement>('[data-explorer-filter]');
      if (filter) {
        filter.focus();
        return true;
      }
      return false;
    };

    // Try synchronously first — when the Explorer is already mounted this
    // avoids the one-frame visual hop. Defer to rAF only when needed (e.g.
    // sidebar just became visible).
    if (restoreLast() || focusFallback()) return;
    requestAnimationFrame(() => {
      if (restoreLast()) return;
      focusFallback();
    });
  };

  const focusOutlineTree = () => {
    const tryFocus = () => {
      const root = document.querySelector<HTMLElement>('[data-outline-root]');
      if (!root) return false;

      const remembered = lastOutlineFocusRef.current;
      if (remembered && remembered.isConnected && remembered.closest('[data-outline-root]')) {
        remembered.focus({ preventScroll: false });
        return true;
      }

      const firstOutlineRow = root.querySelector<HTMLButtonElement>('[data-outline-row]');
      if (firstOutlineRow) {
        firstOutlineRow.focus();
        return true;
      }

      root.focus({ preventScroll: false });
      return true;
    };

    if (tryFocus()) return;
    requestAnimationFrame(() => {
      tryFocus();
    });
  };

  /** Focus the Files filter input (VS Code Cmd+F in Explorer parity). */
  const focusExplorerFilter = () => {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-explorer-root] [data-explorer-filter]',
      );
      if (input) {
        input.focus();
        input.select();
      }
    });
  };

  /**
   * Move keyboard focus into the active editor surface (CodeMirror or TipTap)
   * based on the current mode. Used by Cmd+0 (toggle back to editor) and
   * Cmd+1..9 (jump-to-tab from Explorer) so the caret lands on the document
   * the user just selected.
   */
  const focusActiveEditor = () => {
    const tryFocus = () => {
      if (currentMode === 'Wysiwyg') {
        const proseMirror = document.querySelector<HTMLElement>(
          '[data-testid="editor-surface-wysiwyg"] .ProseMirror',
        );
        if (proseMirror) {
          proseMirror.focus();
          return true;
        }
        return false;
      }
      if (sourceEditorViewRef.current) {
        sourceEditorViewRef.current.focus();
        return true;
      }
      const sourceTextarea = sourceEditorContainerRef.current?.querySelector('textarea');
      if (sourceTextarea instanceof HTMLTextAreaElement) {
        sourceTextarea.focus();
        return true;
      }
      return false;
    };
    // Synchronous attempt first to avoid a perceptible one-frame hop. Defer to
    // rAF as a fallback if the target surface hasn't mounted yet.
    if (tryFocus()) return;
    requestAnimationFrame(() => {
      tryFocus();
    });
  };

  const isFocusInsideExplorer = () => {
    const active = document.activeElement as HTMLElement | null;
    return Boolean(active?.closest('[data-explorer-root]'));
  };

  const handleOpenOutlinePanel = useEffectEvent(() => {
    const next = !(isSidebarOpen && sidebarPanel === 'outline');
    setSidebarPanel('outline');
    setIsSidebarOpen(next);
    writeSidebarState(next);
    announceShell(next ? 'Outline sidebar shown' : 'Sidebar hidden');
  });

  const handleToggleSearchPanel = useEffectEvent(() => {
    setSidebarPanel('search');
    setIsSidebarOpen((current) => {
      const next = current && sidebarPanel === 'search' ? !current : true;
      writeSidebarState(next);
      announceShell(next ? 'Search sidebar shown' : 'Sidebar hidden');
      return next;
    });
    setSearchFocusToken((value) => value + 1);
  });

  const handleFocusSearchPanel = useEffectEvent(() => {
    const wasAlreadyVisible = isSidebarOpen && sidebarPanel === 'search';
    setSidebarPanel('search');
    setIsSidebarOpen(true);
    writeSidebarState(true);
    setSearchFocusToken((value) => value + 1);
    if (!wasAlreadyVisible) {
      announceShell('Search sidebar shown');
    }
  });

  const handleSearchQueryChange = (value: string) => {
    setSearchQuery(value);
    if (value.length === 0) {
      setSearchResults([]);
      setSearchError(null);
      setSearchHasRun(false);
    }
  };

  const handleSearchOptionsChange = (next: FindReplaceOptions) => {
    setSearchOptions(next);
  };

  const handleRunWorkspaceSearch = useEffectEvent(async () => {
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      setSearchError(null);
      setSearchHasRun(false);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchBusy(true);
    setSearchError(null);

    try {
      // Combine workspace files with open tab paths so the search also covers
      // documents the user opened from outside the workspace folder.
      const seen = new Set<string>();
      const paths: string[] = [];
      for (const path of snapshot.workspaceDocuments) {
        if (path && !seen.has(path)) {
          seen.add(path);
          paths.push(path);
        }
      }
      for (const tab of tabs) {
        if (tab.path && !seen.has(tab.path)) {
          seen.add(tab.path);
          paths.push(tab.path);
        }
      }
      const result = await searchWorkspace(searchQuery, searchOptions, paths);
      if (searchRequestIdRef.current !== requestId) return;
      setSearchResults(result.files);
      setSearchHasRun(true);
    } catch (error) {
      if (searchRequestIdRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message || 'Search failed');
      setSearchResults([]);
      setSearchHasRun(true);
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setSearchBusy(false);
      }
    }
  });

  // Debounced auto-search: re-run the workspace search ~200 ms after the user
  // stops typing or changes search options, mirroring VS Code's incremental
  // Find-in-Files behaviour so the user does not have to press Enter.
  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      return;
    }
    const handle = window.setTimeout(() => {
      void handleRunWorkspaceSearch();
    }, 200);
    return () => {
      window.clearTimeout(handle);
    };
  }, [searchQuery, searchOptions]);

  const handleSelectSearchMatch = useEffectEvent(
    async (file: SearchResultFile, match: SearchResultMatch | undefined) => {
      const targetMatch = match ?? file.matches[0];
      const existing = findTabByPath(file.path);
      if (existing) {
        await switchToTab(existing.id);
      } else {
        await withBusy(async () => {
          stashActiveTabDraft();
          await syncActiveDraftBestEffort();
          const next = await openWorkspaceDocument(file.path);
          applySnapshot(next);
          upsertActiveTabFromSnapshot(next);
        });
      }
      if (targetMatch) {
        const offset = targetMatch.absoluteOffset;
        const end = offset + (targetMatch.matchEnd - targetMatch.matchStart);
        window.setTimeout(() => {
          focusSourceSelection(offset, end);
        }, 16);
      }
    },
  );

  const handleSelectOutlineItem = useEffectEvent((item: OutlineItem) => {
    if (currentMode === 'Wysiwyg') {
      const titleText = localDraft.slice(item.titleStart, item.titleEnd) || item.title;
      const occurrenceIndex = countLiteralOccurrencesBefore(
        localDraft,
        titleText,
        item.titleStart,
      );
      const matches = findWysiwygTextMatches(editor, titleText, {
        caseSensitive: true,
        wholeWord: false,
        regex: false,
      }).matches.filter(isWysiwygFindMatch);
      const match = matches[occurrenceIndex] ?? matches[0];

      if (match && editor) {
        const didSelect = editor.commands?.setTextSelection?.({
          from: match.wysiwygFrom,
          to: match.wysiwygFrom,
        });
        if (didSelect !== false) {
          editor.view?.focus?.();
        }
        editor.view.dispatch(editor.state.tr.scrollIntoView());
      }
      return;
    }

    focusSourceSelection(item.titleStart);
  });

  const handleSplitSourceScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    syncScrollPosition(event.currentTarget, splitPreviewScrollRef.current);
  };

  const handleSplitPreviewScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    syncScrollPosition(
      event.currentTarget,
      sourceEditorViewRef.current?.scrollDOM ?? splitSourceScrollRef.current,
    );
  };

  const handleSourceEditorViewportChange = useEffectEvent((scrollElement: HTMLElement) => {
    if (currentMode !== 'SplitView') return;
    syncScrollPosition(scrollElement, splitPreviewScrollRef.current);
  });

  const handleSourceEditorTypewriterChange = useEffectEvent((view: EditorView) => {
    if (!settings.typewriterModeEnabled) return;
    window.requestAnimationFrame(() => centerSourceEditorLine(view));
  });

  // Stable callback refs for the CodeMirror host. The inline arrow forms
  // would create new identities on every parent render, defeating the
  // memo on <SourceEditorView /> and forcing CodeMirror's host to
  // reconcile on every cursor tick (the visible "text style flicker").
  const handleSourceEditorChange = useEffectEvent((value: string) => {
    setLocalDraft(value);
  });
  const handleSourceEditorStatistics = useEffectEvent((stats: unknown) => {
    setCursorPosition((current) =>
      nextCursorPositionFromStatistics(current, stats as Parameters<typeof nextCursorPositionFromStatistics>[1]),
    );
  });
  const handleSourceEditorCreate = useEffectEvent((view: EditorView) => {
    sourceEditorViewRef.current = view;
  });

  // Clicks landing on the empty padding around the WYSIWYG editor (below the
  // last block, or in the left/right gutters) normally fall through with no
  // visible action because the click never reaches ProseMirror's contentDOM.
  // Translate the coordinates to the nearest document position so the caret
  // lands where the user expected — matching VS Code / IDE conventions.
  const handleWysiwygSurfaceMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editor) return;
    if (currentMode !== 'Wysiwyg' && currentMode !== 'SplitView') return;
    const target = event.target as Node | null;
    if (!target) return;
    const contentDom = editor.view.dom;
    // Click hit the ProseMirror content — let the editor's own handler run.
    if (contentDom.contains(target)) return;
    event.preventDefault();
    const coords = { left: event.clientX, top: event.clientY };
    let pos: number | null = null;
    try {
      const hit = editor.view.posAtCoords(coords);
      if (hit) pos = hit.pos;
    } catch {
      // posAtCoords can throw if the view hasn't laid out yet; fall through
      // to the document-end fallback below.
    }
    if (pos === null) {
      editor.chain().focus('end').run();
      return;
    }
    editor.chain().focus().setTextSelection(pos).run();
  };

  // Mirrors handleWysiwygSurfaceMouseDown for the CodeMirror source surface:
  // clicking the wrapper's padding zone should move the caret to the closest
  // text position, not silently do nothing.
  const handleSourceSurfaceMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const view = sourceEditorViewRef.current;
    if (!view) return;
    if (currentMode !== 'Editor' && currentMode !== 'SplitView') return;
    const target = event.target as Node | null;
    if (!target) return;
    if (view.dom.contains(target)) return;
    event.preventDefault();
    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }, false) ??
      view.state.doc.length;
    focusSourceSelection(pos);
  };

  const handleSplitPreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (currentMode !== 'SplitView') return;
    if (!(event.target instanceof Element)) return;

    const sourceLineElement = event.target.closest<HTMLElement>('[data-source-line]');
    if (!sourceLineElement || !event.currentTarget.contains(sourceLineElement)) return;

    const sourceLine = readSourceNumber(sourceLineElement, 'sourceLine');
    if (sourceLine === null) return;

    const lineStart = getSourceOffsetForLine(sourceLine);
    const lineText = lineTextFromOffset(localDraft, lineStart);
    const sourceOffset = readSourceNumber(sourceLineElement, 'sourceOffset') ?? lineStart;
    const sourceEndOffset =
      readSourceNumber(sourceLineElement, 'sourceEndOffset') ?? lineStart + lineText.length;
    const renderedTextLength = sourceLineElement.textContent?.length ?? 0;
    const renderedOffset =
      getRenderedTextOffset(sourceLineElement, event.clientX, event.clientY) ??
      estimateRenderedTextOffset(sourceLineElement, event, renderedTextLength);
    const selectionOffset = mapRenderedTextOffsetToSourceOffset(
      sourceLineElement,
      localDraft,
      sourceOffset,
      sourceEndOffset,
      renderedOffset,
    );

    focusSourceSelection(selectionOffset);
  };

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSidebarOpen) return;
    event.preventDefault();
    setIsResizingSidebar(true);
  };

  const handleSidebarResetWidth = () => {
    if (!isSidebarOpen) return;
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  };

  const handleSidebarResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSidebarOpen) return;
    let delta = 0;
    let absolute: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        delta = -SIDEBAR_KEYBOARD_STEP;
        break;
      case 'ArrowRight':
        delta = SIDEBAR_KEYBOARD_STEP;
        break;
      case 'PageUp':
        delta = -SIDEBAR_KEYBOARD_PAGE_STEP;
        break;
      case 'PageDown':
        delta = SIDEBAR_KEYBOARD_PAGE_STEP;
        break;
      case 'Home':
        absolute = SIDEBAR_MIN_WIDTH;
        break;
      case 'End':
        absolute = SIDEBAR_MAX_WIDTH;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSidebarWidth((current) =>
      clampSidebarWidth(absolute !== null ? absolute : current + delta),
    );
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMove = (event: PointerEvent) => {
      const next = clampSidebarWidth(event.clientX - 48); // subtract ActivityBar width
      setSidebarWidth(next);
    };

    const handleUp = () => {
      setIsResizingSidebar(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (isResizingSidebar) return;
    writeSidebarWidth(sidebarWidth);
  }, [isResizingSidebar, sidebarWidth]);

  const currentMode = snapshot.mode;

  const publishWysiwygMarkdownDraft = useEffectEvent((markdown: string) => {
    lastEditorMarkdownRef.current = markdown;
    setLocalDraft(markdown);
  });

  const scheduleWysiwygCompositionFlush = useEffectEvent(
    (
      nextEditor:
        | { getMarkdown: () => string; view?: { composing?: boolean } }
        | null
        | undefined,
    ) => {
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
      }

      wysiwygCompositionFlushTimerRef.current = window.setTimeout(() => {
        wysiwygCompositionFlushTimerRef.current = null;
        if (currentMode !== 'Wysiwyg' || !nextEditor) {
          return;
        }
        // CJK IMEs typically chain composition events: compositionend for the
        // current syllable can be immediately followed by compositionstart for
        // the next jamo. Re-check the live composing flags so we don't snapshot
        // a half-formed intermediate document and clobber the in-flight IME.
        if (isWysiwygComposingRef.current || nextEditor.view?.composing) {
          return;
        }

        publishWysiwygMarkdownDraft(nextEditor.getMarkdown());
      }, 0);
    },
  );

  useEffect(() => {
    if (!activeDocumentOpen) {
      lastAnnouncedModeRef.current = currentMode;
      return;
    }

    if (lastAnnouncedModeRef.current === null) {
      lastAnnouncedModeRef.current = currentMode;
      return;
    }

    if (lastAnnouncedModeRef.current !== currentMode) {
      lastAnnouncedModeRef.current = currentMode;
      announceShell(`Mode: ${formatEditorMode(currentMode)}`);
    }
  }, [activeDocumentOpen, currentMode]);

  // Stable refs so memoized editorProps / onUpdate callbacks can always read
  // the latest reactive state without forcing Tiptap to setOptions on every
  // render. The reason these matter: useEditor calls editor.setOptions when
  // any option reference (extensions / editorProps / content) differs across
  // renders, and setOptions ultimately calls view.updateState — which during
  // an active CJK IME composition rebuilds the docView and tears down the
  // in-flight IME, splitting Korean syllables across blocks.
  const currentModeRef = useRef(currentMode);
  useEffect(() => {
    currentModeRef.current = currentMode;
  }, [currentMode]);
  // Most recent markdown source line the WYSIWYG cursor was sitting on.
  // Updated on every Tiptap selection update so mode switches (Option+1/2/3)
  // can hand the caret to the new editor at the equivalent row.
  const wysiwygCursorLineRef = useRef<number>(1);
  // Scroll container the minimap should mirror. Picked from the active editor
  // pane on every mode/lifecycle change.
  const [minimapScrollEl, setMinimapScrollEl] = useState<HTMLElement | null>(null);
  // Tracks the mode the previous render saw so the mode-change effect can
  // tell which editor "owned" the cursor at the moment of the switch.
  const previousModeForCursorRef = useRef<EditorMode>(currentMode);
  const typewriterModeEnabledRef = useRef(settings.typewriterModeEnabled);
  useEffect(() => {
    typewriterModeEnabledRef.current = settings.typewriterModeEnabled;
  }, [settings.typewriterModeEnabled]);

  const wysiwygExtensions = useMemo(
    () => [
      StarterKit.configure({
        link: {
          openOnClick: false,
        },
        trailingNode: false,
        // The default CodeBlock is replaced by CodeBlockLowlight below so the
        // editor gains syntax highlighting + a per-block language picker.
        codeBlock: false,
      }),
      createCodeBlockExtension(),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PreventTableHoverSelection,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: false,
        },
      }),
    ],
    [],
  );

  const wysiwygEditorProps = useMemo(
    () => ({
      attributes: {
        class: `editor-surface tiptap-surface ${MARKDOWN_CONTENT_SCOPE_CLASS}`,
      },
      handleKeyDown: (view: any, event: KeyboardEvent) => {
        // CJK IME guard: ProseMirror's readDOMChange synthesises an Enter
        // keypress via `view.someProp("handleKeyDown", f => f(view, keyEvent(13,
        // "Enter")))` whenever a composition flush sees block-level DOM nodes
        // it didn't dispatch. WebKit Korean IME injects an empty <p> after
        // the heading between syllables and copies the previous syllable into
        // it, which trips that heuristic and would split `# 안녕하세요` into
        // a heading + paragraph. The synthetic event is built via
        // `document.createEvent("Event")` — it is NOT a KeyboardEvent — so
        // `event instanceof KeyboardEvent` reliably distinguishes it from a
        // real Enter press regardless of how Tauri reports `isTrusted`.
        if (
          event.key === 'Enter' &&
          !(event instanceof KeyboardEvent) &&
          (isWysiwygComposingRef.current ||
            (view as { composing?: boolean }).composing ||
            Date.now() - lastWysiwygCompositionEndAtRef.current < 500)
        ) {
          return true;
        }
        if (
          event.key !== 'PageUp' &&
          event.key !== 'PageDown' &&
          event.key !== 'Home' &&
          event.key !== 'End'
        ) return false;
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        const handled = event.key === 'Home' || event.key === 'End'
          ? moveLineBoundaryInProseMirror(
              view,
              event.key === 'Home' ? 'start' : 'end',
              event.shiftKey,
            )
          : movePageInProseMirror(
              view,
              event.key === 'PageDown' ? 1 : -1,
              event.shiftKey,
            );
        if (handled) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      handleTextInput: (view: any, from: number, to: number, text: string) => {
        // CJK IME duplicate-syllable guard. While the user is mid-composition,
        // WebKit's Korean IME dispatches an extra `insertText` call that
        // re-inserts the just-composed syllable AT THE CURSOR (from===to)
        // immediately after the legitimate replace-with-final-form call,
        // producing `# 안안녕하세요` from input `# 안녕하세요`. The duplicate
        // is uniquely recognisable: it is an insertion (no range to replace)
        // whose text exactly matches the characters already sitting just
        // before the insertion point in the editor state. Swallow it.
        //
        // Constraints to avoid false positives:
        //  • Only while a composition is active or has just ended — outside
        //    that window, a user genuinely typing the same syllable twice in
        //    a row (`안안경`, "안전" etc.) must still be honoured.
        //  • Only when from === to (a pure insertion). Replacements are
        //    composition-progress updates and are legitimate.
        const now = Date.now();
        if (
          from === to &&
          text.length > 0 &&
          (isWysiwygComposingRef.current ||
            now - lastWysiwygCompositionEndAtRef.current < 200)
        ) {
          const start = Math.max(0, from - text.length);
          const before = view.state.doc.textBetween(start, from, '\n', '\n');
          if (before === text) {
            return true;
          }
        }
        return false;
      },
      handleDOMEvents: {
        beforeinput: (_view: any, event: Event) => {
          const inputEvent = event as InputEvent;
          if (
            inputEvent.isComposing ||
            inputEvent.inputType === 'insertCompositionText' ||
            (_view as { composing?: boolean }).composing
          ) {
            isWysiwygComposingRef.current = true;
          }
          return false;
        },
        compositionstart: () => {
          isWysiwygComposingRef.current = true;
          if (wysiwygCompositionFlushTimerRef.current !== null) {
            window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
            wysiwygCompositionFlushTimerRef.current = null;
          }
          return false;
        },
        compositionend: (_view: any, event: Event) => {
          isWysiwygComposingRef.current = false;
          lastWysiwygCompositionEndAtRef.current = Date.now();
          lastWysiwygCompositionDataRef.current =
            (event as CompositionEvent).data ?? '';
          scheduleWysiwygCompositionFlush(editorInstanceRef.current);
          return false;
        },
        compositioncancel: () => {
          isWysiwygComposingRef.current = false;
          lastWysiwygCompositionEndAtRef.current = Date.now();
          lastWysiwygCompositionDataRef.current = '';
          scheduleWysiwygCompositionFlush(editorInstanceRef.current);
          return false;
        },
      },
    }),
    // scheduleWysiwygCompositionFlush is a stable useEffectEvent and refs are
    // stable — keep deps empty so this object identity never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleWysiwygUpdate = useEffectEvent(
    ({ editor: nextEditor }: { editor: TiptapEditor }) => {
      if (currentModeRef.current === 'Wysiwyg') {
        if (isWysiwygComposingRef.current || nextEditor.view?.composing) {
          // Keep ProseMirror's editable DOM authoritative during CJK
          // composition. Intermediate jamo states are unstable markdown and
          // must NOT be written to lastEditorMarkdownRef — if they were, a
          // setLocalDraft queued by the prior compositionend flush would
          // later mismatch and trigger setContent, breaking the IME and
          // splitting Korean syllables across lines.
          return;
        }
        const markdown = nextEditor.getMarkdown();
        lastEditorMarkdownRef.current = markdown;
        publishWysiwygMarkdownDraft(markdown);
      }
      if (typewriterModeEnabledRef.current && currentModeRef.current === 'Wysiwyg') {
        window.requestAnimationFrame(() => centerTiptapEditorLine(nextEditor));
      }
    },
  );

  const handleWysiwygSelectionUpdate = useEffectEvent(
    ({ editor: nextEditor }: { editor: TiptapEditor }) => {
      // Mirror the WYSIWYG selection as a markdown source line so mode
      // switches can hand the caret to CodeMirror at the same logical row.
      wysiwygCursorLineRef.current = wysiwygCursorSourceLine(nextEditor);
      if (typewriterModeEnabledRef.current && currentModeRef.current === 'Wysiwyg') {
        window.requestAnimationFrame(() => centerTiptapEditorLine(nextEditor));
      }
    },
  );

  const editor = useEditor({
    extensions: wysiwygExtensions,
    // Initial content only. Subsequent localDraft changes flow in via the
    // dedicated sync useEffect (which itself bails during composition); we do
    // NOT thread localDraft through useEditor's options because that would
    // change the option reference on every keystroke and force a setOptions
    // (and view.updateState) round-trip mid-IME.
    content: '',
    contentType: 'markdown',
    editorProps: wysiwygEditorProps,
    onUpdate: handleWysiwygUpdate,
    onSelectionUpdate: handleWysiwygSelectionUpdate,
    immediatelyRender: false,
  });

  useEffect(() => {
    editorInstanceRef.current = editor;
  }, [editor]);

  const sourceFindResult = useMemo(
    () => findTextMatches(localDraft, findQuery, findOptions),
    [findOptions, findQuery, localDraft],
  );
  const wysiwygFindResult = useMemo(
    () =>
      currentMode === 'Wysiwyg'
        ? findWysiwygTextMatches(editor, findQuery, findOptions)
        : null,
    [currentMode, editor, findOptions, findQuery, localDraft],
  );
  const findResult = wysiwygFindResult ?? sourceFindResult;
  const findMatches = findResult.matches;
  const findMatchCount = findMatches.length;
  const activeFindMatch =
    findMatchCount > 0 ? findMatches[Math.min(activeFindMatchIndex, findMatchCount - 1)] : undefined;
  const canReplaceFindMatch =
    activeDocumentOpen && (currentMode !== 'Wysiwyg' || Boolean(editor));
  const activeFindMatchNumber = findMatchCount > 0
    ? Math.min(activeFindMatchIndex, findMatchCount - 1) + 1
    : 0;

  useEffect(() => {
    if (activeFindMatchIndex >= findMatchCount) {
      setActiveFindMatchIndex(0);
    }
  }, [activeFindMatchIndex, findMatchCount]);

  useEffect(() => {
    if (!isFindReplaceOpen || !activeDocumentOpen) {
      return;
    }
    if (!activeFindMatch) {
      return;
    }

    // Keep keyboard focus on the find input so Enter keeps cycling through
    // matches instead of being swallowed by the editor (where it would insert
    // a newline that overwrites the active selection).
    if (currentMode === 'Wysiwyg') {
      if (editor && isWysiwygFindMatch(activeFindMatch)) {
        selectWysiwygFindMatch(editor, activeFindMatch, { focusEditor: false });
      }
      return;
    }

    focusSourceSelection(activeFindMatch.start, activeFindMatch.end, { focusEditor: false });
  }, [
    activeDocumentOpen,
    activeFindMatch,
    currentMode,
    editor,
    isFindReplaceOpen,
  ]);

  useEffect(() => {
    if (!activeDocumentOpen) {
      setIsFindReplaceOpen(false);
    }
  }, [activeDocumentOpen]);

  const openFindReplace = (replaceMode: boolean) => {
    if (!activeDocumentOpen) {
      return;
    }

    setIsFindReplaceOpen(true);
    setIsFindReplaceReplaceMode(replaceMode);
  };

  const handleFindQueryChange = (query: string) => {
    setFindQuery(query);
    setActiveFindMatchIndex(0);
  };

  const handleFindOptionsChange = (options: FindReplaceOptions) => {
    setFindOptions(options);
    setActiveFindMatchIndex(0);
  };

  const handlePreviousFindMatch = () => {
    if (findMatchCount === 0) return;
    setActiveFindMatchIndex((current) => (current - 1 + findMatchCount) % findMatchCount);
  };

  const handleNextFindMatch = () => {
    if (findMatchCount === 0) return;
    setActiveFindMatchIndex((current) => (current + 1) % findMatchCount);
  };

  const handleReplaceFindMatch = () => {
    if (!canReplaceFindMatch || !activeFindMatch) {
      return;
    }

    if (currentMode === 'Wysiwyg') {
      if (editor && isWysiwygFindMatch(activeFindMatch)) {
        const didReplace = replaceWysiwygTextMatch(editor, activeFindMatch, findReplacement);
        if (didReplace && typeof editor.getMarkdown === 'function') {
          setLocalDraft(editor.getMarkdown());
        }
        setActiveFindMatchIndex((current) => Math.max(0, Math.min(current, findMatchCount - 2)));
      }
      return;
    }

    setLocalDraft((current) => replaceSingleMatch(current, activeFindMatch, findReplacement));
    setActiveFindMatchIndex((current) => Math.max(0, Math.min(current, findMatchCount - 2)));
  };

  const handleReplaceAllFindMatches = () => {
    if (!canReplaceFindMatch || findMatchCount === 0) {
      return;
    }

    if (currentMode === 'Wysiwyg') {
      if (editor) {
        const wysiwygMatches = findMatches.filter(isWysiwygFindMatch);
        const didReplace = replaceWysiwygTextMatches(editor, wysiwygMatches, findReplacement);
        if (didReplace && typeof editor.getMarkdown === 'function') {
          setLocalDraft(editor.getMarkdown());
        }
        setActiveFindMatchIndex(0);
      }
      return;
    }

    setLocalDraft((current) => replaceAllMatches(current, findMatches, findReplacement));
    setActiveFindMatchIndex(0);
  };

  // The Rust-side activeDocumentDirty flag tracks "in-memory source != disk"
  // which stays true after edits even if the user undoes back to the original
  // content. For close/quit prompts we want a strict comparison against the
  // last loaded/saved baseline, mirroring Zed's behavior — "Save changes" only
  // appears when the live content actually differs from what's on disk.
  const tabIsDirty = (tab: DocumentTab) => {
    if (tab.kind !== 'document') return false;
    return tab.id === activeTabId
      ? localDraft !== tab.source
      : tab.draft !== tab.source;
  };
  const activeTab = activeTabId
    ? tabs.find((tab) => tab.id === activeTabId) ?? null
    : null;

  useEffect(() => {
    if (!activeTab) {
      lastAnnouncedTabIdRef.current = null;
      return;
    }

    if (lastAnnouncedTabIdRef.current !== activeTab.id) {
      lastAnnouncedTabIdRef.current = activeTab.id;
      announceShell(`Active tab: ${activeTab.name}`);
    }
  }, [activeTab?.id, activeTab?.name]);

  const isSettingsTabActive = activeTab?.kind === 'settings';
  const hasActiveTabEdits = activeTab ? tabIsDirty(activeTab) : false;
  const hasAnyTabEdits = tabs.some(tabIsDirty);
  // Preserved for the existing Cmd+W close-confirmation surface (which prompts
  // about the active document specifically).
  const hasUnsavedChanges = hasActiveTabEdits;
  const errorMessage = snapshot.lastError;
  const workspaceTree = buildWorkspaceTree(snapshot.workspaceDocuments, snapshot.rootDir);
  const filteredWorkspaceTree = filterWorkspaceTree(workspaceTree, workspaceFilter);
  const filteringWorkspace = workspaceFilter.trim().length > 0;
  const workspaceTreeSignature = `${snapshot.rootDir ?? ''}\u0000${snapshot.workspaceDocuments.join('\u0000')}`;

  const applySnapshot = (next: AppSnapshot, preserveDraft = false) => {
    startTransition(() => {
      setSnapshot(next);
      setExternalChangeMessage(null);
      setShowExternalChangeActions(false);
      setExternalCompareSource(null);
      if (!preserveDraft) {
        setLocalDraft(next.activeDocumentSource ?? '');
      }
    });
  };

  const clearActiveDocumentSurface = () => {
    tabsRef.current = [];
    activeTabIdRef.current = null;
    preSettingsDocTabIdRef.current = null;
    startTransition(() => {
      setTabs([]);
      setActiveTabId(null);
      setLocalDraft('');
      setExternalChangeMessage(null);
      setShowExternalChangeActions(false);
      setExternalCompareSource(null);
      setSnapshot((current) => ({
        ...current,
        activeDocumentName: null,
        activeDocumentPath: null,
        activeDocumentSource: null,
        activeDocumentDirty: false,
        lastError: null,
      }));
    });
  };

  const applyModeOptimistically = (mode: EditorMode) => {
    startTransition(() => {
      setSnapshot((current) => ({ ...current, mode }));
    });
  };

  const reportOperationError = (error: unknown, fallback?: string) => {
    const message = getErrorMessage(error, fallback);
    startTransition(() => {
      setSnapshot((current) => ({ ...current, lastError: message }));
    });
    return message;
  };

  const handleExternalSnapshot = useEffectEvent((next: AppSnapshot) => {
    stashActiveTabDraft();
    applySnapshot(next);
    if (next.activeDocumentSource !== null) {
      upsertActiveTabFromSnapshot(next);
    }
  });

  useEffect(() => {
    let cancelled = false;

    loadSettings()
      .then(async (loadedSettings) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setSettings(loadedSettings);
        });

        let next = await bootstrap();
        if (cancelled) {
          return;
        }

        if (loadedSettings.themeFollowSystem && next.theme.kind !== 'CustomCss') {
          const osKind = resolveOsTheme();
          if (next.theme.kind !== osKind) {
            try {
              const synced = await setTheme(osKind);
              if (!cancelled) {
                next = synced;
              }
            } catch (error) {
              reportOperationError(error, 'Could not follow the system theme');
            }
          }
        }

        if (
          next.activeDocumentSource !== null &&
          loadedSettings.defaultMode !== DEFAULT_SETTINGS.defaultMode &&
          next.mode !== loadedSettings.defaultMode
        ) {
          try {
            next = await setMode(loadedSettings.defaultMode);
          } catch (error) {
            reportOperationError(error, 'Could not apply the default startup mode');
          }
          if (cancelled) {
            return;
          }
        }

        applySnapshot(next);
        if (next.activeDocumentSource !== null) {
          upsertActiveTabFromSnapshot(next, {
            markStartupTabsReady: true,
            preserveSettingsActive: true,
          });
          return;
        }

        try {
          let persistedTabs = await loadOpenTabs();
          if (cancelled) return;
          if (persistedTabs.openTabs.length === 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, STARTUP_OPEN_TABS_RETRY_MS);
            });
            if (cancelled) return;
            const retriedTabs = await loadOpenTabs();
            if (cancelled) return;
            if (retriedTabs.openTabs.length > 0) {
              persistedTabs = retriedTabs;
            }
          }
          if (persistedTabs.openTabs.length === 0) {
            setStartupTabsReady(true);
            return;
          }
          const restored: DocumentTab[] = [];
          for (const path of persistedTabs.openTabs) {
            try {
              const opened = await openDocument(path);
              restored.push({
                id: generateTabId(),
                kind: 'document',
                path: opened.activeDocumentPath ?? path,
                name: opened.activeDocumentName ?? displayFileName(path),
                source: opened.activeDocumentSource ?? '',
                draft: opened.activeDocumentSource ?? '',
                missing: false,
              });
            } catch {
              // File is gone — keep the tab as a missing-file placeholder.
              restored.push({
                id: generateTabId(),
                kind: 'document',
                path,
                name: displayFileName(path),
                source: '',
                draft: '',
                missing: true,
              });
            }
          }
          if (cancelled) return;
          const activePath = persistedTabs.activeTabPath;
          const target = activePath
            ? restored.find((tab) => tab.path === activePath)
            : restored[0];
          const currentTabs = tabsRef.current;
          const currentActiveId = activeTabIdRef.current;
          const currentDocumentTabs = currentTabs.filter((tab) => tab.kind === 'document');
          const currentUiTabs = currentTabs.filter((tab) => tab.kind !== 'document');
          const currentDocumentPaths = new Set(currentDocumentTabs.map((tab) => tab.path));
          const restoredAdditions = restored.filter((tab) => !currentDocumentPaths.has(tab.path));
          let mergedTabs = [...currentDocumentTabs, ...restoredAdditions, ...currentUiTabs];
          const currentActiveStillExists =
            currentActiveId !== null && mergedTabs.some((tab) => tab.id === currentActiveId);
          const nextActiveId = currentActiveStillExists
            ? currentActiveId
            : target?.id ?? mergedTabs[0]?.id ?? null;
          const nextActiveTab = nextActiveId
            ? mergedTabs.find((tab) => tab.id === nextActiveId) ?? null
            : null;
          let nextSnapshot: AppSnapshot | null = null;
          let nextLocalDraft: string | null = null;

          if (nextActiveTab?.kind === 'document' && nextActiveTab.path && !nextActiveTab.missing) {
            try {
              nextSnapshot = await openDocument(nextActiveTab.path);
              nextLocalDraft = nextSnapshot.activeDocumentSource ?? '';
            } catch {
              mergedTabs = mergedTabs.map((tab) =>
                tab.id === nextActiveTab.id
                  ? { ...tab, missing: true, source: '', draft: '' }
                  : tab,
              );
              nextLocalDraft = '';
            }
          } else if (nextActiveTab?.kind === 'document' && nextActiveTab.missing) {
            nextLocalDraft = '';
          }

          tabsRef.current = mergedTabs;
          activeTabIdRef.current = nextActiveId;
          startTransition(() => {
            if (nextSnapshot) {
              setSnapshot(nextSnapshot);
              setExternalChangeMessage(null);
              setShowExternalChangeActions(false);
              setExternalCompareSource(null);
              setLocalDraft(nextLocalDraft ?? '');
            } else if (nextLocalDraft !== null) {
              setLocalDraft(nextLocalDraft);
            }
            setTabs(mergedTabs);
            setActiveTabId(nextActiveId);
            setStartupTabsReady(true);
          });
        } catch (error) {
          if (!cancelled) {
            reportOperationError(error, 'Could not restore previous tabs');
            setStartupTabsReady(true);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          reportOperationError(error, 'Could not start Markdowner');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsChange = (next: Settings) => {
    const changedKeys = SETTINGS_KEYS.filter((key) => !Object.is(settings[key], next[key]));
    setSettings(next);
    const saveSettingsPromise = saveSettings(next);
    void saveSettingsPromise;
    if (changedKeys.includes('themeFollowSystem') && next.themeFollowSystem) {
      void setTheme(resolveOsTheme())
        .then((synced) => applySnapshot(synced, true))
        .catch(() => undefined);
    }
    if (next.diagnosticsEnabled) {
      void saveSettingsPromise.then(() =>
        recordDiagnosticsEvent('settings.changed', {
          changedKeys,
          diagnosticsEnabled: next.diagnosticsEnabled,
        }),
      );
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleOsThemeChange = async () => {
      if (!settings.themeFollowSystem) {
        return;
      }
      try {
        const next = await setTheme(resolveOsTheme());
        applySnapshot(next, true);
      } catch (error) {
        reportOperationError(error, 'Could not follow the system theme');
      }
    };
    mediaQuery.addEventListener('change', handleOsThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleOsThemeChange);
    };
  }, [settings.themeFollowSystem]);

  useEffect(() => {
    applyThemeSelection(snapshot.theme.kind);
    applyImportedStylesheet(snapshot);
  }, [snapshot]);

  useEffect(() => {
    document.title = buildWindowTitle(snapshot);
  }, [snapshot]);

  // Persist open tabs whenever the tab list or active tab changes. Only
  // path-bearing tabs are saved; untitled drafts stay session-local.
  useEffect(() => {
    if (!startupTabsReady) return;

    const paths = tabs
      .map((tab) => tab.path)
      .filter((path): path is string => path !== null);
    const activePath = (() => {
      if (!activeTabId) return null;
      const active = tabs.find((tab) => tab.id === activeTabId);
      return active?.path ?? null;
    })();
    void saveOpenTabs({ openTabs: paths, activeTabPath: activePath }).catch((error) => {
      console.warn('[Markdowner] Failed to persist open tabs:', error);
    });
  }, [tabs, activeTabId, startupTabsReady]);

  useEffect(() => {
    const nextFolderKeys = new Set<string>();
    collectWorkspaceFolderKeys(workspaceTree, nextFolderKeys);
    setCollapsedFolderKeys((current) => current.filter((key) => nextFolderKeys.has(key)));
  }, [workspaceTreeSignature]);

  useEffect(() => {
    setWorkspaceFilter('');
  }, [snapshot.rootDir]);

  useEffect(() => {
    if (snapshot.activeDocumentSource === null) {
      return;
    }
    if (localDraft === (snapshot.activeDocumentSource ?? '')) {
      return;
    }

    const activeDocumentPath = snapshot.activeDocumentPath;
    const timeout = window.setTimeout(() => {
      replaceActiveDocumentSource(localDraft)
        .then((next) => {
          startTransition(() => {
            setSnapshot((current) => {
              if (current.activeDocumentPath !== activeDocumentPath) {
                return current;
              }
              return { ...next, mode: current.mode };
            });
            setExternalChangeMessage(null);
            setShowExternalChangeActions(false);
            setExternalCompareSource(null);
          });
        })
        .catch(() => undefined);
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [localDraft, snapshot.activeDocumentPath, snapshot.activeDocumentSource, snapshot.mode]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const tabChanged = activeTabId !== lastEditorActiveTabIdRef.current;

    // Only push localDraft into the editor when it changed *externally* (file
    // load, undo from menu, drag-and-drop, …). Editor-authored updates are
    // tracked via lastEditorMarkdownRef in onUpdate, so we skip the costly
    // setContent in that case — which would otherwise interrupt IME
    // composition and produce duplicated/split-line output.
    //
    // Exception: when the active tab changes, always re-sync. Otherwise two
    // tabs with identical markdown (two empty drafts, two copies of the same
    // file, …) would leave the editor showing the previous tab's ProseMirror
    // state — which is exactly the "previous file's content reappears" bug.
    if (!tabChanged && localDraft === lastEditorMarkdownRef.current) {
      return;
    }

    // CJK IME safety net: never call setContent while a composition is in
    // flight. Even when the ref/draft compare above looks like a legitimate
    // external change, replacing the doc mid-composition destroys the
    // ProseMirror docView and reseats the cursor — Korean syllables after the
    // first one then land in a new paragraph below the heading. The flush
    // scheduled by compositionend will re-trigger this effect with both
    // values realigned once composition actually finishes.
    if (isWysiwygComposingRef.current || editor.view?.composing) {
      return;
    }

    // emitUpdate:false prevents Tiptap from firing onUpdate, which would
    // setLocalDraft to a possibly-renormalized markdown string and
    // re-trigger this effect indefinitely (React error #185).
    lastEditorMarkdownRef.current = localDraft;
    lastEditorActiveTabIdRef.current = activeTabId;
    editor.commands.setContent(localDraft || '', {
      contentType: 'markdown',
      emitUpdate: false,
    });
  }, [editor, localDraft, activeTabId]);

  const previewSource = activeDocumentOpen
    ? debouncedLocalDraft
    : '*Open a Markdown document to preview it.*';
  const sourceEditorExtensions = useMemo(
    () => [
      markdown(),
      ...(settings.editorLineWrap ? [EditorView.lineWrapping] : []),
      ...(settings.focusModeEnabled ? [sourceFocusModeExtension] : []),
      ...(settings.typewriterModeEnabled ? [sourceTypewriterModeExtension] : []),
      EditorView.updateListener.of((update) => {
        if (update.viewportChanged) {
          handleSourceEditorViewportChange(update.view.scrollDOM);
        }
        if (update.selectionSet || update.docChanged || update.focusChanged) {
          handleSourceEditorTypewriterChange(update.view);
        }
      }),
    ],
    [
      handleSourceEditorTypewriterChange,
      handleSourceEditorViewportChange,
      settings.editorLineWrap,
      settings.focusModeEnabled,
      settings.typewriterModeEnabled,
    ],
  );

  useEffect(() => {
    if (!settings.typewriterModeEnabled || !sourceEditorViewRef.current) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (sourceEditorViewRef.current) {
        centerSourceEditorLine(sourceEditorViewRef.current);
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [settings.typewriterModeEnabled, currentMode]);

  useEffect(() => {
    if (!settings.typewriterModeEnabled || !editor) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      centerTiptapEditorLine(editor);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [settings.typewriterModeEnabled, currentMode, editor]);

  const withBusy = async (action: () => Promise<void>, fallback?: string) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportOperationError(error, fallback);
    } finally {
      setBusy(false);
    }
  };

  const hasExternalChanges = async () => {
    if (!activeDocumentOpen || !snapshot.activeDocumentPath) {
      setExternalChangeMessage(null);
      setShowExternalChangeActions(false);
      setExternalCompareSource(null);
      return false;
    }

    try {
      const changed = await hasActiveDocumentExternalChanges();
      if (!changed) {
        setExternalChangeMessage(null);
        setShowExternalChangeActions(false);
        setExternalCompareSource(null);
        return false;
      }

      setExternalChangeMessage(
        `Could not save '${snapshot.activeDocumentName ?? 'Untitled.md'}' because it changed on disk.`,
      );
      setShowExternalChangeActions(true);
      setExternalCompareSource(null);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExternalChangeMessage(
        `Could not verify external changes for '${snapshot.activeDocumentName ?? 'Untitled.md'}': ${reason}`,
      );
      setShowExternalChangeActions(false);
      setExternalCompareSource(null);
      return true;
    }
  };

  const syncActiveDraft = async (preserveMode: EditorMode = snapshot.mode) => {
    if (!activeDocumentOpen || snapshot.activeDocumentSource === null) {
      return;
    }

    if (localDraft === snapshot.activeDocumentSource) {
      return;
    }

    const synced = await replaceActiveDocumentSource(localDraft);
    applySnapshot({ ...synced, mode: preserveMode }, true);
  };

  const syncActiveDraftBestEffort = async (preserveMode: EditorMode = snapshot.mode) => {
    try {
      await syncActiveDraft(preserveMode);
    } catch {
      // The tab model already keeps the user's local draft. Navigation and
      // view changes should not get stuck behind a best-effort backend sync.
    }
  };

  const handleNewDocument = async () => {
    // If an Untitled tab already exists, just switch to it instead of stacking
    // multiple Untitled drafts (Rust only models a single untitled document).
    const existingUntitled = findTabByPath(null);
    if (existingUntitled) {
      void switchToTab(existingUntitled.id);
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      if (isEditorOpStale(token)) return;
      const next = await newDocument();
      if (isEditorOpStale(token)) return;
      applySnapshot(next);
      upsertActiveTabFromSnapshot(next);
    });
  };

  const handleOpenDocument = async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
    });

    if (selected === null || selected === undefined) {
      return;
    }
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) {
      return;
    }

    // Single-path shortcut: just switch if it's already open.
    if (paths.length === 1) {
      const existing = findTabByPath(paths[0]);
      if (existing) {
        void switchToTab(existing.id);
        return;
      }
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      if (isEditorOpStale(token)) return;

      // Accumulate new tabs locally so we can commit them in one batched
      // update at the end. Per-iteration setTabs would overwrite earlier
      // additions because each call reads the same stale closure value.
      const additions: DocumentTab[] = [];
      let lastSnapshot: AppSnapshot | null = null;
      let lastActiveId: string | null = null;

      for (const path of paths) {
        const existing =
          findTabByPath(path) ?? additions.find((tab) => tab.path === path);
        if (existing) {
          lastActiveId = existing.id;
          continue;
        }
        const next = await openDocument(path);
        if (isEditorOpStale(token)) return;
        const tab: DocumentTab = {
          id: generateTabId(),
          kind: 'document',
          path: next.activeDocumentPath ?? path,
          name: next.activeDocumentName ?? path,
          source: next.activeDocumentSource ?? '',
          draft: next.activeDocumentSource ?? '',
          missing: false,
        };
        additions.push(tab);
        lastSnapshot = next;
        lastActiveId = tab.id;
      }

      if (additions.length > 0 && lastSnapshot && lastActiveId) {
        const finalActiveId = lastActiveId;
        startTransition(() => {
          setTabs((prev) => [...prev, ...additions]);
          setActiveTabId(finalActiveId);
        });
        applySnapshot(lastSnapshot);
      } else if (lastActiveId) {
        // Every selected file was already open — switch to the last one.
        void switchToTab(lastActiveId);
      }
    });
  };

  const handleOpenWorkspace = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: true,
    });

    if (typeof selected !== 'string') {
      return;
    }

    await withBusy(async () => {
      await syncActiveDraftBestEffort();
      const next = await openWorkspace(selected);
      applySnapshot(next, true);
    });
  };

  const handleSave = async () => {
    if (!activeDocumentOpen) {
      return;
    }
    if (!snapshot.activeDocumentPath) {
      await handleSaveAs();
      return;
    }

    await withBusy(async () => {
      await syncActiveDraft();
      if (await hasExternalChanges()) {
        return;
      }
      const next = await saveActiveDocument();
      applySnapshot(next, true);
      refreshActiveTabFromSnapshot(next);
    });
  };

  const saveActiveDocumentForClose = async () => {
    if (!activeDocumentOpen) {
      return true;
    }

    if (!snapshot.activeDocumentPath) {
      const selected = await saveDialog({
        defaultPath: snapshot.activeDocumentPath ?? snapshot.activeDocumentName ?? 'Untitled.md',
        filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
      });

      if (typeof selected !== 'string') {
        return false;
      }

      await syncActiveDraft();
      const next = await saveActiveDocumentAs(selected);
      applySnapshot(next, true);
      return true;
    }

    await syncActiveDraft();
    if (await hasExternalChanges()) {
      return false;
    }
    const next = await saveActiveDocument();
    applySnapshot(next, true);
    return true;
  };

  const closeOnlyRemainingTab = useEffectEvent(async () => {
    if (!hasActiveTabEdits) {
      clearActiveDocumentSurface();
      return;
    }

    if (busy) {
      return;
    }

    try {
      const decision = await message(
        `Save changes to '${snapshot.activeDocumentName ?? 'Untitled.md'}' before closing?`,
        {
          title: WINDOW_TITLE,
          kind: 'warning',
          buttons: {
            yes: 'Save',
            no: "Don't Save",
            cancel: 'Cancel',
          },
        },
      );

      if (isSaveCloseDecision(decision)) {
        await withBusy(async () => {
          const saved = await saveActiveDocumentForClose();
          if (saved) {
            clearActiveDocumentSurface();
          }
        });
        return;
      }

      if (isDiscardCloseDecision(decision)) {
        clearActiveDocumentSurface();
        return;
      }

      if (decision !== undefined) {
        console.warn('Unrecognized close decision:', decision);
      }
    } catch (error) {
      reportOperationError(error, 'Could not close tab');
    }
  });

  const handleReloadActiveDocument = async () => {
    if (!activeDocumentOpen || !snapshot.activeDocumentPath) {
      return;
    }

    await withBusy(async () => {
      const next = await openDocument(snapshot.activeDocumentPath ?? '');
      applySnapshot(next);
    });
  };

  const handleKeepLocalChanges = () => {
    setExternalChangeMessage(null);
    setShowExternalChangeActions(false);
    setExternalCompareSource(null);
  };

  const handleCompareExternalChanges = async () => {
    if (!activeDocumentOpen) {
      return;
    }

    try {
      const source = await activeDocumentDiskSource();
      setExternalCompareSource(source);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExternalChangeMessage(
        `Could not read disk version of '${snapshot.activeDocumentName ?? 'Untitled.md'}': ${reason}`,
      );
      setShowExternalChangeActions(false);
    }
  };

  const handleImportTheme = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'CSS', extensions: ['css'] }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    await withBusy(async () => {
      const next = await importTheme(selected);
      applySnapshot(next, true);
    });
  };

  const handleSaveAs = async () => {
    if (!activeDocumentOpen) {
      return;
    }

    const selected = await saveDialog({
      defaultPath: snapshot.activeDocumentPath ?? snapshot.activeDocumentName ?? 'Untitled.md',
      filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    await withBusy(async () => {
      await syncActiveDraft();
      const next = await saveActiveDocumentAs(selected);
      applySnapshot(next, true);
      refreshActiveTabFromSnapshot(next);
    });
  };

  const triggerAutoSave = useEffectEvent(() => {
    if (!settings.autoSave) return;
    if (busy) return;
    if (!activeDocumentOpen) return;
    if (!snapshot.activeDocumentPath) return;
    if (!hasUnsavedChanges) return;
    void handleSave();
  });

  useEffect(() => {
    if (!settings.autoSave) return;
    if (!activeDocumentOpen) return;
    if (!snapshot.activeDocumentPath) return;
    if (!hasUnsavedChanges) return;

    const timer = window.setTimeout(() => {
      triggerAutoSave();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    settings.autoSave,
    activeDocumentOpen,
    snapshot.activeDocumentPath,
    hasUnsavedChanges,
    localDraft,
  ]);

  // Resolve the scroll element the minimap should mirror. For Source / Split
  // we want CodeMirror's scrollDOM (the cm-scroller); for WYSIWYG we want the
  // outer pane wrapper. Re-runs whenever the editor instance, the active
  // document, or the current mode change.
  useEffect(() => {
    if (!settings.showMinimap || !activeDocumentOpen) {
      setMinimapScrollEl(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (currentMode === 'Wysiwyg') {
        const pane = document.querySelector<HTMLElement>(
          '[data-testid="editor-surface-wysiwyg"]',
        );
        setMinimapScrollEl(pane);
        return;
      }
      const scroll = sourceEditorViewRef.current?.scrollDOM ?? null;
      setMinimapScrollEl(scroll);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentMode, activeDocumentOpen, settings.showMinimap, editor]);

  // Cursor handoff between WYSIWYG ↔ Source on mode change. Captures the
  // logical line the user was on in the *previous* mode and replays it in
  // the new one once the editor surface has actually mounted/laid out.
  useEffect(() => {
    const previousMode = previousModeForCursorRef.current;
    previousModeForCursorRef.current = currentMode;
    if (previousMode === currentMode) return;
    if (!activeDocumentOpen) return;

    const sourceLine =
      previousMode === 'Wysiwyg'
        ? wysiwygCursorLineRef.current
        : cursorPosition.line;
    if (!Number.isFinite(sourceLine) || sourceLine < 1) return;

    // Defer to the next frame so the editor pane that just became visible
    // has measured layout — focus()/setSelection on a display:none element
    // is a silent no-op in Chromium-based webviews.
    const frame = window.requestAnimationFrame(() => {
      if (currentMode === 'Wysiwyg') {
        const editorInstance = editorInstanceRef.current;
        if (!editorInstance) return;
        const pos = wysiwygPositionAtSourceLine(editorInstance, sourceLine);
        if (pos === null) {
          editorInstance.chain().focus().run();
          return;
        }
        editorInstance.chain().focus().setTextSelection(pos).run();
        return;
      }
      // Editor or SplitView — the source pane owns the caret.
      const offset = getSourceOffsetForLine(sourceLine);
      focusSourceSelection(offset);
    });
    return () => window.cancelAnimationFrame(frame);
    // We intentionally omit cursorPosition.line and getSourceOffsetForLine —
    // their identity changes on every selection update / draft edit and
    // would re-trigger this effect mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode, activeDocumentOpen]);

  const handleSetMode = useEffectEvent(async (nextMode: EditorMode) => {
    // Always read snapshot/localDraft from the latest state via useEffectEvent
    // so concurrent menu, palette, and keyboard chord paths agree on the truth.
    if (snapshot.mode === nextMode) {
      return;
    }

    const requestId = modeRequestIdRef.current + 1;
    modeRequestIdRef.current = requestId;
    const previousMode = snapshot.mode;
    applyModeOptimistically(nextMode);

    try {
      const next = await setMode(nextMode);
      if (modeRequestIdRef.current !== requestId) {
        return;
      }
      applySnapshot({ ...next, mode: nextMode }, true);
    } catch (error) {
      if (modeRequestIdRef.current === requestId) {
        reportOperationError(error, 'Could not switch editor mode');
        applyModeOptimistically(previousMode);
      }
    }
  });

  const handleSetTheme = async (themeKind: ThemeKind) => {
    await withBusy(async () => {
      if (settings.themeFollowSystem) {
        handleSettingsChange({ ...settings, themeFollowSystem: false });
      }
      const next = await setTheme(themeKind);
      applySnapshot(next, true);
    });
  };

  const handleFollowSystemTheme = async () => {
    await withBusy(async () => {
      if (!settings.themeFollowSystem) {
        handleSettingsChange({ ...settings, themeFollowSystem: true });
      }
      const next = await setTheme(resolveOsTheme());
      applySnapshot(next, true);
    });
  };

  const handleOpenWorkspaceDocument = async (path: string) => {
    const existing = findTabByPath(path);
    if (existing) {
      void switchToTab(existing.id);
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      if (isEditorOpStale(token)) return;
      const next = await openWorkspaceDocument(path);
      if (isEditorOpStale(token)) return;
      applySnapshot(next);
      upsertActiveTabFromSnapshot(next);
    });
  };

  const handleOpenRecentDocument = async (path: string) => {
    const existing = findTabByPath(path);
    if (existing) {
      void switchToTab(existing.id);
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      if (isEditorOpStale(token)) return;
      const next = await openDocument(path);
      if (isEditorOpStale(token)) return;
      applySnapshot(next);
      upsertActiveTabFromSnapshot(next);
    });
  };

  const handleToggleWorkspaceFolder = (key: string) => {
    setCollapsedFolderKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  };

  const handleCollapseWorkspaceFolders = () => {
    const nextFolderKeys = new Set<string>();
    collectWorkspaceFolderKeys(workspaceTree, nextFolderKeys);
    setCollapsedFolderKeys(Array.from(nextFolderKeys));
  };

  // Switch to an existing tab. Stashes the outgoing tab's draft, drives Rust's
  // active document to the target's path (or a fresh untitled), then restores
  // the target tab's previously stashed draft as the live editor content.
  const switchToTab = useEffectEvent(async (targetId: string) => {
    if (targetId === activeTabId) return;
    const target = tabs.find((tab) => tab.id === targetId);
    if (!target) return;

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      if (isEditorOpStale(token)) return;

      try {
        if (target.kind === 'settings') {
          // Settings is a UI-only surface — stay on the current snapshot but
          // hand the active-tab pointer to the settings tab so the editor
          // area swaps to SettingsPanel.
          setActiveTabId(target.id);
          return;
        }
        if (target.missing && target.path) {
          // Missing files: stay on the empty editor; do not call into Rust.
          setActiveTabId(target.id);
          setLocalDraft('');
          return;
        }
        let next: AppSnapshot;
        if (target.path) {
          next = await openDocument(target.path);
        } else {
          next = await newDocument();
        }
        if (isEditorOpStale(token)) return;
        // preserveDraft so we can immediately swap to the stashed draft
        applySnapshot(next, true);
        setActiveTabId(target.id);
        // Restore the target's stashed draft so unsaved edits survive switching.
        setLocalDraft(target.draft);
        // Refresh tab metadata in case the file changed on disk.
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === target.id
              ? {
                  ...tab,
                  source: next.activeDocumentSource ?? tab.source,
                  name: next.activeDocumentName ?? tab.name,
                  path: next.activeDocumentPath ?? tab.path,
                  missing: false,
                }
              : tab,
          ),
        );
      } catch {
        if (isEditorOpStale(token)) return;
        // The file disappeared between sessions — convert this tab to missing.
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === target.id ? { ...tab, missing: true, source: '', draft: '' } : tab,
          ),
        );
        setActiveTabId(target.id);
        setLocalDraft('');
      }
    });
  });

  const handleCloseTab = useEffectEvent(async (targetId: string) => {
    const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
    if (targetIndex < 0) return;
    const target = tabs[targetIndex];

    const remaining = tabs.filter((tab) => tab.id !== targetId);

    // Closing the settings tab is always a clean operation — it owns no
    // document state and the Rust snapshot did not change while it was on
    // screen, so we set activeTabId directly and never round-trip through
    // openDocument (which would refetch the previously-active doc).
    if (target.kind === 'settings') {
      if (remaining.length === 0) {
        clearActiveDocumentSurface();
        return;
      }

      if (targetId === activeTabId) {
        const restoreId = preSettingsDocTabIdRef.current;
        const restoreTab = restoreId
          ? remaining.find((tab) => tab.id === restoreId)
          : null;
        const fallback =
          restoreTab ?? remaining[targetIndex] ?? remaining[targetIndex - 1] ?? remaining[0] ?? null;
        setActiveTabId(fallback?.id ?? null);
      }
      preSettingsDocTabIdRef.current = null;
      setTabs(remaining);
      return;
    }

    // Closing the last document tab clears the document surface while keeping
    // the application window open. Dirty documents still get the save prompt.
    if (remaining.length === 0) {
      await closeOnlyRemainingTab();
      return;
    }

    if (targetId === activeTabId) {
      // Pick a neighbor to activate first, then drop the closed tab.
      const fallback = remaining[targetIndex] ?? remaining[targetIndex - 1] ?? remaining[0];
      await switchToTab(fallback.id);
      setTabs((prev) => prev.filter((tab) => tab.id !== targetId));
    } else {
      setTabs(remaining);
    }
  });

  // Open (or focus, or close) the Settings tab. Cmd+, and the gear icon both
  // route through here — when the settings tab is already active it toggles
  // closed, matching the old modal toggle behavior.
  const toggleSettingsTab = useEffectEvent(async () => {
    const existing = tabs.find((tab) => tab.kind === 'settings');
    if (existing) {
      if (existing.id === activeTabId) {
        await handleCloseTab(existing.id);
        return;
      }
      preSettingsDocTabIdRef.current = activeTabId;
      setActiveTabId(existing.id);
      return;
    }

    // Stash but do not sync — opening settings keeps the Rust active document
    // exactly as-is so closing settings can restore it without re-opening.
    stashActiveTabDraft();
    preSettingsDocTabIdRef.current = activeTabId;
    const settingsTab: DocumentTab = {
      id: SETTINGS_TAB_ID,
      kind: 'settings',
      path: null,
      name: SETTINGS_TAB_NAME,
      source: '',
      draft: '',
      missing: false,
    };
    startTransition(() => {
      setTabs((prev) => [...prev, settingsTab]);
      setActiveTabId(SETTINGS_TAB_ID);
    });
  });

  const handleNativeMenuCommand = useEffectEvent(async (command: string) => {
    if (busy) {
      return;
    }

    if (command.startsWith('open-recent-document:')) {
      await handleOpenRecentDocument(command.slice('open-recent-document:'.length));
      return;
    }

    switch (command) {
      case 'new-document':
        await handleNewDocument();
        return;
      case 'open-document':
        await handleOpenDocument();
        return;
      case 'open-workspace':
        await handleOpenWorkspace();
        return;
      case 'save-active-document':
        await handleSave();
        return;
      case 'save-active-document-as':
        await handleSaveAs();
        return;
      case MENU_COMMAND_CLOSE_WINDOW:
        await handleCloseTabOrWindow();
        return;
      case MENU_COMMAND_QUIT_APP:
        await handleQuitCommand();
        return;
      case 'mode-wysiwyg':
        await handleSetMode('Wysiwyg');
        return;
      case 'mode-editor':
        await handleSetMode('Editor');
        return;
      case 'mode-splitview':
        await handleSetMode('SplitView');
        return;
      default:
    }
  });

  const renderWorkspaceTreeNode = (node: WorkspaceTreeNode, depth = 0) => {
    if (node.kind === 'folder') {
      const collapsed = !filteringWorkspace && collapsedFolderKeys.includes(node.key);

      return (
        <div key={node.key} className="flex flex-col">
          <button
            type="button"
            className="explorer-tree-row flex w-full items-center gap-1.5 text-left text-xs text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-expanded={!collapsed}
            data-explorer-row=""
            onClick={() => handleToggleWorkspaceFolder(node.key)}
            style={{ paddingLeft: `${4 + depth * 12}px` }}
          >
            {collapsed ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{node.name}</span>
          </button>
          {!collapsed ? (
            <div className="flex flex-col">
              {node.children.map((child) => renderWorkspaceTreeNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }

    const isActive = node.path === snapshot.activeDocumentPath;

    return (
      <button
        key={node.key}
        type="button"
        className={cn(
          'explorer-tree-row flex w-full items-center gap-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
          isActive && 'bg-accent text-accent-foreground',
        )}
        data-explorer-row=""
        onClick={() => handleOpenWorkspaceDocument(node.path)}
        style={{ paddingLeft: `${24 + depth * 12}px` }}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{node.name}</span>
        <span className="sr-only" aria-hidden="true">{node.relativePath}</span>
      </button>
    );
  };

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      if (busy) {
        return;
      }
      if (event.isComposing || event.key === 'Process') {
        return;
      }

      // Global Escape: dismiss the Find/Replace bar from anywhere. The bar's
      // own container handler stops propagation when focus is inside it, so
      // this branch only runs when focus is elsewhere (editor, sidebar, etc.).
      if (
        event.key === 'Escape' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        isFindReplaceOpenRef.current
      ) {
        event.preventDefault();
        setIsFindReplaceOpen(false);
        return;
      }

      // Resolve a pending Cmd+K chord (Cmd+K → Cmd+W/E/S, with or without the
      // second Cmd held). This must run before single-key handlers so the
      // second stroke is not consumed by, e.g., the Cmd+W close-window shortcut.
      if (chordPrefixActiveRef.current) {
        const key = event.key.toLowerCase();
        if (key === 'meta' || key === 'control' || key === 'shift' || key === 'alt') {
          return;
        }
        clearChordPrefix();
        if (event.altKey || event.shiftKey) {
          return;
        }
        if (key === 'w') {
          event.preventDefault();
          void handleSetMode('Wysiwyg');
          return;
        }
        if (key === 'e') {
          event.preventDefault();
          void handleSetMode('Editor');
          return;
        }
        if (key === 's') {
          event.preventDefault();
          void handleSetMode('SplitView');
          return;
        }
        // Unknown chord completion — drop quietly.
        return;
      }

      if (matchesShortcut(event, 'n')) {
        event.preventDefault();
        void handleNewDocument();
        return;
      }

      // Cmd+T opens a new (untitled) tab — handleNewDocument creates a new
      // tab when one does not already exist and switches to it otherwise.
      if (matchesShortcut(event, 't')) {
        event.preventDefault();
        void handleNewDocument();
        return;
      }

      if (matchesShortcut(event, 'o', { shift: true })) {
        event.preventDefault();
        void handleOpenWorkspace();
        return;
      }

      if (matchesShortcut(event, 'e', { shift: true })) {
        event.preventDefault();
        handleShowExplorerPanel();
        focusExplorerTree();
        return;
      }

      if (matchesShortcut(event, 'b', { shift: true })) {
        event.preventDefault();
        handleToggleSidebar();
        return;
      }

      if (matchesShortcut(event, ',')) {
        event.preventDefault();
        void toggleSettingsTab();
        return;
      }

      if (matchesShortcut(event, '/')) {
        event.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
        return;
      }

      if (
        usesCommandModifier(event) &&
        event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        openFindReplace(true);
        return;
      }

      if (matchesShortcut(event, 'f', { shift: true })) {
        event.preventDefault();
        handleFocusSearchPanel();
        return;
      }

      if (matchesShortcut(event, 'd', { shift: true })) {
        event.preventDefault();
        handleOpenOutlinePanel();
        return;
      }

      if (matchesShortcut(event, 'f')) {
        event.preventDefault();
        // VS Code parity: when focus is inside the Explorer, Cmd+F filters
        // the file tree by name instead of opening the document find widget.
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement?.closest('[data-explorer-root]')) {
          focusExplorerFilter();
          return;
        }
        if (activeDocumentOpen) {
          openFindReplace(false);
        } else {
          handleFocusSearchPanel();
        }
        return;
      }

      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'h'
      ) {
        event.preventDefault();
        openFindReplace(true);
        return;
      }

      if (matchesShortcut(event, 'p', { shift: true })) {
        event.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (matchesShortcut(event, 'p')) {
        event.preventDefault();
        setIsQuickOpenOpen((prev) => !prev);
        return;
      }

      if (matchesShortcut(event, 'i', { shift: true })) {
        if (!activeDocumentOpen) {
          return;
        }

        event.preventDefault();
        setIsDocumentStatsOpen((prev) => !prev);
        return;
      }

      if (matchesShortcut(event, 'o')) {
        event.preventDefault();
        void handleOpenDocument();
        return;
      }

      if (matchesShortcut(event, 's', { shift: true })) {
        event.preventDefault();
        void handleSaveAs();
        return;
      }

      if (matchesShortcut(event, 's')) {
        event.preventDefault();
        void handleSave();
        return;
      }

      if (matchesShortcut(event, 'q')) {
        event.preventDefault();
        void handleQuitCommand();
        return;
      }

      if (matchesShortcut(event, 'w')) {
        event.preventDefault();
        void handleCloseTabOrWindow();
        return;
      }

      // Cmd+Shift+] / Cmd+Shift+[ → next / previous tab (wrapping). Users see
      // these as ⌘} / ⌘{ since `{` and `}` are Shift-bracket on US/KR layouts.
      if (
        usesCommandModifier(event) &&
        event.shiftKey &&
        !event.altKey &&
        (event.key === ']' || event.key === '}')
      ) {
        event.preventDefault();
        if (tabs.length > 0 && activeTabId) {
          const idx = tabs.findIndex((tab) => tab.id === activeTabId);
          if (idx >= 0) {
            const next = tabs[(idx + 1) % tabs.length];
            if (next && next.id !== activeTabId) {
              void switchToTab(next.id);
            }
          }
        }
        return;
      }
      if (
        usesCommandModifier(event) &&
        event.shiftKey &&
        !event.altKey &&
        (event.key === '[' || event.key === '{')
      ) {
        event.preventDefault();
        if (tabs.length > 0 && activeTabId) {
          const idx = tabs.findIndex((tab) => tab.id === activeTabId);
          if (idx >= 0) {
            const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
            if (prev && prev.id !== activeTabId) {
              void switchToTab(prev.id);
            }
          }
        }
        return;
      }

      // Ctrl+Shift+PageUp / PageDown → move active tab left / right (no wrap),
      // matching VS Code "Move Editor Left/Right".
      if (
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        (event.key === 'PageUp' || event.key === 'PageDown')
      ) {
        event.preventDefault();
        if (tabs.length > 0 && activeTabId) {
          const direction = event.key === 'PageDown' ? 1 : -1;
          setTabs((prev) => moveTab(prev, activeTabId, direction));
        }
        return;
      }

      // Cmd+K starts a chord. Subsequent Cmd+W/E/S (or plain w/e/s) selects a view mode.
      if (matchesShortcut(event, 'k')) {
        event.preventDefault();
        clearChordPrefix();
        chordPrefixActiveRef.current = true;
        chordPrefixTimerRef.current = window.setTimeout(() => {
          chordPrefixActiveRef.current = false;
          chordPrefixTimerRef.current = null;
        }, CHORD_PREFIX_TIMEOUT_MS);
        return;
      }

      // Cmd+0 toggles between the Explorer and the active editor. When Outline
      // is already visible, it focuses the Outline rows instead of replacing
      // the current sidebar panel with Explorer. When focus is already inside
      // the Explorer, Cmd+0 sends focus back to the active editor surface.
      if (event.key === '0' && usesCommandModifier(event) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (isSidebarOpen && sidebarPanel === 'outline') {
          focusOutlineTree();
          return;
        }
        if (isFocusInsideExplorer()) {
          focusActiveEditor();
        } else {
          handleShowExplorerPanel();
          focusExplorerTree();
        }
        return;
      }

      // Cmd+1..9 → tab index 0..8. 10+ tabs have no shortcut; the keypress is
      // still consumed so it doesn't fall through. Regardless of where focus
      // started, send the caret into the editor surface for the targeted tab
      // so the user can resume typing immediately.
      if (event.key.length === 1 && /[1-9]/.test(event.key) && usesCommandModifier(event) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const tabIndex = Number.parseInt(event.key, 10) - 1;
        const target = tabs[tabIndex];
        if (target && target.id !== activeTabId) {
          void switchToTab(target.id);
        }
        if (target) {
          focusActiveEditor();
        }
        return;
      }

      // Alt+1 → WYSIWYG, Alt+2 → Editor, Alt+3 → Split-view. macOS Option
      // produces non-ASCII glyphs in event.key (¡/™/£), so match on event.code.
      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3')
      ) {
        event.preventDefault();
        const nextMode: EditorMode =
          event.code === 'Digit1'
            ? 'Wysiwyg'
            : event.code === 'Digit2'
              ? 'Editor'
              : 'SplitView';
        void handleSetMode(nextMode);
        return;
      }

      if (matchesShortcut(event, 't', { shift: true })) {
        event.preventDefault();
        handleSettingsChange({ ...settings, typewriterModeEnabled: !settings.typewriterModeEnabled });
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcut);

    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcut);
      clearChordPrefix();
    };
  }, [busy, isSidebarOpen, localDraft, sidebarPanel, snapshot, settings, tabs, activeTabId]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<string>(MENU_COMMAND_EVENT, (event) => {
      void handleNativeMenuCommand(event.payload);
    })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        reportOperationError(error, 'Could not listen for native menu commands');
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<AppSnapshot>(SNAPSHOT_UPDATE_EVENT, (event) => {
      handleExternalSnapshot(event.payload);
    })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        reportOperationError(error, 'Could not listen for external file opens');
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const forceCloseRef = useRef(false);

  const closeTarget = async (target: CloseTarget) => {
    forceCloseRef.current = true;
    if (target === 'app') {
      await quitApp();
      return;
    }

    await getCurrentWindow().destroy();
  };

  const handleWindowCloseRequest = useEffectEvent(
    async (event: { preventDefault: () => void }, target: CloseTarget = 'window') => {
      // Once the user picked Save (after a successful save) or Don't Save, let any
      // re-entrant close request from Tauri pass through without re-prompting.
      if (forceCloseRef.current) {
        return;
      }

      // Native window close gates on the active tab; app quit (Cmd+Q) gates on
      // any tab having edits, matching Zed's behavior.
      const requiresPrompt =
        target === 'app' ? hasAnyTabEdits : hasActiveTabEdits;
      if (!requiresPrompt) {
        return;
      }

      event.preventDefault();

      if (busy) {
        return;
      }

      // For a quit with multiple tabs, switch to the first dirty tab so the
      // dialog and the subsequent Save action operate on a real dirty doc.
      if (target === 'app' && !hasActiveTabEdits) {
        const firstDirty = tabs.find(tabIsDirty);
        if (firstDirty && firstDirty.id !== activeTabId) {
          await switchToTab(firstDirty.id);
        }
      }

      try {
        const decision = await message(
          `Save changes to '${snapshot.activeDocumentName ?? 'Untitled.md'}' before closing?`,
          {
            title: WINDOW_TITLE,
            kind: 'warning',
            buttons: {
              yes: 'Save',
              no: "Don't Save",
              cancel: 'Cancel',
            },
          },
        );

        if (isSaveCloseDecision(decision)) {
          await withBusy(async () => {
            const saved = await saveActiveDocumentForClose();
            if (saved) {
              await closeTarget(target);
            }
          });
          return;
        }

        if (isDiscardCloseDecision(decision)) {
          await closeTarget(target);
          return;
        }

        if (decision !== undefined) {
          // Unrecognized decision (e.g., Cancel or unexpected platform value) — keep window open.
          console.warn('Unrecognized close decision:', decision);
        }
      } catch (error) {
        reportOperationError(error, 'Could not close Markdowner');
      }
    },
  );

  const handleWindowCloseCommand = async () => {
    const currentWindow = getCurrentWindow();
    let prevented = false;

    await handleWindowCloseRequest({
      preventDefault: () => {
        prevented = true;
      },
    });

    if (!prevented) {
      await currentWindow.destroy();
    }
  };

  // Cmd+W / File → Close:
  // - 0 tabs (nothing open): close the window directly. There is nothing to
  //   be dirty about, so skip the close confirmation flow entirely.
  // - 1+ tabs: close the active tab. The final tab leaves the window open on
  //   the empty document surface after any required dirty confirmation.
  const handleCloseTabOrWindow = useEffectEvent(async () => {
    if (tabs.length === 0) {
      await getCurrentWindow().destroy();
      return;
    }

    const targetId = activeTabId ?? tabs[0]?.id;
    if (targetId) {
      await handleCloseTab(targetId);
    }
  });

  const handleQuitCommand = async () => {
    let prevented = false;

    await handleWindowCloseRequest(
      {
        preventDefault: () => {
          prevented = true;
        },
      },
      'app',
    );

    if (!prevented) {
      await quitApp();
    }
  };

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        await handleWindowCloseRequest(event);
      })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }

        unlisten = nextUnlisten;
      })
      .catch((error) => {
        reportOperationError(error, 'Could not listen for close requests');
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === 'drop') {
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            const firstPath = paths[0];
            if (!firstPath) return;
            await withBusy(async () => {
              stashActiveTabDraft();
              await syncActiveDraftBestEffort();
              const next = await openDroppedPath(firstPath);
              const openedDocument =
                next.activeDocumentSource !== null && next.activeDocumentPath === firstPath;
              applySnapshot(next, !openedDocument);
              if (openedDocument) {
                upsertActiveTabFromSnapshot(next);
              }
            });
          }
        }
      })
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        reportOperationError(error, 'Could not listen for dropped files');
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const documentMeta = snapshot.activeDocumentPath
    ? displayWorkspacePath(snapshot.activeDocumentPath, snapshot.rootDir)
    : activeDocumentOpen
      ? 'Save As to choose where this draft lives.'
      : 'Open a workspace or a Markdown file to begin.';

  const quickOpenItems: QuickOpenItem[] = (() => {
    const seen = new Set<string>();
    const items: QuickOpenItem[] = [];
    const accumulate = (paths: readonly string[], kind: 'workspace' | 'recent') => {
      for (const path of paths) {
        if (!path || seen.has(path)) continue;
        seen.add(path);
        items.push({
          path,
          name: displayFileName(path),
          relativePath: displayWorkspacePath(path, snapshot.rootDir),
          kind,
        });
      }
    };
    accumulate(snapshot.workspaceDocuments, 'workspace');
    accumulate(snapshot.recentDocuments, 'recent');
    return items;
  })();

  const handleQuickOpenSelect = (path: string) => {
    if (snapshot.workspaceDocuments.includes(path)) {
      void handleOpenWorkspaceDocument(path);
    } else {
      void handleOpenRecentDocument(path);
    }
  };

  const paletteCommands: CommandPaletteCommand[] = [
    {
      id: 'file.new',
      category: 'File',
      label: 'New Document',
      shortcut: '⌘N',
      run: () => void handleNewDocument(),
    },
    {
      id: 'file.open',
      category: 'File',
      label: 'Open File…',
      shortcut: '⌘O',
      run: () => void handleOpenDocument(),
    },
    {
      id: 'file.openWorkspace',
      category: 'File',
      label: 'Open Workspace…',
      shortcut: '⌘⇧O',
      run: () => void handleOpenWorkspace(),
    },
    {
      id: 'file.save',
      category: 'File',
      label: 'Save',
      shortcut: '⌘S',
      disabled: !activeDocumentOpen,
      run: () => void handleSave(),
    },
    {
      id: 'file.saveAs',
      category: 'File',
      label: 'Save As…',
      shortcut: '⌘⇧S',
      disabled: !activeDocumentOpen,
      run: () => void handleSaveAs(),
    },
    {
      id: 'view.toggleSidebar',
      category: 'View',
      label: 'Toggle Sidebar',
      shortcut: '⌘⇧B',
      run: () => handleToggleSidebar(),
    },
    {
      id: 'view.showExplorer',
      category: 'View',
      label: 'Show Explorer',
      shortcut: '⌘⇧E',
      run: () => {
        handleShowExplorerPanel();
        focusExplorerTree();
      },
    },
    {
      id: 'view.toggleOutline',
      category: 'View',
      label: 'Toggle Outline',
      shortcut: '⌘⇧D',
      run: () => handleOpenOutlinePanel(),
    },
    {
      id: 'view.quickOpen',
      category: 'View',
      label: 'Quick Open File…',
      shortcut: '⌘P',
      run: () => setIsQuickOpenOpen(true),
    },
    {
      id: 'view.searchInFiles',
      category: 'View',
      label: 'Search: Find in Files',
      shortcut: '⌘⇧F',
      run: () => handleFocusSearchPanel(),
    },
    {
      id: 'view.findInFile',
      category: 'View',
      label: 'Find in Current File',
      shortcut: '⌘F',
      disabled: !activeDocumentOpen,
      run: () => openFindReplace(false),
    },
    ...EDITOR_MODE_OPTIONS.map((option) => ({
      id: `view.mode.${option.mode}`,
      category: 'View',
      label: `Mode: ${option.label}`,
      shortcut: option.shortcutSymbol,
      run: () => void handleSetMode(option.mode),
    })),
    {
      id: 'preferences.toggleFocusMode',
      category: 'Preferences',
      label: settings.focusModeEnabled ? 'Disable Focus Mode' : 'Enable Focus Mode',
      run: () => handleSettingsChange({ ...settings, focusModeEnabled: !settings.focusModeEnabled }),
    },
    {
      id: 'preferences.toggleTypewriterMode',
      category: 'Preferences',
      label: settings.typewriterModeEnabled ? 'Disable Typewriter Mode' : 'Enable Typewriter Mode',
      shortcut: '⌘⇧T',
      run: () => handleSettingsChange({ ...settings, typewriterModeEnabled: !settings.typewriterModeEnabled }),
    },
    {
      id: 'preferences.toggleWordWrap',
      category: 'Preferences',
      label: settings.editorLineWrap ? 'Disable Word Wrap' : 'Enable Word Wrap',
      run: () =>
        handleSettingsChange({ ...settings, editorLineWrap: !settings.editorLineWrap }),
    },
    {
      id: 'preferences.toggleAutoSave',
      category: 'Preferences',
      label: settings.autoSave ? 'Disable Auto Save' : 'Enable Auto Save',
      run: () => handleSettingsChange({ ...settings, autoSave: !settings.autoSave }),
    },
    {
      id: 'app.settings',
      category: 'Preferences',
      label: 'Open Settings',
      shortcut: '⌘,',
      run: () => void toggleSettingsTab(),
    },
    {
      id: 'app.installCliLauncher',
      category: 'Preferences',
      label: 'Install Markdowner in PATH',
      run: () => {
        void (async () => {
          try {
            const result = await installCliLauncher();
            announceShell(
              result.alreadyInstalled
                ? `Markdowner CLI already installed in ${result.shellConfigPath}`
                : `Installed Markdowner CLI in ${result.shellConfigPath}`,
            );
          } catch (error) {
            reportOperationError(error, 'Could not install Markdowner CLI launcher');
          }
        })();
      },
    },
    {
      id: 'app.documentStats',
      category: 'Preferences',
      label: 'Open Document Stats',
      shortcut: '⌘⇧I',
      disabled: !activeDocumentOpen,
      run: () => setIsDocumentStatsOpen(true),
    },
    {
      id: 'preferences.resetDefaults',
      category: 'Preferences',
      label: 'Reset Settings to Defaults',
      run: () => handleSettingsChange({ ...DEFAULT_SETTINGS }),
    },
    {
      id: 'theme.light',
      category: 'Theme',
      label: 'Theme: Light',
      run: () => void handleSetTheme('BuiltInLight'),
    },
    {
      id: 'theme.dark',
      category: 'Theme',
      label: 'Theme: Dark',
      run: () => void handleSetTheme('BuiltInDark'),
    },
    {
      id: 'theme.system',
      category: 'Theme',
      label: 'Theme: Follow System',
      run: () => void handleFollowSystemTheme(),
    },
    {
      id: 'theme.import',
      category: 'Theme',
      label: 'Import CSS Theme…',
      run: () => void handleImportTheme(),
    },
  ];

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
      data-diagnostics-enabled={String(settings.diagnosticsEnabled)}
    >
      <div
        data-testid="shell-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        dir="auto"
        className="sr-only"
      >
        {shellAnnouncement}
      </div>
      <div
        data-testid="app-titlebar"
        className="flex h-[35px] shrink-0 items-center border-b border-border/60 bg-background"
      >
        <div
          data-tauri-drag-region
          className="h-full w-20 shrink-0"
          onPointerDown={handleStartWindowDrag}
        />
        <div
          data-tauri-drag-region
          data-testid="app-titlebar-drag-region"
          className="h-full min-w-0 flex-1"
          onPointerDown={handleStartWindowDrag}
        />
        <AppMenu
          className="mr-2"
          busy={busy}
          activeDocumentOpen={activeDocumentOpen}
          currentMode={currentMode}
          modeOptions={EDITOR_MODE_OPTIONS}
          themeKind={snapshot.theme.kind}
          themeMode={themeMode}
          onSave={() => void handleSave()}
          onSaveAs={() => void handleSaveAs()}
          onImportTheme={() => void handleImportTheme()}
          onSetMode={(mode) => void handleSetMode(mode)}
          onSetTheme={(theme) => void handleSetTheme(theme)}
          onFollowSystemTheme={() => void handleFollowSystemTheme()}
          onOpenSettings={() => void toggleSettingsTab()}
        />
      </div>
      <div
        className={cn(
          'min-h-0 flex-1 grid',
          !isResizingSidebar && 'transition-[grid-template-columns] duration-300 ease-in-out',
        )}
        style={{
          gridTemplateColumns: isSidebarOpen
            ? `48px ${sidebarWidth}px 4px minmax(0, 1fr)`
            : '48px 0px 0px minmax(0, 1fr)',
        }}
      >
        <ActivityBar
          onOpenSettings={() => void toggleSettingsTab()}
          onOpenSearch={handleToggleSearchPanel}
          onOpenOutline={handleOpenOutlinePanel}
          onToggleSidebar={handleOpenFilesPanel}
          isSidebarOpen={isSidebarOpen && sidebarPanel === 'files'}
          isSettingsOpen={isSettingsTabActive}
          isSearchOpen={isSidebarOpen && sidebarPanel === 'search'}
          isOutlineOpen={isSidebarOpen && sidebarPanel === 'outline'}
        />
        <SideBar
          panel={sidebarPanel}
          isOpen={isSidebarOpen}
          busy={busy}
          workspaceName={snapshot.rootDir ? displayFileName(snapshot.rootDir) : null}
          workspaceFilter={workspaceFilter}
          onWorkspaceFilterChange={setWorkspaceFilter}
          workspaceTreeLength={workspaceTree.length}
          filteredWorkspaceTreeLength={filteredWorkspaceTree.length}
          openEditors={tabs.map((tab) => ({
            id: tab.id,
            name: tab.name,
            path: tab.path,
            isActive: tab.id === activeTabId,
            isDirty:
              tab.kind === 'settings'
                ? false
                : tab.id === activeTabId
                ? localDraft !== tab.source
                : tab.draft !== tab.source,
            missing: tab.missing,
          }))}
          recentDocuments={snapshot.recentDocuments}
          activeDocumentPath={snapshot.activeDocumentPath}
          rootDir={snapshot.rootDir}
          onNewDocument={() => void handleNewDocument()}
          onOpenDocument={() => void handleOpenDocument()}
          onOpenWorkspace={() => void handleOpenWorkspace()}
          onCollapseWorkspaceFolders={handleCollapseWorkspaceFolders}
          onSelectOpenEditor={(id) => void switchToTab(id)}
          onCloseOpenEditor={(id) => void handleCloseTab(id)}
          onOpenRecentDocument={handleOpenRecentDocument}
          renderWorkspaceTreeNodes={() => filteredWorkspaceTree.map((node) => renderWorkspaceTreeNode(node))}
          displayFileName={displayFileName}
          displayWorkspacePath={displayWorkspacePath}
          outlineItems={outlineItems}
          outlineFontSize={Math.min(
            OUTLINE_FONT_SIZE_MAX,
            Math.max(
              OUTLINE_FONT_SIZE_MIN,
              settings.outlineFontSize || DEFAULT_SETTINGS.outlineFontSize,
            ),
          )}
          outlineRowSpacing={Math.min(
            OUTLINE_ROW_SPACING_MAX,
            Math.max(
              OUTLINE_ROW_SPACING_MIN,
              settings.outlineRowSpacing ?? DEFAULT_SETTINGS.outlineRowSpacing,
            ),
          )}
          onSelectOutlineItem={handleSelectOutlineItem}
          searchQuery={searchQuery}
          searchOptions={searchOptions}
          searchResults={searchResults}
          searchBusy={searchBusy}
          searchError={searchError}
          searchHasRun={searchHasRun}
          searchAutoFocusToken={searchFocusToken}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchOptionsChange={handleSearchOptionsChange}
          onRunSearch={() => void handleRunWorkspaceSearch()}
          onSelectSearchMatch={(file, match) => void handleSelectSearchMatch(file, match)}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          title="Drag to resize sidebar (double-click to reset, arrow keys to adjust)"
          tabIndex={isSidebarOpen ? 0 : -1}
          onPointerDown={handleSidebarResizeStart}
          onDoubleClick={handleSidebarResetWidth}
          onKeyDown={handleSidebarResizeKeyDown}
          className={cn(
            'group relative h-full select-none',
            isSidebarOpen ? 'cursor-col-resize' : 'pointer-events-none',
          )}
          style={{ touchAction: 'none' }}
        >
          <div
            className={cn(
              'absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border transition-colors',
              isResizingSidebar && 'bg-primary',
              isSidebarOpen && 'group-hover:bg-primary/60',
            )}
          />
        </div>

      <div className="flex min-h-0 min-w-0 flex-col">
        <Tabs
          items={tabs.map((tab, index) => ({
            id: tab.id,
            kind: tab.kind,
            name: tab.name,
            isDirty:
              tab.kind === 'settings'
                ? false
                : tab.id === activeTabId
                ? localDraft !== tab.source
                : tab.draft !== tab.source,
            missing: tab.missing,
            shortcutLabel:
              index < 9 ? `⌘${index + 1}` : index === 9 ? '⌘0' : null,
          }))}
          activeTabId={activeTabId}
          onSelectTab={(id) => void switchToTab(id)}
          onCloseTab={(id) => void handleCloseTab(id)}
        />
      {isSettingsTabActive ? (
        <SettingsPanel
          settings={settings}
          onSettingsChange={handleSettingsChange}
          currentTheme={
            settings.themeFollowSystem
              ? 'system'
              : snapshot.theme.kind === 'BuiltInDark'
                ? 'dark'
                : 'light'
          }
          onThemeChange={(choice) => {
            if (choice === 'system') {
              void handleFollowSystemTheme();
            } else if (choice === 'dark') {
              void handleSetTheme('BuiltInDark');
            } else {
              void handleSetTheme('BuiltInLight');
            }
          }}
        />
      ) : null}
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', isSettingsTabActive && 'hidden')}>
      <EditorArea
        busy={busy}
        errorMessage={errorMessage}
        externalChangeMessage={externalChangeMessage}
        showExternalChangeActions={showExternalChangeActions}
        externalCompareSource={externalCompareSource}
        activeDocumentOpen={activeDocumentOpen}
        currentMode={currentMode}
        onReloadActiveDocument={() => void handleReloadActiveDocument()}
        onKeepLocalChanges={handleKeepLocalChanges}
        onCompareExternalChanges={() => void handleCompareExternalChanges()}
        onHideComparison={() => setExternalCompareSource(null)}
        onNewDocument={() => void handleNewDocument()}
        onOpenDocument={() => void handleOpenDocument()}
        onOpenWorkspace={() => void handleOpenWorkspace()}
        localDraft={localDraft}
        findReplaceBar={
          isFindReplaceOpen ? (
            <FindReplaceBar
              query={findQuery}
              replacement={findReplacement}
              replaceMode={isFindReplaceReplaceMode}
              options={findOptions}
              activeMatchNumber={activeFindMatchNumber}
              matchCount={findMatchCount}
              error={findResult.error}
              canReplace={canReplaceFindMatch}
              onQueryChange={handleFindQueryChange}
              onReplacementChange={setFindReplacement}
              onReplaceModeChange={setIsFindReplaceReplaceMode}
              onOptionsChange={handleFindOptionsChange}
              onPreviousMatch={handlePreviousFindMatch}
              onNextMatch={handleNextFindMatch}
              onReplace={handleReplaceFindMatch}
              onReplaceAll={handleReplaceAllFindMatches}
              onClose={() => setIsFindReplaceOpen(false)}
            />
          ) : null
        }
        fontSize={settings.editorFontSize || DEFAULT_SETTINGS.editorFontSize}
        fontFamily={settings.editorFontFamily}
        focusModeEnabled={settings.focusModeEnabled}
        typewriterModeEnabled={settings.typewriterModeEnabled}
        lineWrap={settings.editorLineWrap}
        wrapColumn={settings.editorWrapColumn || DEFAULT_SETTINGS.editorWrapColumn}
        splitSourceRef={splitSourceScrollRef}
        splitPreviewRef={splitPreviewScrollRef}
        onSplitSourceScroll={handleSplitSourceScroll}
        onSplitPreviewScroll={handleSplitPreviewScroll}
        onSplitPreviewClick={handleSplitPreviewClick}
        onSourceSurfaceMouseDown={handleSourceSurfaceMouseDown}
        onWysiwygSurfaceMouseDown={handleWysiwygSurfaceMouseDown}
        minimapEnabled={settings.showMinimap}
        minimapScrollEl={minimapScrollEl}
        tableDensity={settings.tableDensity}
        editorContent={
          <>
            <EditorContent editor={editor} />
            <SlashCommandMenu editor={editor} enabled={currentMode === 'Wysiwyg'} />
            <SelectionToolbar editor={editor} enabled={currentMode === 'Wysiwyg'} />
            <TableToolbar editor={editor} enabled={currentMode === 'Wysiwyg'} />
          </>
        }
        sourceEditor={
          <SourceEditorView
            value={localDraft}
            extensions={sourceEditorExtensions}
            theme={snapshot.theme.kind === 'BuiltInDark' ? 'dark' : 'light'}
            onChange={handleSourceEditorChange}
            onStatistics={handleSourceEditorStatistics}
            onCreateEditor={handleSourceEditorCreate}
            containerRef={sourceEditorContainerRef}
          />
        }
        splitViewPreview={
          <div
            className={cn(
              'markdown-surface flex-1 px-8 py-6',
              MARKDOWN_CONTENT_SCOPE_CLASS,
            )}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={sourceLineMarkdownComponents}
            >
              {previewSource}
            </ReactMarkdown>
          </div>
        }
      />
      </div>
      </div>
      </div>
      <QuickOpen
        open={isQuickOpenOpen}
        onOpenChange={setIsQuickOpenOpen}
        items={quickOpenItems}
        onSelect={handleQuickOpenSelect}
      />
      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        commands={paletteCommands}
      />
      <DocumentStatsDialog
        open={isDocumentStatsOpen}
        onOpenChange={setIsDocumentStatsOpen}
        documentName={snapshot.activeDocumentName}
        documentPath={snapshot.activeDocumentPath}
        stats={documentStats}
      />
      <ShortcutsDialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} />

      <StatusBar
        mode={formatEditorMode(currentMode)}
        theme={formatThemeLabel(snapshot.theme.kind)}
        busy={busy}
        isDirty={activeDocumentOpen ? snapshot.activeDocumentDirty : null}
        documentName={snapshot.activeDocumentName}
        documentPath={snapshot.activeDocumentPath}
        workspaceName={snapshot.rootDir ? displayFileName(snapshot.rootDir) : null}
        activeDocumentLabel={
          snapshot.activeDocumentPath
            ? displayWorkspacePath(snapshot.activeDocumentPath, snapshot.rootDir)
            : null
        }
        cursorLine={currentMode === 'Wysiwyg' ? null : cursorPosition.line}
        cursorColumn={currentMode === 'Wysiwyg' ? null : cursorPosition.column}
        wordCount={activeDocumentOpen ? documentStats.words : null}
        characterCount={activeDocumentOpen ? documentStats.characters : null}
        readingTimeMinutes={activeDocumentOpen ? documentStats.readingTimeMinutes : null}
      />
    </div>
  );
}
