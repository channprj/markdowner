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
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { LinkPopup } from '@/components/wysiwyg/LinkPopup';
import { SelectionToolbar } from '@/components/wysiwyg/SelectionToolbar';
import { SlashCommandMenu } from '@/components/wysiwyg/SlashCommandMenu';
import { TableToolbar } from '@/components/wysiwyg/TableToolbar';
import { cn } from '@/lib/utils';
import { ActivityBar } from '@/shell/ActivityBar';
import { AppMenu } from '@/shell/AppMenu';
import { CommandPalette } from '@/shell/CommandPalette';
import { DocumentStatsDialog } from '@/shell/DocumentStatsDialog';
import { EditorArea } from '@/shell/EditorArea';
import { FindReplaceBar } from '@/shell/FindReplaceBar';
import { ShortcutsDialog } from '@/shell/ShortcutsDialog';
import { Tabs } from '@/shell/Tabs';
import { QuickOpen } from '@/shell/QuickOpen';
import {
  SideBar,
  type SearchResultFile,
  type SearchResultMatch,
  type SideBarPanel,
} from '@/shell/SideBar';
import { StatusBar } from '@/shell/StatusBar';
import { SettingsPanel } from '@/shell/SettingsPanel';
import { buildCommandPaletteCommands } from '@/shell/commandPaletteCommands';

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
import { calculateDocumentStats } from './lib/documentStats';
import { resolveCloseDecisionAction } from './lib/closeDecision';
import {
  buildCloseConfirmationDialog,
  resolveActiveClosePromptState,
  resolveClosePromptState,
  resolveCloseRequestAction,
} from './lib/closePrompt';
import { resolveActiveDraftSyncPlan } from './lib/draftSync';
import {
  findTextMatches,
  nextFindMatchIndex,
  nextFindMatchIndexAfterReplace,
  replaceAllMatches,
  replaceSingleMatch,
  resolveFindMatchSelection,
  type FindReplaceOptions,
} from './lib/findReplace';
import {
  MARKDOWN_FILE_EXTENSIONS,
  defaultMarkdownSavePath,
  normalizeOpenDialogPaths,
} from './lib/fileDialogOptions';
import { getErrorMessage } from './lib/errors';
import {
  CLEARED_EXTERNAL_CHANGE_STATE,
  externalChangeDetectedState,
  externalChangeVerificationErrorState,
  formatDiskReadError,
  type ExternalChangeViewState,
} from './lib/externalChanges';
import { nextCursorPositionFromStatistics } from './lib/cursorPosition';
import {
  clearActiveDocumentSnapshot,
  resolveSyncedDraftSnapshot,
  setSnapshotLastError,
  setSnapshotMode,
} from './lib/snapshotState';
import {
  findDocumentTabByPath,
  generateDocumentTabId,
  hydrateRestoredActiveDocumentTab,
  isDocumentTabDirty,
  markDocumentTabMissing,
  mergeRestoredDocumentTabs,
  refreshActiveDocumentTabFromSnapshot,
  refreshSwitchedDocumentTabFromSnapshot,
  resolveCloseTabTransition,
  resolveSettingsTabToggle,
  resolveSwitchTabTransition,
  startupRestoreTargetForDocumentTab,
  restorePersistedDocumentTabs,
  stashDocumentTabDraft,
  upsertDocumentTabFromSnapshot,
  type DocumentTab,
} from './lib/documentTabs';
import {
  centerSourceEditorLine,
  centerTiptapEditorLine,
  moveLineBoundaryInProseMirror,
  movePageInProseMirror,
} from './lib/editorNavigation';
import {
  focusActiveEditor as focusActiveEditorTarget,
  focusExplorerFilter as focusExplorerFilterTarget,
  focusExplorerTree as focusExplorerTreeTarget,
  focusOutlineTree as focusOutlineTreeTarget,
} from './lib/focusTargets';
import {
  wysiwygCursorMarkdownOffset,
  wysiwygCursorSourceLocation,
  wysiwygPositionAtMarkdownOffset,
  wysiwygPositionAtSourceLocation,
  type SourceCursorLocation,
} from './lib/modeCursor';
import {
  DEFAULT_SETTINGS,
  type Settings,
  getChangedSettingsKeys,
  installCliLauncher,
  loadSettings,
  recordDiagnosticsEvent,
  resolveCodeBlockTheme,
  resolveEditorFontSizeAdjustment,
  resolveOutlinePanelSizing,
  saveSettings,
} from './lib/settings';
import { moveTab } from './lib/tabs';
import {
  MARKDOWN_CONTENT_SCOPE_CLASS,
  applyImportedStylesheet,
  applyThemeSelection,
  resolveOsTheme,
} from './lib/themeScope';
import {
  EDITOR_MODE_OPTIONS,
  WINDOW_TITLE,
  buildWindowTitle,
  formatEditorMode,
  formatThemeLabel,
} from './lib/shellDisplay';
import {
  findClickedAnchorHref,
  isOpenLinkClick,
  openMarkdownLink,
} from './lib/linkOpener';
import {
  matchesShortcut,
  resolveEditorFontSizeShortcut,
  resolveFindShortcutAction,
  resolveFocusToggleShortcut,
  resolveModeChord,
  resolveModeNumberShortcut,
  resolveShellShortcutAction,
  resolveTabShortcut,
  resolveTabShortcutAction,
} from './lib/keyboardShortcuts';
import { parseMarkdownOutline, type OutlineItem } from './lib/outline';
import { syncScrollPosition } from './lib/scrollSync';
import {
  estimateRenderedTextOffset,
  getRenderedTextOffset,
  mapRenderedTextOffsetToSourceOffset,
  readSourceNumber,
} from './lib/sourcePreviewClick';
import { createSourceLinkClickExtension } from './lib/sourceLinkClick';
import { sourceLineMarkdownComponents } from './lib/sourceLineComponents';
import { parseNativeMenuCommand } from './lib/nativeMenuCommand';
import {
  createLatestRequestTracker,
  type LatestRequestTracker,
} from './lib/latestRequest';
import {
  buildSourceLineStartOffsets,
  clampSourceOffset,
  countLiteralOccurrencesBefore,
  lineTextFromOffset,
  sourceOffsetForLine,
} from './lib/sourceText';
import {
  findWysiwygTextMatches,
  isWysiwygFindMatch,
  replaceWysiwygTextMatch,
  replaceWysiwygTextMatches,
  selectWysiwygFindMatch,
} from './lib/wysiwygFind';
import {
  focusCodeBlockLanguageSelectorOnArrowUp,
  shouldSuppressDuplicateImeTextInput,
  shouldSuppressSyntheticImeEnter,
} from './lib/wysiwygKeyboard';
import {
  buildWorkspaceTree,
  collectWorkspaceFolderKeys,
  displayFileName,
  displayWorkspacePath,
  filterWorkspaceTree,
  pruneCollapsedWorkspaceFolderKeys,
  toggleWorkspaceFolderKey,
  type WorkspaceTreeNode,
} from './lib/workspaceTree';
import { buildQuickOpenItems } from './lib/quickOpenItems';
import {
  buildOpenTabsPayload,
  cursorPositionsMapFromOpenTabsPayload,
  loadStartupCursorRestoreState,
  loadOpenTabsWithEmptyRetry,
} from './lib/openTabsSession';
import { buildWorkspaceSearchPaths } from './lib/workspaceSearchScope';
import {
  openSelectedDocumentTabs,
  resolveOpenDocumentPathTransition,
  resolveOpenSelectedDocumentTabsTransition,
} from './lib/openDocumentSelection';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  nextSidebarWidthFromKey,
  readSidebarState,
  readSidebarWidth,
  resolveSidebarPanelState,
  sidebarWidthFromPointerX,
  writeSidebarState,
  writeSidebarWidth,
  type SidebarPanel,
} from './lib/sidebarState';

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

const MENU_COMMAND_EVENT = 'markdowner://menu-command';
const SNAPSHOT_UPDATE_EVENT = 'markdowner://update-snapshot';
const STARTUP_OPEN_TABS_RETRY_MS = 100;

type CloseTarget = 'window' | 'app';
type ThemeMode = 'system' | 'manual';
const CHORD_PREFIX_TIMEOUT_MS = 1500;
// Debounce window for serializing the WYSIWYG ProseMirror tree into markdown.
// `editor.getMarkdown()` is O(N) over the doc; on multi-thousand-line files
// running it per keystroke makes typing visibly stutter. Coalesce serialization
// at this cadence and force-flush at synchronization points (save, mode
// switch, tab stash, close prompts) to keep correctness without the cost.
const WYSIWYG_FLUSH_DEBOUNCE_MS = 120;

function useLatestRequestTracker(): LatestRequestTracker {
  const trackerRef = useRef<LatestRequestTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = createLatestRequestTracker();
  }
  return trackerRef.current;
}

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
  const searchRequests = useLatestRequestTracker();
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
  const modeRequests = useLatestRequestTracker();
  const themeRequests = useLatestRequestTracker();
  const externalCompareRequests = useLatestRequestTracker();
  const busyDepthRef = useRef(0);
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
  // Live mirror of the active document path. The WYSIWYG link click handler
  // captures it via this ref (instead of closing over snapshot) so we don't
  // need to re-create editorProps on every snapshot change — that would
  // shred ProseMirror's plugin state mid-IME.
  const activeDocumentPathRef = useRef<string | null>(null);
  // Remembered caret per absolute file path. Filled from the persisted
  // session on launch, updated as the user moves the caret (both modes),
  // and re-persisted via saveOpenTabs on a small debounce.
  const cursorByPathRef = useRef<Map<string, SourceCursorLocation>>(new Map());
  const cursorPersistTimerRef = useRef<number | null>(null);
  // One-shot startup directive: when the bootstrap effect picks an active
  // tab, it stashes the path here. The active-tab cursor restore effect
  // consumes it once the editor surface for that path is ready and then
  // clears it so subsequent tab switches don't re-fire startup focus.
  const startupRestoreRef = useRef<{
    path: string;
    location: SourceCursorLocation | null;
  } | null>(null);
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
  const startupTabsReadyRef = useRef<boolean>(startupTabsReady);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    startupTabsReadyRef.current = startupTabsReady;
  }, [startupTabsReady]);
  // Monotonic counter for file/tab operations. Each open/new/switch flow
  // captures the value at start; after every async hop it re-checks against
  // the current value and aborts if a newer operation has begun. Without
  // this guard, two overlapping flows (e.g. CMD+N fired while a close-then-
  // switch is mid-await) commit state in arrival order rather than user
  // intent order, leaving the editor on the previous file's contents.
  const editorOpRequests = useLatestRequestTracker();
  const nextEditorOpRequest = () => editorOpRequests.begin();
  const isEditorOpStale = (token: number) => editorOpRequests.isStale(token);
  const editorOpAbortOptions = (token: number) => editorOpRequests.abortOptions(token);
  // Tracks the document tab that was active immediately before the settings
  // tab was opened. Closing the settings tab restores this without
  // round-tripping through Rust (the snapshot never changed while settings
  // was on screen).
  const preSettingsDocTabIdRef = useRef<string | null>(null);

  // Stash the live editor draft into the active tab so a later switch back
  // restores the user's in-flight edits. No-op when the active tab is a
  // non-document surface (settings) since it has no editor draft to preserve.
  const stashActiveTabDraft = () => {
    const id = activeTabId;
    if (!id) return;
    // Force the WYSIWYG debounce to settle so we capture the user's most
    // recent keystrokes (otherwise switching tabs mid-burst loses ≤120ms of
    // typing). For Source mode this is a no-op.
    const fresh = flushWysiwygDraftNow();
    const draft = fresh ?? localDraft;
    setTabs((prev) => stashDocumentTabDraft(prev, id, draft));
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
    const reuseId = options.reuseTabId ?? null;
    const result = upsertDocumentTabFromSnapshot({
      currentTabs: tabsRef.current,
      currentActiveId: activeTabIdRef.current,
      snapshot: next,
      reuseTabId: reuseId,
      preserveSettingsActive: options.preserveSettingsActive,
    });

    tabsRef.current = result.tabs;
    // Startup can finish after the user has already opened Settings. In that
    // narrow path, keep Settings active while still adding the document tab.
    activeTabIdRef.current = result.activeTabId;
    startTransition(() => {
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      if (options.markStartupTabsReady) {
        setStartupTabsReady(true);
      }
    });
  };

  // Update only the active tab's metadata (after save / save-as). Settings
  // tabs are never the target of a snapshot refresh.
  const refreshActiveTabFromSnapshot = (next: AppSnapshot) => {
    if (!activeTabId) return;
    startTransition(() => {
      setTabs((prev) =>
        refreshActiveDocumentTabFromSnapshot({
          tabs: prev,
          activeTabId,
          snapshot: next,
        }),
      );
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLocalDraft(localDraft);
    }, 250);
    return () => clearTimeout(timer);
  }, [localDraft]);

  // Heavy text-derived values: defer them off the keystroke critical path.
  // useDeferredValue lets CodeMirror commit the new draft synchronously while
  // React schedules the expensive recomputations (stats, outline, minimap,
  // line offsets) at a lower priority. Without this, 2-3k line documents
  // recompute every regex on every cursor tick and stall key repeat.
  const deferredLocalDraft = useDeferredValue(localDraft);

  const documentStats = useMemo(
    () => calculateDocumentStats(deferredLocalDraft),
    [deferredLocalDraft],
  );
  const outlineItems = useMemo<OutlineItem[]>(
    () => (activeDocumentOpen ? parseMarkdownOutline(deferredLocalDraft) : []),
    [activeDocumentOpen, deferredLocalDraft],
  );
  const sourceLineStartOffsets = useMemo(
    () => buildSourceLineStartOffsets(localDraft),
    [localDraft],
  );
  const themeMode: ThemeMode = settings.themeFollowSystem ? 'system' : 'manual';

  const getSourceOffsetForLine = (lineNumber: number) => {
    return sourceOffsetForLine(lineNumber, sourceLineStartOffsets, localDraft.length);
  };

  const focusSourceSelection = (
    selectionStart: number,
    selectionEnd = selectionStart,
    options: { focusEditor?: boolean; alignTop?: boolean } = {},
  ) => {
    const nextSelectionStart = clampSourceOffset(selectionStart, localDraft.length);
    const nextSelectionEnd = clampSourceOffset(selectionEnd, localDraft.length);
    const selection = { anchor: nextSelectionStart, head: nextSelectionEnd };
    const shouldFocus = options.focusEditor !== false;

    if (sourceEditorViewRef.current) {
      const view = sourceEditorViewRef.current;
      // alignTop scrolls so the caret sits flush with the viewport's top edge
      // (used by Outline clicks). Without an explicit effect CodeMirror uses
      // `nearest`, which puts the caret somewhere in the middle of the pane.
      if (options.alignTop) {
        view.dispatch({
          selection,
          effects: EditorView.scrollIntoView(nextSelectionStart, { y: 'start', yMargin: 0 }),
        });
      } else {
        view.dispatch({ selection, scrollIntoView: true });
      }
      if (shouldFocus) {
        view.focus();
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

  const applySidebarPanelState = (targetPanel: SidebarPanel, intent: 'toggle' | 'show') => {
    const next = resolveSidebarPanelState({
      currentOpen: isSidebarOpen,
      currentPanel: sidebarPanel,
      intent,
      targetPanel,
    });
    setSidebarPanel(next.panel);
    setIsSidebarOpen(next.isOpen);
    writeSidebarState(next.isOpen);
    if (next.announcement) {
      announceShell(next.announcement);
    }
    return next;
  };

  const handleOpenFilesPanel = useEffectEvent(() => {
    applySidebarPanelState('files', 'toggle');
  });

  const handleShowExplorerPanel = useEffectEvent(() => {
    applySidebarPanelState('files', 'show');
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
    focusExplorerTreeTarget(lastExplorerFocusRef.current);
  };

  const focusOutlineTree = () => {
    focusOutlineTreeTarget(lastOutlineFocusRef.current);
  };

  /** Focus the Files filter input (VS Code Cmd+F in Explorer parity). */
  const focusExplorerFilter = () => {
    focusExplorerFilterTarget();
  };

  /**
   * Move keyboard focus into the active editor surface (CodeMirror or TipTap)
   * based on the current mode. Used by Cmd+0 (toggle back to editor) and
   * Cmd+1..9 (jump-to-tab from Explorer) so the caret lands on the document
   * the user just selected.
   */
  const focusActiveEditor = () => {
    focusActiveEditorTarget({
      currentMode,
      sourceEditorView: sourceEditorViewRef.current,
      sourceEditorContainer: sourceEditorContainerRef.current,
    });
  };

  // Record the latest caret location for the given file path. Called from the
  // source-mode statistics callback and the WYSIWYG selection-update callback;
  // when the active tab has no path (untitled) the call is a no-op so we don't
  // accumulate session-local drafts in the persisted map.
  const recordCursorForPath = (
    path: string | null | undefined,
    location: SourceCursorLocation,
  ) => {
    if (!path) return;
    const previous = cursorByPathRef.current.get(path);
    if (previous && previous.line === location.line && previous.column === location.column) {
      return;
    }
    cursorByPathRef.current.set(path, { line: location.line, column: location.column });
    schedulePersistOpenTabs();
  };

  // Debounced persistence trigger. The base persistence effect already fires
  // when the tab list or active tab changes; cursor motion is high-frequency,
  // so we coalesce on a small timer rather than dispatching a save per move.
  const schedulePersistOpenTabs = () => {
    if (cursorPersistTimerRef.current !== null) {
      window.clearTimeout(cursorPersistTimerRef.current);
    }
    cursorPersistTimerRef.current = window.setTimeout(() => {
      cursorPersistTimerRef.current = null;
      persistOpenTabsAndCursorsNow();
    }, 800);
  };

  // Eagerly snapshot the open-tabs + cursor map into the session file. Shared
  // by the tab-list effect (immediate) and the cursor debounce (after motion).
  // Reads tabs/activeTabId from refs so the latest values win even if React
  // hasn't committed a pending render yet.
  const persistOpenTabsAndCursorsNow = () => {
    if (!startupTabsReadyRef.current) return;
    void saveOpenTabs(
      buildOpenTabsPayload({
        tabs: tabsRef.current,
        activeTabId: activeTabIdRef.current,
        cursorPositions: cursorByPathRef.current,
      }),
    ).catch((error) => {
      console.warn('[Markdowner] Failed to persist open tabs:', error);
    });
  };

  const isFocusInsideExplorer = () => {
    const active = document.activeElement as HTMLElement | null;
    return Boolean(active?.closest('[data-explorer-root]'));
  };

  const handleOpenOutlinePanel = useEffectEvent(() => {
    applySidebarPanelState('outline', 'toggle');
  });

  const handleToggleSearchPanel = useEffectEvent(() => {
    applySidebarPanelState('search', 'toggle');
    setSearchFocusToken((value) => value + 1);
  });

  const handleFocusSearchPanel = useEffectEvent(() => {
    applySidebarPanelState('search', 'show');
    setSearchFocusToken((value) => value + 1);
  });

  const resetWorkspaceSearch = () => {
    searchRequests.begin();
    setSearchResults([]);
    setSearchError(null);
    setSearchHasRun(false);
    setSearchBusy(false);
  };

  const handleSearchQueryChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length === 0) {
      resetWorkspaceSearch();
    }
  };

  const handleSearchOptionsChange = (next: FindReplaceOptions) => {
    setSearchOptions(next);
  };

  const handleRunWorkspaceSearch = useEffectEvent(async () => {
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      resetWorkspaceSearch();
      return;
    }

    const requestId = searchRequests.begin();
    setSearchBusy(true);
    setSearchError(null);

    try {
      const paths = buildWorkspaceSearchPaths({
        workspaceDocuments: snapshot.workspaceDocuments,
        tabs,
      });
      const result = await searchWorkspace(searchQuery, searchOptions, paths);
      if (searchRequests.isStale(requestId)) return;
      setSearchResults(result.files);
      setSearchHasRun(true);
    } catch (error) {
      if (searchRequests.isStale(requestId)) return;
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message || 'Search failed');
      setSearchResults([]);
      setSearchHasRun(true);
    } finally {
      if (searchRequests.isCurrent(requestId)) {
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
      const opened = await openKnownDocumentPath(file.path, openWorkspaceDocument);
      if (!opened) return;
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
        // First make sure the caret is in view (also focuses the editor view).
        editor.view.dispatch(editor.state.tr.scrollIntoView());
        // Then align the heading flush with the top of the WYSIWYG surface so
        // the reader's eye lands on the section title without having to scan
        // further down the pane. coordsAtPos can throw briefly during layout
        // — silently skip in that case (the default scrollIntoView above is
        // already in effect as a fallback).
        const pane = document.querySelector<HTMLElement>(
          '[data-testid="editor-surface-wysiwyg"]',
        );
        if (pane && editor.view) {
          try {
            const coords = editor.view.coordsAtPos(match.wysiwygFrom);
            const paneRect = pane.getBoundingClientRect();
            const delta = coords.top - paneRect.top;
            if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
              pane.scrollTop = Math.max(0, pane.scrollTop + delta);
            }
          } catch {
            // posAtCoords/coordsAtPos may throw during layout — fall back.
          }
        }
      }
      return;
    }

    focusSourceSelection(item.titleStart, item.titleStart, { alignTop: true });
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
    setCursorPosition((current) => {
      const next = nextCursorPositionFromStatistics(
        current,
        stats as Parameters<typeof nextCursorPositionFromStatistics>[1],
      );
      if (next !== current) {
        // Mirror the caret to cursorByPath so the active tab's source-mode
        // caret survives across launches. WYSIWYG mirrors via the selection
        // handler below.
        const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
        recordCursorForPath(activeTab?.path ?? null, next);
      }
      return next;
    });
  });
  const [sourceEditorViewToken, setSourceEditorViewToken] = useState(0);
  const handleSourceEditorCreate = useEffectEvent((view: EditorView) => {
    sourceEditorViewRef.current = view;
    // Notify the startup-restore effect that the CodeMirror view is now
    // alive; refs don't trigger renders so we bump a state counter.
    setSourceEditorViewToken((value) => value + 1);
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

    // Clicks on rendered links open the target — markdown files in this
    // editor, everything else in the OS default handler. Plain text in the
    // preview still focuses the corresponding source line via the rest of
    // this handler.
    const href = findClickedAnchorHref(event.target, event.currentTarget);
    if (href) {
      event.preventDefault();
      void openMarkdownLink(href, snapshot.activeDocumentPath).catch(() => {
        // Ignored — user can also open via the source editor.
      });
      return;
    }

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
    const nextWidth = nextSidebarWidthFromKey(sidebarWidth, event.key);
    if (nextWidth === null) return;
    event.preventDefault();
    setSidebarWidth((current) => nextSidebarWidthFromKey(current, event.key) ?? current);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMove = (event: PointerEvent) => {
      setSidebarWidth(sidebarWidthFromPointerX(event.clientX));
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

  // Keep the active document path mirrored in a ref so handlers captured
  // inside stable editorProps closures can resolve relative markdown links.
  useEffect(() => {
    activeDocumentPathRef.current = snapshot.activeDocumentPath;
  }, [snapshot.activeDocumentPath]);

  const publishWysiwygMarkdownDraft = useEffectEvent((markdown: string) => {
    lastEditorMarkdownRef.current = markdown;
    setLocalDraft(markdown);
  });

  // Serialize the editor's current state into localDraft. Skips silently when
  // not in WYSIWYG mode or while a CJK IME composition is in flight; the
  // compositionend handler reschedules in that case.
  const runWysiwygFlush = useEffectEvent(() => {
    if (currentModeRef.current !== 'Wysiwyg') return;
    const ed = editorInstanceRef.current;
    if (!ed) return;
    if (isWysiwygComposingRef.current || ed.view?.composing) return;
    publishWysiwygMarkdownDraft(ed.getMarkdown());
  });

  // Debounced flush. Per-keystroke updates schedule with the default debounce;
  // compositionend / cancel callers pass 0 to flush on the next tick.
  const scheduleWysiwygFlush = useEffectEvent(
    (delayMs: number = WYSIWYG_FLUSH_DEBOUNCE_MS) => {
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
      }
      wysiwygCompositionFlushTimerRef.current = window.setTimeout(() => {
        wysiwygCompositionFlushTimerRef.current = null;
        runWysiwygFlush();
      }, delayMs);
    },
  );

  // Synchronous force-flush for paths that need an up-to-date markdown
  // snapshot (save, mode switch, tab stash, close prompts). Returns the
  // serialized markdown so callers can compare against it without waiting for
  // the React state update that setLocalDraft schedules.
  const flushWysiwygDraftNow = useEffectEvent((): string | null => {
    if (currentModeRef.current !== 'Wysiwyg') return null;
    const ed = editorInstanceRef.current;
    if (!ed) return null;
    if (wysiwygCompositionFlushTimerRef.current !== null) {
      window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
      wysiwygCompositionFlushTimerRef.current = null;
    }
    // CJK IME finalization: if the user triggers save (or any sync-critical
    // path) while still composing a Hangul syllable, returning null here used
    // to drop the in-flight character — callers would fall back to the stale
    // localDraft and persist a document that's missing the user's last
    // keystroke. Blurring the contenteditable commits the composition
    // synchronously on every browser we ship to; we restore focus right
    // afterwards so typing keeps working. After the blur, getMarkdown()
    // reflects the finalized character.
    const dom = ed.view?.dom as HTMLElement | undefined;
    if (isWysiwygComposingRef.current || ed.view?.composing) {
      if (!dom || typeof dom.blur !== 'function') return null;
      const hadFocus = typeof document !== 'undefined' && document.activeElement === dom;
      dom.blur();
      isWysiwygComposingRef.current = false;
      if (hadFocus) {
        // Restore caret focus on a microtask so the composition has fully
        // finalized before ProseMirror re-attaches the selection.
        Promise.resolve().then(() => {
          if (currentModeRef.current === 'Wysiwyg') ed.commands?.focus?.();
        });
      }
    }
    const markdown = ed.getMarkdown();
    publishWysiwygMarkdownDraft(markdown);
    return markdown;
  });

  // Thin alias retained so the existing compositionend / cancel handlers keep
  // their call shape; semantically identical to scheduleWysiwygFlush(0).
  const scheduleWysiwygCompositionFlush = useEffectEvent(() => {
    scheduleWysiwygFlush(0);
  });

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
  // Most recent markdown source location (line + column) the WYSIWYG cursor
  // was sitting on. Updated on every Tiptap selection update so mode switches
  // (Option+1/2/3) can hand the caret to the new editor at the equivalent
  // logical position.
  const wysiwygCursorLocationRef = useRef<SourceCursorLocation>({ line: 1, column: 1 });
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
        // TrailingNode keeps an empty paragraph at the end of the document
        // whenever the last block is something the caret can't comfortably
        // sit "after" (codeBlock, blockquote, table, heading, etc.). Pressing
        // ArrowDown out of one of those blocks lands here, matching the
        // "always a body line at the bottom" VS Code / Notion convention.
        // The extension's invariant guarantees exactly one trailing block,
        // so we never accumulate multiple empty paragraphs at the end.
        // Save-time normalization (`normalizeFinalNewline`) then collapses
        // the serialized markdown to a single trailing \n on disk.
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
      // Cmd/Ctrl+Click on a link inside the WYSIWYG surface should open the
      // target: markdown files become a new editor tab, everything else goes
      // through the OS default handler (browser, mail, Preview, ...).
      // Plain clicks fall through so the user can still position the caret
      // inside the link text to edit it.
      handleClick: (_view: any, _pos: number, event: MouseEvent) => {
        if (!isOpenLinkClick(event)) return false;
        const href = findClickedAnchorHref(event.target);
        if (!href) return false;
        event.preventDefault();
        void openMarkdownLink(href, activeDocumentPathRef.current).catch(() => {
          // Ignored — non-fatal; user can fall back to the popup's open button.
        });
        return true;
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
        if (shouldSuppressSyntheticImeEnter(event, {
          isComposing: isWysiwygComposingRef.current,
          viewComposing: (view as { composing?: boolean }).composing,
          lastCompositionEndAt: lastWysiwygCompositionEndAtRef.current,
        })) {
          return true;
        }
        // ArrowUp at the very first cursor position of a code_block parks the
        // focus on the language selector instead of stepping straight past it.
        // ArrowDown when the selector itself isn't focused is left to the
        // browser — the selector lives outside ProseMirror's editable region.
        if (focusCodeBlockLanguageSelectorOnArrowUp(view, event)) {
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
        // CJK IME duplicate-syllable guard. See wysiwygKeyboard tests for the
        // exact shape and false-positive constraints.
        if (shouldSuppressDuplicateImeTextInput({
          from,
          to,
          text,
          isComposing: isWysiwygComposingRef.current,
          lastCompositionEndAt: lastWysiwygCompositionEndAtRef.current,
          textBetween: view.state.doc.textBetween.bind(view.state.doc),
        })) {
          return true;
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
          scheduleWysiwygCompositionFlush();
          return false;
        },
        compositioncancel: () => {
          isWysiwygComposingRef.current = false;
          lastWysiwygCompositionEndAtRef.current = Date.now();
          lastWysiwygCompositionDataRef.current = '';
          scheduleWysiwygCompositionFlush();
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
        // Don't serialize on every keystroke. editor.getMarkdown() walks the
        // entire ProseMirror tree (O(N)); on 10k-line documents that turns
        // typing into a ~50ms+ stall per character. Schedule a debounced flush
        // and let sync-critical callers (save / mode switch / tab close)
        // force-flush via flushWysiwygDraftNow().
        scheduleWysiwygFlush();
      }
      if (typewriterModeEnabledRef.current && currentModeRef.current === 'Wysiwyg') {
        window.requestAnimationFrame(() => centerTiptapEditorLine(nextEditor));
      }
    },
  );

  const handleWysiwygSelectionUpdate = useEffectEvent(
    ({ editor: nextEditor }: { editor: TiptapEditor }) => {
      // Mirror the WYSIWYG selection as a markdown source location (line +
      // column) so mode switches can hand the caret to CodeMirror at the same
      // logical position.
      const location = wysiwygCursorSourceLocation(nextEditor);
      wysiwygCursorLocationRef.current = location;
      // Persist the caret per file path (parallels the source-mode path) so
      // the next launch restores into the same block.
      const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
      recordCursorForPath(activeTab?.path ?? null, location);
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
  const findMatchSelection = resolveFindMatchSelection(findMatches, activeFindMatchIndex);
  const activeFindMatch = findMatchSelection.activeMatch;
  const canReplaceFindMatch =
    activeDocumentOpen && (currentMode !== 'Wysiwyg' || Boolean(editor));
  const activeFindMatchNumber = findMatchSelection.activeMatchNumber;

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
    setActiveFindMatchIndex((current) =>
      nextFindMatchIndex(current, findMatchCount, 'previous'),
    );
  };

  const handleNextFindMatch = () => {
    if (findMatchCount === 0) return;
    setActiveFindMatchIndex((current) =>
      nextFindMatchIndex(current, findMatchCount, 'next'),
    );
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
        setActiveFindMatchIndex((current) =>
          nextFindMatchIndexAfterReplace(current, findMatchCount),
        );
      }
      return;
    }

    setLocalDraft((current) => replaceSingleMatch(current, activeFindMatch, findReplacement));
    setActiveFindMatchIndex((current) =>
      nextFindMatchIndexAfterReplace(current, findMatchCount),
    );
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
  // Both sides are normalized to a single trailing newline so the WYSIWYG
  // TrailingNode's extra empty paragraph (which exists only in the view, not
  // on disk) doesn't flag a freshly-loaded document as dirty.
  const tabIsDirty = (tab: DocumentTab) =>
    isDocumentTabDirty(tab, { activeTabId, localDraft });
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
  const outlinePanelSizing = resolveOutlinePanelSizing(settings);

  const applyExternalChangeState = (next: ExternalChangeViewState) => {
    setExternalChangeMessage(next.message);
    setShowExternalChangeActions(next.showActions);
    setExternalCompareSource(next.compareSource);
  };

  const clearExternalChangeState = () => {
    applyExternalChangeState(CLEARED_EXTERNAL_CHANGE_STATE);
  };

  const applySnapshot = (next: AppSnapshot, preserveDraft = false) => {
    startTransition(() => {
      setSnapshot(next);
      clearExternalChangeState();
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
      clearExternalChangeState();
      setSnapshot(clearActiveDocumentSnapshot);
    });
  };

  const applyModeOptimistically = (mode: EditorMode) => {
    startTransition(() => {
      setSnapshot((current) => setSnapshotMode(current, mode));
    });
  };

  const reportOperationError = (error: unknown, fallback?: string) => {
    const message = getErrorMessage(error, fallback);
    startTransition(() => {
      setSnapshot((current) => setSnapshotLastError(current, message));
    });
    return message;
  };

  const handleExternalSnapshot = useEffectEvent((next: AppSnapshot) => {
    nextEditorOpRequest();
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
          // Best-effort: also hydrate the persisted caret map so a CLI-opened
          // file (which short-circuits the persisted-tabs branch below) still
          // restores the remembered caret. Failure is non-fatal.
          const startupCursorState = await loadStartupCursorRestoreState({
            load: loadOpenTabs,
            activePath: next.activeDocumentPath,
            shouldAbort: () => cancelled,
          });
          if (startupCursorState.kind === 'aborted') return;
          if (startupCursorState.kind === 'ready') {
            cursorByPathRef.current = startupCursorState.cursorPositions;
            if (startupCursorState.restoreTarget) {
              startupRestoreRef.current = startupCursorState.restoreTarget;
            }
          }
          return;
        }

        try {
          const persistedTabsResult = await loadOpenTabsWithEmptyRetry({
            load: loadOpenTabs,
            waitForRetry: () =>
              new Promise<void>((resolve) => {
                window.setTimeout(resolve, STARTUP_OPEN_TABS_RETRY_MS);
              }),
            shouldAbort: () => cancelled,
          });
          if (persistedTabsResult.kind === 'aborted' || cancelled) return;
          const persistedTabs = persistedTabsResult.payload;
          // Hydrate the caret map regardless of whether tabs come back —
          // useful when the user reopens a single CLI-opened file and the
          // map still carries its remembered position.
          cursorByPathRef.current = cursorPositionsMapFromOpenTabsPayload(persistedTabs);
          if (persistedTabs.openTabs.length === 0) {
            setStartupTabsReady(true);
            return;
          }
          const restoreResult = await restorePersistedDocumentTabs({
            paths: persistedTabs.openTabs,
            openPath: openDocument,
            createTabId: generateDocumentTabId,
            displayNameForPath: displayFileName,
            shouldAbort: () => cancelled,
          });
          if (restoreResult.kind === 'aborted' || cancelled) return;
          const restored = restoreResult.tabs;
          const activePath = persistedTabs.activeTabPath;
          const restoredMerge = mergeRestoredDocumentTabs({
            currentTabs: tabsRef.current,
            restoredTabs: restored,
            currentActiveId: activeTabIdRef.current,
            activePath,
          });
          let { mergedTabs } = restoredMerge;
          const { nextActiveId, nextActiveTab } = restoredMerge;
          const activeHydration = await hydrateRestoredActiveDocumentTab({
            tabs: mergedTabs,
            activeTab: nextActiveTab,
            openPath: openDocument,
            shouldAbort: () => cancelled,
          });
          if (activeHydration.kind === 'aborted' || cancelled) return;
          mergedTabs = activeHydration.tabs;
          const hydratedActiveTab = activeHydration.activeTab;
          const nextSnapshot = activeHydration.snapshot;
          const nextLocalDraft = activeHydration.localDraft;

          tabsRef.current = mergedTabs;
          activeTabIdRef.current = nextActiveId;
          // Arm the startup focus + caret restore. The follow-up effect
          // consumes this once the editor surface for the picked tab is
          // ready (it sees an empty doc + path mismatch otherwise).
          const startupRestoreTarget = startupRestoreTargetForDocumentTab(
            hydratedActiveTab,
            persistedTabs.cursorPositions,
          );
          if (startupRestoreTarget) {
            startupRestoreRef.current = startupRestoreTarget;
          }
          startTransition(() => {
            if (nextSnapshot) {
              setSnapshot(nextSnapshot);
              clearExternalChangeState();
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

  // One-shot startup focus + caret restore. The bootstrap path stashes the
  // target tab's path (and optionally its remembered SourceCursorLocation)
  // into startupRestoreRef once it picks an active tab. This effect waits
  // for the editor surface for that path to be ready, dispatches the saved
  // selection (or focuses the doc start), and then clears the directive so
  // subsequent tab switches don't re-trigger startup focus.
  useEffect(() => {
    const pending = startupRestoreRef.current;
    if (!pending) return;
    if (snapshot.activeDocumentPath !== pending.path) return;
    const location = pending.location ?? { line: 1, column: 1 };
    if (currentMode === 'Wysiwyg') {
      const editorInstance = editor;
      if (!editorInstance) return;
      // ProseMirror's empty placeholder doc has nodeSize 2 (one empty
      // paragraph). Anything larger means the localDraft -> editor sync
      // has already loaded the real content.
      const docSize = editorInstance.state.doc.content.size;
      if (pending.location && docSize <= 2 && (localDraft?.length ?? 0) > 0) return;
      const pos = wysiwygPositionAtSourceLocation(editorInstance, location);
      try {
        if (pos !== null) {
          editorInstance.chain().focus().setTextSelection(pos).scrollIntoView().run();
        } else {
          editorInstance.chain().focus('start').run();
        }
      } catch {
        editorInstance.commands.focus?.();
      }
      startupRestoreRef.current = null;
      return;
    }
    // Editor / SplitView: drive CodeMirror to the saved line+column.
    const view = sourceEditorViewRef.current;
    if (!view) return;
    if (localDraft.length === 0 && pending.location) return;
    const doc = view.state.doc;
    const targetLine = Math.max(1, Math.min(location.line, doc.lines));
    const lineInfo = doc.line(targetLine);
    const targetColumn = Math.max(1, Math.min(location.column, lineInfo.length + 1));
    const offset = lineInfo.from + (targetColumn - 1);
    view.dispatch({
      selection: { anchor: offset, head: offset },
      scrollIntoView: true,
    });
    view.focus();
    startupRestoreRef.current = null;
  }, [
    snapshot,
    activeTabId,
    currentMode,
    editor,
    localDraft,
    sourceEditorViewToken,
  ]);

  const nextThemeRequest = () => themeRequests.begin();
  const isThemeRequestStale = (requestId: number) => themeRequests.isStale(requestId);
  const applyThemeSnapshotIfCurrent = (requestId: number, next: AppSnapshot) => {
    if (isThemeRequestStale(requestId)) return false;
    applySnapshot(next, true);
    return true;
  };

  const handleSettingsChange = (
    next: Settings,
    options: { syncSystemTheme?: boolean } = {},
  ) => {
    const changedKeys = getChangedSettingsKeys(settings, next);
    setSettings(next);
    const saveSettingsPromise = saveSettings(next);
    void saveSettingsPromise;
    if (
      options.syncSystemTheme !== false &&
      changedKeys.includes('themeFollowSystem') &&
      next.themeFollowSystem
    ) {
      const requestId = nextThemeRequest();
      void setTheme(resolveOsTheme())
        .then((synced) => {
          applyThemeSnapshotIfCurrent(requestId, synced);
        })
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
      const requestId = nextThemeRequest();
      try {
        const next = await setTheme(resolveOsTheme());
        applyThemeSnapshotIfCurrent(requestId, next);
      } catch (error) {
        if (isThemeRequestStale(requestId)) return;
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

  // Surface code-block highlight + theme as data attributes so the WYSIWYG
  // and split-view markdown surfaces can pick up the user-selected palette
  // through CSS (no JS recolouring needed).
  useEffect(() => {
    document.documentElement.dataset.cbTheme = resolveCodeBlockTheme(settings, snapshot.theme.kind);
    document.documentElement.dataset.cbHighlight = settings.codeBlockHighlight ? 'on' : 'off';
  }, [
    settings.codeBlockHighlight,
    settings.codeBlockTheme,
    settings.codeBlockThemeSync,
    snapshot.theme.kind,
  ]);

  useEffect(() => {
    document.title = buildWindowTitle(snapshot);
  }, [snapshot]);

  // Persist open tabs whenever the tab list or active tab changes. Only
  // path-bearing tabs are saved; untitled drafts stay session-local.
  useEffect(() => {
    if (!startupTabsReady) return;
    // Cursors travel with the same payload — persistOpenTabsAndCursorsNow
    // reads from the refs that have already been updated for this render.
    persistOpenTabsAndCursorsNow();
  }, [tabs, activeTabId, startupTabsReady]);

  useEffect(() => {
    setCollapsedFolderKeys((current) =>
      pruneCollapsedWorkspaceFolderKeys(current, workspaceTree),
    );
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
            setSnapshot((current) =>
              resolveSyncedDraftSnapshot(current, next, activeDocumentPath),
            );
            clearExternalChangeState();
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

    // Same-tab CJK IME safety net: replacing the doc mid-composition tears
    // down the ProseMirror docView and reseats the cursor — Korean syllables
    // after the first one then land in a new paragraph below the heading. The
    // flush scheduled by compositionend will re-trigger this effect with both
    // values realigned once composition actually finishes.
    if (!tabChanged && (isWysiwygComposingRef.current || editor.view?.composing)) {
      return;
    }

    // Tab change during an in-flight composition MUST finalize the IME before
    // we proceed. If we deferred (like the same-tab branch does), the editor
    // would stay on the previous tab's content while activeTabId already
    // points at the new tab; the eventual compositionend flush would then
    // serialize the previous tab's markdown into the new tab's localDraft and
    // the user would see the "previous page contents leaked into the new tab"
    // bug. Blurring the editable DOM commits the composition on every browser
    // we ship to; we drop our internal composing flag and clear the pending
    // flush timer so the late compositionend can't overwrite the just-applied
    // new content.
    if (tabChanged && (isWysiwygComposingRef.current || editor.view?.composing)) {
      const dom = editor.view?.dom as HTMLElement | undefined;
      dom?.blur?.();
      isWysiwygComposingRef.current = false;
      if (wysiwygCompositionFlushTimerRef.current !== null) {
        window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
        wysiwygCompositionFlushTimerRef.current = null;
      }
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
    if (tabChanged) {
      // ProseMirror's transaction mapper carries the previous tab's
      // selection through the doc replacement above — when the prior
      // selection covered a range (Cmd+A, drag-selected paragraph, a find
      // hit, a node-selected image) the new tab can open with WebKit
      // visibly rendering that range against the new content. Collapse
      // the DOM selection to a single caret position so the focus call
      // that follows (in focusActiveEditor / the user's first click)
      // doesn't paint the entire freshly-loaded file as highlighted.
      //
      // We touch the DOM selection directly instead of dispatching a
      // ProseMirror transaction because dispatching here would re-enter
      // the editor's DOMObserver flush path, which in JSDOM hits a
      // missing-getClientRects branch and shows up as an unhandled error
      // in tests. The real ProseMirror state has *also* been mapped to
      // a point already (setContent's default selection mapping snaps to
      // atStart when the previous range falls outside the new doc), so
      // clearing the DOM range alone is enough to remove the visible
      // highlight without contradicting the editor's internal state.
      const win = typeof window !== 'undefined' ? window : null;
      const selection = win?.getSelection?.();
      if (selection && selection.rangeCount > 0) {
        try {
          selection.removeAllRanges();
        } catch {
          // Some embedded WebViews throw on removeAllRanges when the
          // selection's anchorNode has been detached. Non-fatal.
        }
      }
    }
  }, [editor, localDraft, activeTabId]);

  const previewSource = activeDocumentOpen
    ? debouncedLocalDraft
    : '*Open a Markdown document to preview it.*';
  const sourceEditorExtensions = useMemo(
    () => [
      markdown(),
      // Cmd/Ctrl+Click on `[text](url)` in the source editor opens the link
      // through the unified linkOpener flow (browser for URLs, editor tab
      // for markdown files). Plain clicks keep CodeMirror's default
      // caret-positioning behavior.
      createSourceLinkClickExtension(() => activeDocumentPathRef.current),
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
    busyDepthRef.current += 1;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportOperationError(error, fallback);
    } finally {
      busyDepthRef.current = Math.max(0, busyDepthRef.current - 1);
      if (busyDepthRef.current === 0) {
        setBusy(false);
      }
    }
  };

  const hasExternalChanges = async (
    options: { shouldAbort?: () => boolean } = {},
  ) => {
    if (!activeDocumentOpen || !snapshot.activeDocumentPath) {
      if (!options.shouldAbort?.()) {
        clearExternalChangeState();
      }
      return false;
    }

    try {
      const changed = await hasActiveDocumentExternalChanges();
      if (options.shouldAbort?.()) return false;
      if (!changed) {
        clearExternalChangeState();
        return false;
      }

      applyExternalChangeState(externalChangeDetectedState(snapshot.activeDocumentName));
      return true;
    } catch (error) {
      if (options.shouldAbort?.()) return false;
      const reason = error instanceof Error ? error.message : String(error);
      applyExternalChangeState(
        externalChangeVerificationErrorState(snapshot.activeDocumentName, reason),
      );
      return true;
    }
  };

  const syncActiveDraft = async (
    preserveMode: EditorMode = snapshot.mode,
    options: { forFinalSave?: boolean; shouldAbort?: () => boolean } = {},
  ) => {
    // In WYSIWYG mode, force the debounced flush so the persisted draft
    // includes any keystrokes that haven't crossed the debounce boundary yet.
    // The returned markdown lets us compare without waiting for React state.
    const plan = resolveActiveDraftSyncPlan({
      activeDocumentOpen,
      activeDocumentSource: snapshot.activeDocumentSource,
      localDraft,
      flushedDraft: flushWysiwygDraftNow(),
      forFinalSave: options.forFinalSave,
    });
    if (!plan) {
      return;
    }
    if (options.shouldAbort?.()) {
      return;
    }

    // VS Code-parity trailing newline: every save path collapses the tail
    // to exactly one `\n` before reaching Rust + disk. Non-save syncs
    // (tab switch, mode switch) keep the live draft verbatim so the
    // editor doesn't visibly mutate mid-navigation.
    if (plan.shouldUpdateLocalDraft) {
      setLocalDraft(plan.outgoingDraft);
    }

    // Compare normalized to avoid spurious writes when the only diff is
    // trailing whitespace that the save path would have normalized anyway.
    if (!plan.shouldReplaceActiveSource) {
      return;
    }

    const synced = await replaceActiveDocumentSource(plan.outgoingDraft);
    if (options.shouldAbort?.()) {
      return;
    }
    applySnapshot({ ...synced, mode: preserveMode }, true);
  };

  const syncActiveDraftBestEffort = async (
    preserveMode: EditorMode = snapshot.mode,
    options: { shouldAbort?: () => boolean } = {},
  ) => {
    try {
      await syncActiveDraft(preserveMode, options);
    } catch {
      // The tab model already keeps the user's local draft. Navigation and
      // view changes should not get stuck behind a best-effort backend sync.
    }
  };

  const handleNewDocument = async () => {
    // If an Untitled tab already exists, just switch to it instead of stacking
    // multiple Untitled drafts (Rust only models a single untitled document).
    const existingUntitled = findDocumentTabByPath(tabs, null);
    if (existingUntitled) {
      await switchToTab(existingUntitled.id);
      focusActiveEditor();
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
      if (isEditorOpStale(token)) return;
      const next = await newDocument();
      if (isEditorOpStale(token)) return;
      applySnapshot(next);
      upsertActiveTabFromSnapshot(next);
    });

    // After Cmd+N / Cmd+T / "New File", land the caret in the editor so the
    // user can type immediately. Without this the freshly-mounted ProseMirror
    // surface stays unfocused and never paints a blinking caret. The helper's
    // built-in rAF fallback handles the case where the editor's contentDOM
    // hasn't been inserted yet (brand-new doc from the empty state).
    if (isEditorOpStale(token)) return;
    focusActiveEditor();
  };

  const handleOpenDocument = async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
    });

    const paths = normalizeOpenDialogPaths(selected);
    if (paths.length === 0) {
      return;
    }

    // Single-path shortcut: just switch if it's already open.
    if (paths.length === 1) {
      const pathTransition = resolveOpenDocumentPathTransition({
        currentTabs: tabs,
        path: paths[0],
      });
      if (pathTransition.kind === 'switchExisting') {
        await switchToTab(pathTransition.activeTabId);
        focusActiveEditor();
        return;
      }
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
      if (isEditorOpStale(token)) return;

      const openResult = await openSelectedDocumentTabs({
        paths,
        currentTabs: tabs,
        openPath: openDocument,
        createTabId: generateDocumentTabId,
        displayNameForPath: displayFileName,
        shouldAbort: () => isEditorOpStale(token),
      });
      const openTransition = resolveOpenSelectedDocumentTabsTransition({
        result: openResult,
        currentTabs: tabs,
      });

      switch (openTransition.kind) {
        case 'noop':
          return;
        case 'appendAdditions':
          startTransition(() => {
            setTabs((current) => {
              const next = resolveOpenSelectedDocumentTabsTransition({
                result: openResult,
                currentTabs: current,
              });
              return next.kind === 'appendAdditions' ? next.tabs : current;
            });
            setActiveTabId(openTransition.activeTabId);
          });
          applySnapshot(openTransition.snapshot);
          return;
        case 'switchExisting':
          // Every selected file was already open — switch to the last one.
          await switchToTab(openTransition.activeTabId);
      }
    });

    // After Cmd+O / "Open File…", land the caret in the freshly mounted editor
    // surface so the user can type immediately — mirrors handleNewDocument.
    if (isEditorOpStale(token)) return;
    focusActiveEditor();
  };

  const handleOpenWorkspace = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: true,
    });

    if (typeof selected !== 'string') {
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
      if (isEditorOpStale(token)) return;
      const next = await openWorkspace(selected);
      if (isEditorOpStale(token)) return;
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

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      await syncActiveDraft(undefined, {
        forFinalSave: true,
        ...editorOpAbortOptions(token),
      });
      if (isEditorOpStale(token)) return;
      if (await hasExternalChanges(editorOpAbortOptions(token))) {
        return;
      }
      if (isEditorOpStale(token)) return;
      const next = await saveActiveDocument();
      if (isEditorOpStale(token)) return;
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
        defaultPath: defaultMarkdownSavePath(
          snapshot.activeDocumentPath,
          snapshot.activeDocumentName,
        ),
        filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
      });

      if (typeof selected !== 'string') {
        return false;
      }

      await syncActiveDraft(undefined, { forFinalSave: true });
      const next = await saveActiveDocumentAs(selected);
      applySnapshot(next, true);
      return true;
    }

    await syncActiveDraft(undefined, { forFinalSave: true });
    if (await hasExternalChanges()) {
      return false;
    }
    const next = await saveActiveDocument();
    applySnapshot(next, true);
    return true;
  };

  const requestCloseDecision = async (documentName = snapshot.activeDocumentName) => {
    const confirmation = buildCloseConfirmationDialog(documentName, WINDOW_TITLE);
    const decision = await message(confirmation.message, confirmation.options);
    return resolveCloseDecisionAction(decision);
  };

  const closeOnlyRemainingTab = useEffectEvent(async () => {
    // Pull any pending WYSIWYG edits across the debounce boundary so the
    // dirty check below reflects the user's actual most-recent state.
    const fresh = flushWysiwygDraftNow();
    const currentDraft = fresh ?? localDraft;
    const closePromptState = resolveActiveClosePromptState({
      tabs,
      activeTabId,
      activeDraft: currentDraft,
    });
    if (!closePromptState.requiresPrompt) {
      clearActiveDocumentSurface();
      return;
    }

    if (busy) {
      return;
    }

    try {
      const closeDecisionAction = await requestCloseDecision();

      if (closeDecisionAction.kind === 'save') {
        await withBusy(async () => {
          const saved = await saveActiveDocumentForClose();
          if (saved) {
            clearActiveDocumentSurface();
          }
        });
        return;
      }

      if (closeDecisionAction.kind === 'discard') {
        clearActiveDocumentSurface();
        return;
      }

      if (closeDecisionAction.kind === 'warn') {
        console.warn('Unrecognized close decision:', closeDecisionAction.decision);
      }
    } catch (error) {
      reportOperationError(error, 'Could not close tab');
    }
  });

  const handleReloadActiveDocument = async () => {
    if (!activeDocumentOpen || !snapshot.activeDocumentPath) {
      return;
    }

    const path = snapshot.activeDocumentPath;
    const token = nextEditorOpRequest();
    await withBusy(async () => {
      const next = await openDocument(path);
      if (isEditorOpStale(token)) return;
      applySnapshot(next);
    });
  };

  const handleKeepLocalChanges = () => {
    clearExternalChangeState();
  };

  const handleCompareExternalChanges = async () => {
    if (!activeDocumentOpen) {
      return;
    }

    const token = editorOpRequests.current();
    const compareRequestId = externalCompareRequests.begin();
    try {
      const source = await activeDocumentDiskSource();
      if (isEditorOpStale(token)) return;
      if (externalCompareRequests.isStale(compareRequestId)) return;
      setExternalCompareSource(source);
    } catch (error) {
      if (isEditorOpStale(token)) return;
      if (externalCompareRequests.isStale(compareRequestId)) return;
      const reason = error instanceof Error ? error.message : String(error);
      setExternalChangeMessage(formatDiskReadError(snapshot.activeDocumentName, reason));
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

    const requestId = nextThemeRequest();
    await withBusy(async () => {
      const next = await importTheme(selected);
      applyThemeSnapshotIfCurrent(requestId, next);
    });
  };

  const handleSaveAs = async () => {
    if (!activeDocumentOpen) {
      return;
    }

    const selected = await saveDialog({
      defaultPath: defaultMarkdownSavePath(
        snapshot.activeDocumentPath,
        snapshot.activeDocumentName,
      ),
      filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      await syncActiveDraft(undefined, {
        forFinalSave: true,
        ...editorOpAbortOptions(token),
      });
      if (isEditorOpStale(token)) return;
      const next = await saveActiveDocumentAs(selected);
      if (isEditorOpStale(token)) return;
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

  // Cursor handoff between WYSIWYG ↔ Source on mode change. Uses the markdown
  // character offset of the cursor as the canonical position — both editors
  // map cleanly to/from it, so the cursor lands on the *exact same character*
  // after a mode switch. The earlier line+column scheme would drift by a line
  // at the end of a document because the WYSIWYG TrailingNode adds an empty
  // paragraph that doesn't exist in the markdown source (so e.g. "end of doc"
  // in WYSIWYG was line N+1 col 1 in the conversion, then clamped to source
  // end ≠ source's actual line N).
  useEffect(() => {
    const previousMode = previousModeForCursorRef.current;
    previousModeForCursorRef.current = currentMode;
    if (previousMode === currentMode) return;
    if (!activeDocumentOpen) return;

    const editorInstance = editorInstanceRef.current;
    // Resolve the cursor's markdown offset in the mode we're *leaving*. For
    // WYSIWYG we serialize the doc prefix; for source / split view we
    // translate the (line, column) tuple CodeMirror already gave us.
    let markdownOffset: number;
    if (previousMode === 'Wysiwyg') {
      markdownOffset = wysiwygCursorMarkdownOffset(editorInstance);
    } else {
      const lineStart = getSourceOffsetForLine(cursorPosition.line);
      markdownOffset = lineStart + Math.max(0, cursorPosition.column - 1);
    }
    if (!Number.isFinite(markdownOffset) || markdownOffset < 0) return;

    // Defer to the next frame so the editor pane that just became visible
    // has measured layout — focus()/setSelection on a display:none element
    // is a silent no-op in Chromium-based webviews.
    const frame = window.requestAnimationFrame(() => {
      if (currentMode === 'Wysiwyg') {
        const incomingEditor = editorInstanceRef.current;
        if (!incomingEditor) return;
        const pos = wysiwygPositionAtMarkdownOffset(incomingEditor, markdownOffset);
        if (pos === null) {
          incomingEditor.chain().focus().run();
          return;
        }
        incomingEditor.chain().focus().setTextSelection(pos).run();
        return;
      }
      // Editor or SplitView — the source pane owns the caret. The markdown
      // offset *is* the CodeMirror offset in normal cases; clamp to keep the
      // caret inside the doc when WYSIWYG's serialized markdown ran longer
      // than the source (e.g. a TrailingNode's extra blank paragraph).
      const clamped = Math.max(0, Math.min(markdownOffset, localDraft.length));
      focusSourceSelection(clamped);
    });
    return () => window.cancelAnimationFrame(frame);
    // We intentionally omit cursorPosition.* and getSourceOffsetForLine —
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

    // Capture any pending WYSIWYG keystrokes before switching — the source
    // editor renders straight from localDraft, so a stale debounce window
    // would briefly flash the pre-typing content after the mode change.
    if (snapshot.mode === 'Wysiwyg') {
      flushWysiwygDraftNow();
    }

    const requestId = modeRequests.begin();
    const previousMode = snapshot.mode;
    applyModeOptimistically(nextMode);

    try {
      const next = await setMode(nextMode);
      if (modeRequests.isStale(requestId)) {
        return;
      }
      applySnapshot({ ...next, mode: nextMode }, true);
    } catch (error) {
      if (modeRequests.isCurrent(requestId)) {
        reportOperationError(error, 'Could not switch editor mode');
        applyModeOptimistically(previousMode);
      }
    }
  });

  const handleSetTheme = async (themeKind: ThemeKind) => {
    const requestId = nextThemeRequest();
    await withBusy(async () => {
      if (settings.themeFollowSystem) {
        handleSettingsChange({ ...settings, themeFollowSystem: false });
      }
      const next = await setTheme(themeKind);
      applyThemeSnapshotIfCurrent(requestId, next);
    });
  };

  const handleFollowSystemTheme = async () => {
    const requestId = nextThemeRequest();
    await withBusy(async () => {
      if (!settings.themeFollowSystem) {
        handleSettingsChange(
          { ...settings, themeFollowSystem: true },
          { syncSystemTheme: false },
        );
      }
      const next = await setTheme(resolveOsTheme());
      applyThemeSnapshotIfCurrent(requestId, next);
    });
  };

  const openKnownDocumentPath = async (
    path: string,
    openPath: (path: string) => Promise<AppSnapshot>,
  ) => {
    const pathTransition = resolveOpenDocumentPathTransition({
      currentTabs: tabs,
      path,
    });

    if (pathTransition.kind === 'switchExisting') {
      await switchToTab(pathTransition.activeTabId);
      focusActiveEditor();
      return true;
    }

    const token = nextEditorOpRequest();
    let applied = false;
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
      if (isEditorOpStale(token)) return;
      const next = await openPath(pathTransition.path);
      if (isEditorOpStale(token)) return;
      applySnapshot(next);
      upsertActiveTabFromSnapshot(next);
      applied = true;
    });

    // Clicking a file in the Explorer sidebar should leave the caret in the
    // editor, not on the tree row — same UX as Cmd+N / Cmd+O.
    if (!applied || isEditorOpStale(token)) return false;
    focusActiveEditor();
    return true;
  };

  const handleOpenWorkspaceDocument = async (path: string) => {
    await openKnownDocumentPath(path, openWorkspaceDocument);
  };

  const handleOpenRecentDocument = async (path: string) => {
    await openKnownDocumentPath(path, openDocument);
  };

  const handleToggleWorkspaceFolder = (key: string) => {
    setCollapsedFolderKeys((current) => toggleWorkspaceFolderKey(current, key));
  };

  const handleCollapseWorkspaceFolders = () => {
    setCollapsedFolderKeys(collectWorkspaceFolderKeys(workspaceTree));
  };

  // Switch to an existing tab. Stashes the outgoing tab's draft, drives Rust's
  // active document to the target's path (or a fresh untitled), then restores
  // the target tab's previously stashed draft as the live editor content.
  const switchToTab = useEffectEvent(async (targetId: string) => {
    const transition = resolveSwitchTabTransition({ tabs, activeTabId, targetId });
    if (transition.kind === 'noop') return;
    const target = transition.target;

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
      if (isEditorOpStale(token)) return;

      try {
        if (transition.kind === 'activateSettings') {
          // Settings is a UI-only surface — stay on the current snapshot but
          // hand the active-tab pointer to the settings tab so the editor
          // area swaps to SettingsPanel.
          setActiveTabId(transition.target.id);
          return;
        }
        if (transition.kind === 'activateMissing') {
          // Missing files: stay on the empty editor; do not call into Rust.
          setActiveTabId(transition.target.id);
          setLocalDraft('');
          return;
        }
        const next =
          transition.kind === 'openPath'
            ? await openDocument(transition.path)
            : await newDocument();
        if (isEditorOpStale(token)) return;
        // preserveDraft so we can immediately swap to the stashed draft
        applySnapshot(next, true);
        setActiveTabId(target.id);
        // Restore the target's stashed draft so unsaved edits survive switching.
        setLocalDraft(target.draft);
        // Refresh tab metadata in case the file changed on disk.
        setTabs((prev) =>
          refreshSwitchedDocumentTabFromSnapshot({
            tabs: prev,
            targetId: target.id,
            snapshot: next,
          }),
        );
      } catch {
        if (isEditorOpStale(token)) return;
        // The file disappeared between sessions — convert this tab to missing.
        setTabs((prev) => markDocumentTabMissing(prev, target.id));
        setActiveTabId(target.id);
        setLocalDraft('');
      }
    });
  });

  const handleCloseTab = useEffectEvent(async (targetId: string) => {
    const transition = resolveCloseTabTransition({
      tabs,
      activeTabId,
      targetId,
      preSettingsDocTabId: preSettingsDocTabIdRef.current,
    });

    switch (transition.kind) {
      case 'missing':
        return;
      case 'clearSurface':
        clearActiveDocumentSurface();
        return;
      case 'closeOnlyRemainingDocument':
        await closeOnlyRemainingTab();
        return;
      case 'setTabs':
        if (transition.clearPreSettingsDocTabId) {
          preSettingsDocTabIdRef.current = null;
        }
        setTabs(transition.tabs);
        setActiveTabId(transition.activeTabId);
        return;
      case 'switchThenRemove':
        // Pick a neighbor to activate first, then drop the closed tab.
        await switchToTab(transition.switchToTabId);
        setTabs((prev) => prev.filter((tab) => tab.id !== transition.targetId));
    }
  });

  // Open (or focus, or close) the Settings tab. Cmd+, and the gear icon both
  // route through here — when the settings tab is already active it toggles
  // closed, matching the old modal toggle behavior.
  const toggleSettingsTab = useEffectEvent(async () => {
    const transition = resolveSettingsTabToggle({ tabs, activeTabId });

    switch (transition.kind) {
      case 'closeExisting':
        await handleCloseTab(transition.targetId);
        return;
      case 'activateExisting':
        preSettingsDocTabIdRef.current = transition.preSettingsDocTabId;
        setActiveTabId(transition.activeTabId);
        return;
      case 'appendSettings':
        // Stash but do not sync — opening settings keeps the Rust active document
        // exactly as-is so closing settings can restore it without re-opening.
        stashActiveTabDraft();
        preSettingsDocTabIdRef.current = transition.preSettingsDocTabId;
        startTransition(() => {
          setTabs(transition.tabs);
          setActiveTabId(transition.activeTabId);
        });
    }
  });

  const handleNativeMenuCommand = useEffectEvent(async (command: string) => {
    if (busy) {
      return;
    }

    const parsedCommand = parseNativeMenuCommand(command);

    switch (parsedCommand.kind) {
      case 'newDocument':
        await handleNewDocument();
        return;
      case 'openDocument':
        await handleOpenDocument();
        return;
      case 'openWorkspace':
        await handleOpenWorkspace();
        return;
      case 'saveActiveDocument':
        await handleSave();
        return;
      case 'saveActiveDocumentAs':
        await handleSaveAs();
        return;
      case 'closeWindow':
        await handleCloseTabOrWindow();
        return;
      case 'quitApp':
        await handleQuitCommand();
        return;
      case 'setMode':
        await handleSetMode(parsedCommand.mode);
        return;
      case 'openRecentDocument':
        await handleOpenRecentDocument(parsedCommand.path);
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

      const closeFindShortcutAction = resolveFindShortcutAction(event, {
        activeDocumentOpen,
        findReplaceOpen: isFindReplaceOpenRef.current,
        focusInsideExplorer: false,
        isSidebarOpen,
        sidebarPanel,
      });
      if (closeFindShortcutAction?.kind === 'closeFindReplace') {
        event.preventDefault();
        setIsFindReplaceOpen(false);
        return;
      }

      // Resolve a pending Cmd+K chord (Cmd+K → Cmd+W/E/S, with or without the
      // second Cmd held). This must run before single-key handlers so the
      // second stroke is not consumed by, e.g., the Cmd+W close-window shortcut.
      if (chordPrefixActiveRef.current) {
        const chordResolution = resolveModeChord(event);
        if (chordResolution.kind === 'pendingModifier') {
          return;
        }
        clearChordPrefix();
        if (chordResolution.kind === 'cancel') {
          return;
        }
        event.preventDefault();
        void handleSetMode(chordResolution.mode);
        return;
      }

      const shellShortcutAction = resolveShellShortcutAction(event, {
        activeDocumentOpen,
        isSidebarOpen,
        sidebarPanel,
      });
      if (shellShortcutAction.kind !== 'none') {
        event.preventDefault();
        switch (shellShortcutAction.kind) {
          case 'closeTabOrWindow':
            void handleCloseTabOrWindow();
            return;
          case 'newDocument':
            void handleNewDocument();
            return;
          case 'openDocument':
            void handleOpenDocument();
            return;
          case 'openOutlinePanel':
            handleOpenOutlinePanel();
            return;
          case 'openWorkspace':
            void handleOpenWorkspace();
            return;
          case 'quit':
            void handleQuitCommand();
            return;
          case 'save':
            void handleSave();
            return;
          case 'saveAs':
            void handleSaveAs();
            return;
          case 'showExplorerPanel':
            handleShowExplorerPanel();
            focusExplorerTree();
            return;
          case 'toggleCommandPalette':
            setIsCommandPaletteOpen((prev) => !prev);
            return;
          case 'toggleDocumentStats':
            setIsDocumentStatsOpen((prev) => !prev);
            return;
          case 'toggleQuickOpen':
            setIsQuickOpenOpen((prev) => !prev);
            return;
          case 'toggleSettingsTab':
            void toggleSettingsTab();
            return;
          case 'toggleShortcuts':
            setIsShortcutsOpen((prev) => !prev);
            return;
          case 'toggleSidebar':
            handleToggleSidebar();
            return;
          case 'toggleTypewriterMode':
            handleSettingsChange({
              ...settings,
              typewriterModeEnabled: !settings.typewriterModeEnabled,
            });
            return;
          default:
        }
        return;
      }

      const findShortcutAction = resolveFindShortcutAction(event, {
        activeDocumentOpen,
        findReplaceOpen: isFindReplaceOpenRef.current,
        focusInsideExplorer: isFocusInsideExplorer(),
        isSidebarOpen,
        sidebarPanel,
      });
      if (findShortcutAction) {
        event.preventDefault();
        switch (findShortcutAction.kind) {
          case 'focusExplorerFilter':
            focusExplorerFilter();
            return;
          case 'focusSearchPanel':
            handleFocusSearchPanel();
            return;
          case 'openFind':
            openFindReplace(false);
            return;
          case 'openReplace':
            openFindReplace(true);
            return;
          case 'toggleSidebar':
            handleToggleSidebar();
            return;
          default:
        }
        return;
      }

      // Cmd+- / Cmd+= (a.k.a. Cmd++) adjust the editor font size, modifying
      // the same `editorFontSize` value the Settings panel exposes. We match
      // on `event.code` for layout independence: on macOS/KR keyboards the
      // `-` and `=` glyphs sit at Minus/Equal regardless of typed character,
      // and Cmd+Shift+= (the "+" combo) reports Equal as well. The change
      // routes through handleSettingsChange so it is persisted via
      // save_settings — no separate codepath.
      const editorFontSizeShortcut = resolveEditorFontSizeShortcut(event);
      if (editorFontSizeShortcut) {
        event.preventDefault();
        const { current, next } = resolveEditorFontSizeAdjustment(
          settings.editorFontSize,
          editorFontSizeShortcut.kind,
        );
        if (next !== current) {
          handleSettingsChange({ ...settings, editorFontSize: next });
        }
        return;
      }

      // Cmd+Shift+] / Cmd+Shift+[ → next / previous tab (wrapping). Users see
      // these as ⌘} / ⌘{ since `{` and `}` are Shift-bracket on US/KR layouts.
      // Ctrl+Shift+PageUp / PageDown → move active tab left / right (no wrap),
      // matching VS Code "Move Editor Left/Right".
      // Cmd+1..9 → tab index 0..8 and returns focus to the editor surface.
      const tabShortcut = resolveTabShortcut(event);
      if (tabShortcut) {
        event.preventDefault();
        const tabAction = resolveTabShortcutAction({ shortcut: tabShortcut, tabs, activeTabId });
        if (tabAction.kind === 'selectTab') {
          if (tabAction.targetId !== activeTabId) {
            void switchToTab(tabAction.targetId);
          }
          if (tabAction.focusEditor) {
            focusActiveEditor();
          }
        } else if (tabAction.kind === 'moveActive' && activeTabId) {
          setTabs((prev) => moveTab(prev, activeTabId, tabAction.direction));
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
      const focusToggleShortcut = resolveFocusToggleShortcut(event, {
        isSidebarOpen,
        sidebarPanel,
        focusInsideExplorer: isFocusInsideExplorer(),
      });
      if (focusToggleShortcut) {
        event.preventDefault();
        if (focusToggleShortcut.kind === 'focusOutline') {
          focusOutlineTree();
          return;
        }
        if (focusToggleShortcut.kind === 'focusEditor') {
          focusActiveEditor();
        } else {
          handleShowExplorerPanel();
          focusExplorerTree();
        }
        return;
      }

      // Alt+1 → WYSIWYG, Alt+2 → Editor, Alt+3 → Split-view. macOS Option
      // produces non-ASCII glyphs in event.key (¡/™/£), so match on event.code.
      const modeNumberShortcut = resolveModeNumberShortcut(event);
      if (modeNumberShortcut) {
        event.preventDefault();
        void handleSetMode(modeNumberShortcut.mode);
        return;
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

      // Flush any pending WYSIWYG keystrokes so the active-tab dirty check
      // doesn't drop the user's last ≤120ms of typing on close. For other
      // tabs we rely on the already-persisted `tab.draft` set by stash on
      // tab switch (which also flushes).
      const fresh = flushWysiwygDraftNow();
      const currentDraft = fresh ?? localDraft;
      const closePromptState = resolveClosePromptState({
        tabs,
        activeTabId,
        activeDraft: currentDraft,
        target,
      });
      const closeRequestAction = resolveCloseRequestAction({
        activeTabId,
        busy,
        closePromptState,
        forceClose: forceCloseRef.current,
        target,
      });

      if (closeRequestAction.kind === 'allow') {
        return;
      }

      event.preventDefault();

      if (closeRequestAction.kind === 'preventOnly') {
        return;
      }

      const promptDocumentName = closeRequestAction.switchToTabId
        ? tabs.find((tab) => tab.id === closeRequestAction.switchToTabId)?.name
        : snapshot.activeDocumentName;

      if (closeRequestAction.switchToTabId) {
        await switchToTab(closeRequestAction.switchToTabId);
      }

      try {
        const closeDecisionAction = await requestCloseDecision(promptDocumentName);

        if (closeDecisionAction.kind === 'save') {
          await withBusy(async () => {
            const saved = await saveActiveDocumentForClose();
            if (saved) {
              await closeTarget(target);
            }
          });
          return;
        }

        if (closeDecisionAction.kind === 'discard') {
          await closeTarget(target);
          return;
        }

        if (closeDecisionAction.kind === 'warn') {
          // Unrecognized decision (e.g., Cancel or unexpected platform value) — keep window open.
          console.warn('Unrecognized close decision:', closeDecisionAction.decision);
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
            const token = nextEditorOpRequest();
            await withBusy(async () => {
              stashActiveTabDraft();
              await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
              if (isEditorOpStale(token)) return;
              const next = await openDroppedPath(firstPath);
              if (isEditorOpStale(token)) return;
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

  const quickOpenItems = buildQuickOpenItems(snapshot);

  const handleQuickOpenSelect = (path: string) => {
    if (snapshot.workspaceDocuments.includes(path)) {
      void handleOpenWorkspaceDocument(path);
    } else {
      void handleOpenRecentDocument(path);
    }
  };

  const paletteCommands = buildCommandPaletteCommands({
    activeDocumentOpen,
    settings,
    actions: {
      newDocument: () => void handleNewDocument(),
      openDocument: () => void handleOpenDocument(),
      openWorkspace: () => void handleOpenWorkspace(),
      save: () => void handleSave(),
      saveAs: () => void handleSaveAs(),
      toggleSidebar: () => handleToggleSidebar(),
      showExplorerPanel: () => handleShowExplorerPanel(),
      focusExplorerTree,
      toggleOutline: () => handleOpenOutlinePanel(),
      openQuickOpen: () => setIsQuickOpenOpen(true),
      focusSearchPanel: () => handleFocusSearchPanel(),
      openFindReplace,
      setMode: (mode) => void handleSetMode(mode),
      updateSettings: handleSettingsChange,
      openSettings: () => void toggleSettingsTab(),
      installCliLauncher: () => {
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
      openDocumentStats: () => setIsDocumentStatsOpen(true),
      setTheme: (themeKind) => void handleSetTheme(themeKind),
      followSystemTheme: () => void handleFollowSystemTheme(),
      importTheme: () => void handleImportTheme(),
    },
  });

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
            // Reuse tabIsDirty so the indicator agrees with the close/quit
            // "Save changes?" prompt — both must normalize trailing newlines
            // so the WYSIWYG TrailingNode's empty paragraph (which exists
            // only in the view, not on disk) doesn't pin the dot on after a
            // successful save.
            isDirty: tabIsDirty(tab),
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
          outlineFontSize={outlinePanelSizing.outlineFontSize}
          outlineRowSpacing={outlinePanelSizing.outlineRowSpacing}
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
            // Same normalized check as the Explorer "Open Editors" list and
            // the close/quit "Save changes?" prompt. See tabIsDirty.
            isDirty: tabIsDirty(tab),
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
        localDraft={deferredLocalDraft}
        syncLocalDraft={localDraft}
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
        lineHeight={settings.editorLineHeight || DEFAULT_SETTINGS.editorLineHeight}
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
            <LinkPopup
              editor={editor}
              enabled={currentMode === 'Wysiwyg'}
              activeDocumentPath={snapshot.activeDocumentPath}
            />
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
