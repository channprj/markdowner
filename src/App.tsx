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
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
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
import { cn } from '@/lib/utils';
import { ActivityBar } from '@/shell/ActivityBar';
import { AppMenu } from '@/shell/AppMenu';
import { CommandPalette, type CommandPaletteCommand } from '@/shell/CommandPalette';
import { DocumentStatsDialog } from '@/shell/DocumentStatsDialog';
import { EditorArea } from '@/shell/EditorArea';
import { FindReplaceBar } from '@/shell/FindReplaceBar';
import { Tabs } from '@/shell/Tabs';
import { QuickOpen, type QuickOpenItem } from '@/shell/QuickOpen';
import { SideBar, type OutlineItem, type SideBarPanel } from '@/shell/SideBar';
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
} from './lib/desktop';
import {
  findTextMatches,
  replaceAllMatches,
  replaceSingleMatch,
  type FindReplaceOptions,
} from './lib/findReplace';
import { nextCursorPositionFromStatistics } from './lib/cursorPosition';
import {
  DEFAULT_SETTINGS,
  OUTLINE_FONT_SIZE_MAX,
  OUTLINE_FONT_SIZE_MIN,
  OUTLINE_ROW_SPACING_MAX,
  OUTLINE_ROW_SPACING_MIN,
  type Settings,
  loadSettings,
  recordDiagnosticsEvent,
  saveSettings,
} from './lib/settings';
import { moveTab } from './lib/tabs';
import {
  MARKDOWN_CONTENT_SCOPE_CLASS,
  scopeImportedStylesheet,
} from './lib/themeScope';

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

function filterWorkspaceTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return nodes;
  }

  const filteredNodes: WorkspaceTreeNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'file') {
      const haystack = `${node.name}\u0000${node.relativePath}`.toLowerCase();
      if (haystack.includes(normalizedQuery)) {
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
  { mode: 'Editor', label: 'Editor', shortcutSymbol: '⌘K ⌘E', shortcutText: 'Cmd+K Cmd+E', ariaKeyshortcuts: 'Meta+K Meta+E' },
  { mode: 'Wysiwyg', label: 'WYSIWYG', shortcutSymbol: '⌘K ⌘W', shortcutText: 'Cmd+K Cmd+W', ariaKeyshortcuts: 'Meta+K Meta+W' },
  { mode: 'SplitView', label: 'Split View', shortcutSymbol: '⌘K ⌘S', shortcutText: 'Cmd+K Cmd+S', ariaKeyshortcuts: 'Meta+K Meta+S' },
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
    options: { reuseTabId?: string | null; markStartupTabsReady?: boolean } = {},
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
    // If the user has opened the Settings tab while this async path was in
    // flight, don't yank focus away — just keep the doc tab in the tab strip.
    const currentActive = activeTabIdRef.current;
    const currentActiveIsSettings =
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
    return matches.map((match, index) => ({
      id: `${index}-${match.index ?? index}`,
      depth: match[1]?.length ?? 1,
      title: (match[2] ?? '').trim(),
      selectionStart: match.index ?? 0,
      selectionEnd: (match.index ?? 0) + match[0].trimEnd().length,
    }));
  }, [activeDocumentOpen, localDraft]);
  const sourceLineStartOffsets = useMemo(() => buildLineStartOffsets(localDraft), [localDraft]);
  const themeMode: ThemeMode = settings.themeFollowSystem ? 'system' : 'manual';

  const getSourceOffsetForLine = (lineNumber: number) => {
    if (!Number.isFinite(lineNumber) || lineNumber < 1) {
      return 0;
    }
    return sourceLineStartOffsets[lineNumber - 1] ?? localDraft.length;
  };

  const focusSourceSelection = (selectionStart: number, selectionEnd = selectionStart) => {
    const nextSelectionStart = clampSelectionOffset(selectionStart, localDraft.length);
    const nextSelectionEnd = clampSelectionOffset(selectionEnd, localDraft.length);
    const selection = { anchor: nextSelectionStart, head: nextSelectionEnd };

    if (sourceEditorViewRef.current) {
      sourceEditorViewRef.current.dispatch({ selection, scrollIntoView: true });
      sourceEditorViewRef.current.focus();
      return;
    }

    const sourceTextarea = sourceEditorContainerRef.current?.querySelector('textarea');
    if (sourceTextarea instanceof HTMLTextAreaElement) {
      sourceTextarea.focus();
      sourceTextarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    }
  };

  const handleStartWindowDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  };

  const handleToggleSidebar = useEffectEvent(() => {
    setIsSidebarOpen((current) => {
      const next = !current;
      writeSidebarState(next);
      announceShell(
        next ? `${sidebarPanel === 'outline' ? 'Outline' : 'Files'} sidebar shown` : 'Sidebar hidden',
      );
      return next;
    });
  });

  const handleOpenFilesPanel = useEffectEvent(() => {
    setSidebarPanel('files');
    setIsSidebarOpen((current) => {
      const next = current && sidebarPanel === 'files' ? !current : true;
      writeSidebarState(next);
      announceShell(next ? 'Files sidebar shown' : 'Sidebar hidden');
      return next;
    });
  });

  const handleOpenOutlinePanel = useEffectEvent(() => {
    setSidebarPanel('outline');
    setIsSidebarOpen(true);
    writeSidebarState(true);
    announceShell('Outline sidebar shown');
  });

  const handleSelectOutlineItem = useEffectEvent((item: OutlineItem) => {
    if (currentMode === 'Wysiwyg') {
      return;
    }

    focusSourceSelection(item.selectionStart, item.selectionEnd);
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

  const findResult = useMemo(
    () => findTextMatches(localDraft, findQuery, findOptions),
    [findOptions, findQuery, localDraft],
  );
  const findMatches = findResult.matches;
  const findMatchCount = findMatches.length;
  const activeFindMatch =
    findMatchCount > 0 ? findMatches[Math.min(activeFindMatchIndex, findMatchCount - 1)] : undefined;
  const canReplaceFindMatch = activeDocumentOpen && currentMode !== 'Wysiwyg';
  const activeFindMatchNumber = findMatchCount > 0
    ? Math.min(activeFindMatchIndex, findMatchCount - 1) + 1
    : 0;

  useEffect(() => {
    if (activeFindMatchIndex >= findMatchCount) {
      setActiveFindMatchIndex(0);
    }
  }, [activeFindMatchIndex, findMatchCount]);

  useEffect(() => {
    if (!isFindReplaceOpen || !activeDocumentOpen || currentMode === 'Wysiwyg') {
      return;
    }
    if (!activeFindMatch) {
      return;
    }

    focusSourceSelection(activeFindMatch.start, activeFindMatch.end);
  }, [
    activeDocumentOpen,
    activeFindMatch,
    currentMode,
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

    setLocalDraft((current) => replaceSingleMatch(current, activeFindMatch, findReplacement));
    setActiveFindMatchIndex((current) => Math.max(0, Math.min(current, findMatchCount - 2)));
  };

  const handleReplaceAllFindMatches = () => {
    if (!canReplaceFindMatch || findMatchCount === 0) {
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
          upsertActiveTabFromSnapshot(next, { markStartupTabsReady: true });
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
        },
      }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: false,
        },
      }),
    ],
    content: localDraft || '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: `editor-surface tiptap-surface ${MARKDOWN_CONTENT_SCOPE_CLASS}`,
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      if (currentMode === 'Wysiwyg') {
        setLocalDraft(nextEditor.getMarkdown());
      }
      if (settings.typewriterModeEnabled && currentMode === 'Wysiwyg') {
        window.requestAnimationFrame(() => centerTiptapEditorLine(nextEditor));
      }
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      if (settings.typewriterModeEnabled && currentMode === 'Wysiwyg') {
        window.requestAnimationFrame(() => centerTiptapEditorLine(nextEditor));
      }
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const markdownFromEditor = editor.getMarkdown();
    if (markdownFromEditor !== localDraft) {
      // emitUpdate:false prevents Tiptap from firing onUpdate, which would
      // setLocalDraft to a possibly-renormalized markdown string and
      // re-trigger this effect indefinitely (React error #185).
      editor.commands.setContent(localDraft || '', {
        contentType: 'markdown',
        emitUpdate: false,
      });
    }
  }, [editor, localDraft]);

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

    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      const next = await newDocument();
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

    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();

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

    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      const next = await openWorkspaceDocument(path);
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

    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();
      const next = await openDocument(path);
      applySnapshot(next);
      upsertActiveTabFromSnapshot(next);
    });
  };

  const handleToggleWorkspaceFolder = (key: string) => {
    setCollapsedFolderKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  };

  // Switch to an existing tab. Stashes the outgoing tab's draft, drives Rust's
  // active document to the target's path (or a fresh untitled), then restores
  // the target tab's previously stashed draft as the live editor content.
  const switchToTab = useEffectEvent(async (targetId: string) => {
    if (targetId === activeTabId) return;
    const target = tabs.find((tab) => tab.id === targetId);
    if (!target) return;

    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort();

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

    // Closing the last document tab → fall through to window-close behavior so
    // the existing dirty-confirmation dialog runs and the user can save first.
    if (remaining.length === 0) {
      await handleWindowCloseCommand();
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
        <div key={node.key} className="flex flex-col gap-1">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={!collapsed}
            onClick={() => handleToggleWorkspaceFolder(node.key)}
            style={{ paddingLeft: `${depth * 14}px` }}
          >
            <span className="inline-block w-3 text-center" aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
            <span className="truncate">{node.name}</span>
          </button>
          {!collapsed ? (
            <div className="flex flex-col gap-1">
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
          'flex w-full flex-col items-start gap-0.5 rounded-md border border-transparent px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
          isActive && 'border-border bg-accent text-accent-foreground',
        )}
        onClick={() => handleOpenWorkspaceDocument(node.path)}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className="truncate font-medium">{node.name}</span>
        <span className="truncate text-xs text-muted-foreground">{node.relativePath}</span>
      </button>
    );
  };

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      if (busy) {
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

      if (matchesShortcut(event, 'b')) {
        event.preventDefault();
        handleToggleSidebar();
        return;
      }

      if (matchesShortcut(event, ',')) {
        event.preventDefault();
        void toggleSettingsTab();
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

      if (matchesShortcut(event, 'f')) {
        event.preventDefault();
        openFindReplace(false);
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

      // Cmd+1..9 → tab index 0..8, Cmd+0 → tab index 9. 11+ tabs have no
      // shortcut; the keypress is still consumed so it doesn't fall through.
      if (event.key.length === 1 && /[0-9]/.test(event.key) && usesCommandModifier(event) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const tabIndex = event.key === '0' ? 9 : Number.parseInt(event.key, 10) - 1;
        const target = tabs[tabIndex];
        if (target && target.id !== activeTabId) {
          void switchToTab(target.id);
        }
        return;
      }

      if (matchesShortcut(event, 'f', { shift: true })) {
        event.preventDefault();
        handleSettingsChange({ ...settings, focusModeEnabled: !settings.focusModeEnabled });
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
  }, [busy, localDraft, snapshot, settings, tabs, activeTabId]);

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

      // Window close (Cmd+W) gates on the active tab; app quit (Cmd+Q) gates on
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
  // - 2+ tabs: close the active tab.
  // - 1 tab: fall through to handleWindowCloseCommand so the dirty prompt
  //   still runs for an unsaved active document.
  const handleCloseTabOrWindow = useEffectEvent(async () => {
    if (tabs.length === 0) {
      await getCurrentWindow().destroy();
      return;
    }
    if (tabs.length > 1 && activeTabId) {
      await handleCloseTab(activeTabId);
      return;
    }
    await handleWindowCloseCommand();
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
      label: isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
      shortcut: '⌘B',
      run: () => handleToggleSidebar(),
    },
    {
      id: 'view.quickOpen',
      category: 'View',
      label: 'Quick Open File…',
      shortcut: '⌘P',
      run: () => setIsQuickOpenOpen(true),
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
      shortcut: '⌘⇧F',
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
          onOpenQuickOpen={() => setIsQuickOpenOpen(true)}
          onOpenOutline={handleOpenOutlinePanel}
          onToggleSidebar={handleOpenFilesPanel}
          isSidebarOpen={isSidebarOpen && sidebarPanel === 'files'}
          isSettingsOpen={isSettingsTabActive}
          isQuickOpenOpen={isQuickOpenOpen}
          isOutlineOpen={isSidebarOpen && sidebarPanel === 'outline'}
        />
        <SideBar
          panel={sidebarPanel}
          isOpen={isSidebarOpen}
          busy={busy}
          workspaceFilter={workspaceFilter}
          onWorkspaceFilterChange={setWorkspaceFilter}
          workspaceTreeLength={workspaceTree.length}
          filteredWorkspaceTreeLength={filteredWorkspaceTree.length}
          recentDocuments={snapshot.recentDocuments}
          activeDocumentPath={snapshot.activeDocumentPath}
          rootDir={snapshot.rootDir}
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
        <SettingsPanel settings={settings} onSettingsChange={handleSettingsChange} />
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
        activeDocumentName={snapshot.activeDocumentName}
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
        splitSourceRef={splitSourceScrollRef}
        splitPreviewRef={splitPreviewScrollRef}
        onSplitSourceScroll={handleSplitSourceScroll}
        onSplitPreviewScroll={handleSplitPreviewScroll}
        onSplitPreviewClick={handleSplitPreviewClick}
        editorContent={<EditorContent editor={editor} />}
        sourceEditor={
          <div ref={sourceEditorContainerRef} className="h-full min-h-0">
            <CodeMirror
              value={localDraft}
              height="100%"
              extensions={sourceEditorExtensions}
              onChange={(value) => setLocalDraft(value)}
              onStatistics={(stats) => {
                setCursorPosition((current) =>
                  nextCursorPositionFromStatistics(current, stats),
                );
              }}
              onCreateEditor={(view) => {
                sourceEditorViewRef.current = view;
              }}
              theme={snapshot.theme.kind === 'BuiltInDark' ? 'dark' : 'light'}
            />
          </div>
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
