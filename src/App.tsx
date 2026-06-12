import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  message,
  open as openDialog,
  save as saveDialog,
} from '@tauri-apps/plugin-dialog';
import {
  MarkdownTable,
  sanitizeMarkdownControlChars,
} from '@/components/wysiwyg/tableMarkdownExtensions';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { createCodeBlockExtension } from '@/components/wysiwyg/codeBlockExtension';
import { ImeDebugOverlay } from '@/components/wysiwyg/ImeDebugOverlay';
import { MarkdownLinkInputRule } from '@/components/wysiwyg/markdownLinkInputRule';
import { PreventTableHoverSelection } from '@/components/wysiwyg/preventTableHoverSelection';
import { TableArrowNavigation } from '@/components/wysiwyg/tableArrowNavigation';
import { publishEditorEvent } from '@/lib/editorEvents';
import { imeLog } from '@/lib/imeDebug';
import { EditorView } from '@uiw/react-codemirror';
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

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { UpdateInfo } from '@/lib/updateCheck';
import { ActivityBar } from '@/shell/ActivityBar';
import { AppMenu } from '@/shell/AppMenu';
import { AppOverlays } from '@/shell/AppOverlays';
import { EditorArea } from '@/shell/EditorArea';
import { FindReplaceBar } from '@/shell/FindReplaceBar';
import { MarkdownPreviewPane } from '@/shell/MarkdownPreviewPane';
import { Tabs } from '@/shell/Tabs';
import { TitleBar } from '@/shell/TitleBar';
import {
  SideBar,
  type SearchResultFile,
  type SearchResultMatch,
  type SideBarPanel,
} from '@/shell/SideBar';
import { SidebarResizeHandle } from '@/shell/SidebarResizeHandle';
import { SourceEditorPane } from '@/shell/SourceEditorPane';
import { StatusBar } from '@/shell/StatusBar';
import { UpdateBanner } from '@/shell/UpdateBanner';
import { SettingsTabContent } from '@/shell/SettingsTabContent';
import { WorkspaceTree } from '@/shell/WorkspaceTree';
import { WysiwygEditorChrome } from '@/shell/WysiwygEditorChrome';
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
import {
  buildEditorDocumentMetrics,
  resolveEditorPreviewSource,
} from './lib/editorDocumentState';
import { resolveCloseDecisionAction } from './lib/closeDecision';
import {
  buildCloseConfirmationDialog,
  resolveActiveClosePromptState,
  resolveClosePromptState,
  resolveCloseRequestAction,
} from './lib/closePrompt';
import {
  resolveActiveDraftSyncPlan,
  resolveAutoSaveEligibility,
  resolveDraftMirrorSyncPlan,
} from './lib/draftSync';
import {
  findTextMatches,
  matchScrollStrategy,
  nextFindMatchIndex,
  nextFindMatchIndexAfterReplace,
  replaceAllMatches,
  replaceSingleMatch,
  resolveFindReplaceViewState,
  type FindReplaceOptions,
  type MatchScrollStrategy,
} from './lib/findReplace';
import {
  MARKDOWN_FILE_EXTENSIONS,
  defaultOpenDocumentDialogPath,
  defaultOpenWorkspaceDialogPath,
  defaultMarkdownSavePath,
  normalizeOpenDialogPaths,
} from './lib/fileDialogOptions';
import { getErrorMessage } from './lib/errors';
import { createMarkdownImageExtension } from './lib/wysiwygImageExtension';
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
  createDocumentTab,
  createMissingDocumentTab,
  findDocumentTabByPath,
  generateDocumentTabId,
  hydrateRestoredActiveDocumentTab,
  markDocumentTabMissing,
  mergeRestoredDocumentTabs,
  popClosedDocumentTab,
  refreshActiveDocumentTabFromSnapshot,
  refreshSwitchedDocumentTabFromSnapshot,
  rememberClosedDocumentTab,
  resolveCloseTabTransition,
  resolveDocumentTabViewState,
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
  sourceEditorSelectionForLocation,
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
import { useUpdateCheck } from './lib/useUpdateCheck';
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
} from './lib/shellDisplay';
import {
  buildShellChromeModel,
} from './lib/shellModel';
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
  resolveWordWrapShortcut,
} from './lib/keyboardShortcuts';
import type { OutlineItem } from './lib/outline';
import {
  resolveOutlineMatchByOccurrence,
  resolveOutlineNavigationTarget,
} from './lib/outlineNavigation';
import { syncScrollPosition } from './lib/scrollSync';
import {
  estimateRenderedTextOffset,
  getRenderedTextOffset,
  readSourceNumber,
  resolveSourcePreviewSelectionOffset,
} from './lib/sourcePreviewClick';
import { buildSourceEditorExtensions } from './lib/sourceEditorExtensions';
import { resolveSourceSurfaceMouseDown } from './lib/sourceEditorInteractions';
import { shouldFocusStartupEditor } from './lib/startupEditorFocus';
import { parseNativeMenuCommand } from './lib/nativeMenuCommand';
import {
  createLatestRequestTracker,
  type LatestRequestTracker,
} from './lib/latestRequest';
import {
  buildSourceLineStartOffsets,
  clampSourceOffset,
  sourceOffsetForLine,
} from './lib/sourceText';
import {
  defaultMdHandlerStatus,
  setDefaultMdHandler,
  shouldShowDefaultAppPrompt,
  type DefaultMdHandlerStatus,
} from './lib/defaultApp';
import {
  findWysiwygTextMatches,
  isWysiwygFindMatch,
  replaceWysiwygTextMatch,
  replaceWysiwygTextMatches,
  selectWysiwygFindMatch,
} from './lib/wysiwygFind';
import {
  computeTableCaretCarryForward,
  computeTableCaretCorrection,
  focusCodeBlockLanguageSelectorOnArrowUp,
  shouldSuppressDuplicateImeTextInput,
  shouldSuppressSyntheticImeEnter,
} from './lib/wysiwygKeyboard';
import {
  resolveWysiwygContentSyncAction,
  resolvePersistedWysiwygMarkdown,
} from './lib/wysiwygEditorSync';
import { serializeWysiwygSliceToMarkdown } from './lib/wysiwygCopy';
import {
  handleWysiwygPlainTextPaste,
  isPlainTextPasteRequest,
} from './lib/wysiwygPaste';
import {
  collectWorkspaceFolderKeys,
  displayFileName,
  displayWorkspacePath,
  pruneCollapsedWorkspaceFolderKeys,
  resolveWorkspaceTreeViewState,
  toggleWorkspaceFolderKey,
} from './lib/workspaceTree';
import {
  buildQuickOpenSignature,
  resolveQuickOpenSelectionKind,
  resolveQuickOpenViewState,
} from './lib/quickOpenItems';
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
  nextSidebarWidthFromKey,
  readSidebarState,
  readSidebarWidth,
  resolveSidebarLayoutState,
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
// Max gap between a syllable's compositionend and the next syllable's
// compositionstart for the table-cell caret carry-forward to apply. Continuous
// CJK typing fires these within tens of ms; deliberate caret moves are slower.
const CARRY_FORWARD_WINDOW_MS = 600;

/**
 * True when the current selection's anchor sits inside a table cell. Used to
 * scope the WebKit composition caret-jump correction to table cells only —
 * plain paragraph composition works correctly and must not be touched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectionInsideTableCell(state: any): boolean {
  const $from = state?.selection?.$from;
  if (!$from) return false;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth)?.type?.spec?.tableRole;
    if (role === 'cell' || role === 'header_cell') return true;
  }
  return false;
}

function useLatestRequestTracker(): LatestRequestTracker {
  const trackerRef = useRef<LatestRequestTracker | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = createLatestRequestTracker();
  }
  return trackerRef.current;
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
  const searchRequests = useLatestRequestTracker();
  const [shellAnnouncement, setShellAnnouncement] = useState('');
  const [manualUpdateCheckInfo, setManualUpdateCheckInfo] = useState<UpdateInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [defaultMdHandler, setDefaultMdHandlerStatus] =
    useState<DefaultMdHandlerStatus | null>(null);
  const [defaultAppPromptOpen, setDefaultAppPromptOpen] = useState(false);
  const [defaultAppPromptBusy, setDefaultAppPromptBusy] = useState(false);
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
  // The exact markdown bytes most recently *loaded into* the editor (via
  // setContent / external sync). Untouched after the load; if the editor's
  // current `getMarkdown()` still matches `lastLoadedCanonicalRef` we know
  // the user hasn't authored any structural edits and can preserve the
  // original bytes verbatim instead of writing the lossy round-trip back to
  // disk. Without this, opening a file that contains markdown shapes
  // @tiptap/markdown can't perfectly round-trip (raw HTML blocks, tilde
  // code fences, explicit `<https://…>` autolinks, escaped `\*` …) would
  // overwrite the file with a normalised, content-shifted equivalent the
  // moment the user pressed Cmd+S.
  const lastLoadedMarkdownRef = useRef<string | null>(null);
  // The result of `editor.getMarkdown()` immediately after the load above —
  // i.e. the canonical round-trip of `lastLoadedMarkdownRef`. The flush
  // compares its serialised output against this value: equal => zero
  // edits => save original bytes; different => user edited => save the
  // serialised form (the only path that can lose lossy fragments, and only
  // for regions the user actually touched).
  const lastLoadedCanonicalRef = useRef<string | null>(null);
  // Tracks which tab's content the editor currently displays. Allows the
  // sync effect to detect tab switches even when both tabs share identical
  // markdown (e.g. a fresh untitled doc after closing another empty one),
  // which the markdown-only comparison would silently skip.
  const lastEditorActiveTabIdRef = useRef<string | null>(null);
  const isWysiwygComposingRef = useRef(false);
  // Set when the user presses Enter WHILE a CJK syllable is still composing.
  // In WebKit (Tauri) that Enter commits the in-flight syllable but does NOT
  // also insert a newline — the keydown is consumed by the IME. So the user
  // types "안녕", hits Enter, sees the syllable finalize but no line break,
  // and concludes "엔터가 안 먹는다". We remember the intent here and replay
  // a real Enter once `compositionend` fires and the doc is stable again.
  const pendingEnterAfterCompositionRef = useRef(false);
  // Document position where the current CJK composition began, captured at
  // compositionstart ONLY when the caret is inside a table cell. WebKit
  // jumps the caret to the cell start after the first syllable of an
  // empty cell commits, so the next syllable inserts in front of it and
  // "안녕하세요" comes out "녕하세요안". On compositionend we use this anchor
  // to detect that backward jump and restore the caret to anchor + the
  // committed length. Null when composition started outside a table cell
  // (plain paragraphs don't exhibit the bug and must stay untouched).
  const tableCompositionAnchorRef = useRef<number | null>(null);
  // Where the PREVIOUS composition in the current table cell left the caret
  // (anchor + committed length). At the NEXT syllable's compositionstart we
  // check whether WebKit has reset the caret to before this position and, if
  // so, move it forward before the new syllable composes — the primary repair
  // for the reversal, since a compositionend-time fix can't run while
  // `view.composing` lingers between syllables. Null outside a cell / after a
  // commit that moved on cleanly.
  const tableCompositionExpectedEndRef = useRef<number | null>(null);
  const wysiwygCompositionFlushTimerRef = useRef<number | null>(null);
  // Wall-clock timestamp of the most recent WYSIWYG compositionend. Used to
  // suppress synthetic Enter keys that ProseMirror's readDOMChange dispatches
  // when WebKit's Korean IME injects block-level DOM nodes (an empty <p>
  // after the heading) between syllables — without this, every Hangul
  // syllable after the first splits the heading into heading + paragraph.
  const lastWysiwygCompositionEndAtRef = useRef<number>(0);
  // Most-recent compositionend payload. The duplicate-syllable guard in
  // handleTextInput uses it for the post-commit tail window: with no
  // composition in flight only the just-committed syllable can echo, so an
  // insertion that doesn't match this value is the user's own typing.
  const lastWysiwygCompositionDataRef = useRef<string>('');
  // Latest compositionupdate data of the IN-FLIGHT composition (null when
  // none). A pure insertion equal to this value is the composition itself
  // landing — i.e. a legitimately repeated character (ㅐㅐㅐ, ㅋㅋㅋ) — and
  // must never be swallowed by the WebKit duplicate-echo guard.
  const activeWysiwygCompositionDataRef = useRef<string | null>(null);
  // Bumped every time the localDraft→editor sync effect replaces the document
  // via setContent. Deferred composition-repair timers capture the epoch when
  // they're scheduled and bail if the doc was replaced in the meantime —
  // their saved absolute positions are meaningless in the new doc.
  const wysiwygDocReplaceEpochRef = useRef(0);
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
  const lastSourceSelectionDocumentKeyRef = useRef<string | null>(null);
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
  const [closedDocumentTabs, setClosedDocumentTabs] = useState<DocumentTab[]>([]);
  const [startupTabsReady, setStartupTabsReady] = useState(false);
  // Mirror tabs/activeTabId in refs so async callbacks (bootstrap.then,
  // openDocument.then) can read the *current* values instead of stale
  // closures — without this, a user opening Settings before bootstrap
  // finishes loses the settings tab when upsertActiveTabFromSnapshot fires.
  const tabsRef = useRef<DocumentTab[]>(tabs);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  const closedDocumentTabsRef = useRef<DocumentTab[]>(closedDocumentTabs);
  const startupTabsReadyRef = useRef<boolean>(startupTabsReady);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    closedDocumentTabsRef.current = closedDocumentTabs;
  }, [closedDocumentTabs]);
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

  const setClosedDocumentTabStack = (nextClosedTabs: DocumentTab[]) => {
    closedDocumentTabsRef.current = nextClosedTabs;
    setClosedDocumentTabs(nextClosedTabs);
  };

  const snapshotClosedDocumentTab = (
    targetId: string | null,
    activeDraftOverride?: string | null,
  ): DocumentTab | null => {
    if (!targetId) return null;
    const target = tabsRef.current.find((tab) => tab.id === targetId);
    if (!target || target.kind !== 'document') return null;

    const activeDraft =
      target.id === activeTabIdRef.current
        ? activeDraftOverride ?? flushWysiwygDraftNow() ?? localDraft
        : target.draft;

    return {
      ...target,
      draft: activeDraft,
    };
  };

  const rememberClosedTab = (closedTab: DocumentTab | null) => {
    if (!closedTab) return;
    setClosedDocumentTabStack(
      rememberClosedDocumentTab({
        closedTabs: closedDocumentTabsRef.current,
        closedTab,
      }),
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

  // Heavy text-derived values: defer document metrics off the keystroke
  // critical path. CodeMirror still sees the live draft for selection and
  // line-offset mapping, while React schedules stats and outline work at a
  // lower priority.
  const deferredLocalDraft = useDeferredValue(localDraft);

  const { documentStats, outlineItems } = useMemo(
    () =>
      buildEditorDocumentMetrics({
        activeDocumentOpen,
        deferredDraft: deferredLocalDraft,
      }),
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
    options: { focusEditor?: boolean; alignTop?: boolean; centerIfOffscreen?: boolean } = {},
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
      } else if (options.centerIfOffscreen) {
        // VS Code/Zed find reveal: center the match when it is offscreen,
        // keep the viewport still when it is already visible.
        let strategy: MatchScrollStrategy = 'center';
        try {
          const block = view.lineBlockAt(nextSelectionStart);
          strategy = matchScrollStrategy({
            blockTop: block.top,
            blockBottom: block.bottom,
            scrollTop: view.scrollDOM.scrollTop,
            clientHeight: view.scrollDOM.clientHeight,
          });
        } catch {
          strategy = 'center';
        }
        view.dispatch(
          strategy === 'center'
            ? {
                selection,
                effects: EditorView.scrollIntoView(nextSelectionStart, { y: 'center' }),
              }
            : { selection },
        );
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

  const sourceMarkdownOffsetFromCurrentSelection = () => {
    const view = sourceEditorViewRef.current;
    if (view) {
      return clampSourceOffset(view.state.selection.main.head, localDraft.length);
    }

    const sourceTextarea = sourceEditorContainerRef.current?.querySelector('textarea');
    if (sourceTextarea instanceof HTMLTextAreaElement) {
      const selectionHead =
        sourceTextarea.selectionDirection === 'backward'
          ? sourceTextarea.selectionStart
          : sourceTextarea.selectionEnd;
      return clampSourceOffset(selectionHead, localDraft.length);
    }

    const lineStart = getSourceOffsetForLine(cursorPosition.line);
    return clampSourceOffset(lineStart + Math.max(0, cursorPosition.column - 1), localDraft.length);
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
   * based on the current mode. Used by Cmd+0 (toggle back to editor),
   * Cmd+1..9 (jump-to-tab from Explorer) and every file-open path so the
   * caret lands on the document the user just selected. useEffectEvent so
   * mount-time closures (drag-and-drop listener, second-instance handler)
   * read the CURRENT mode instead of the one captured at mount — a stale
   * 'Wysiwyg' read would focus a display:none surface and silently no-op.
   */
  const focusActiveEditor = useEffectEvent(() => {
    focusActiveEditorTarget({
      currentMode,
      sourceEditorView: sourceEditorViewRef.current,
      sourceEditorContainer: sourceEditorContainerRef.current,
    });
  });

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
    const outlineTarget = resolveOutlineNavigationTarget(localDraft, item);

    if (currentMode === 'Wysiwyg') {
      const matches = findWysiwygTextMatches(editor, outlineTarget.titleText, {
        caseSensitive: true,
        wholeWord: false,
        regex: false,
      }).matches.filter(isWysiwygFindMatch);
      const match = resolveOutlineMatchByOccurrence(
        matches,
        outlineTarget.titleOccurrenceIndex,
      );

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

    focusSourceSelection(outlineTarget.sourceOffset, outlineTarget.sourceOffset, {
      alignTop: true,
    });
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
  // memoised source editor host and forcing CodeMirror to
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
    const action = resolveSourceSurfaceMouseDown({
      currentMode,
      view: sourceEditorViewRef.current,
      target: event.target as Node | null,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (action.kind === 'ignore') return;

    event.preventDefault();
    focusSourceSelection(action.position);
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
    const renderedTextLength = sourceLineElement.textContent?.length ?? 0;
    const renderedOffset =
      getRenderedTextOffset(sourceLineElement, event.clientX, event.clientY) ??
      estimateRenderedTextOffset(sourceLineElement, event, renderedTextLength);
    const selectionOffset = resolveSourcePreviewSelectionOffset({
      source: localDraft,
      lineStart,
      sourceOffset: readSourceNumber(sourceLineElement, 'sourceOffset'),
      sourceEndOffset: readSourceNumber(sourceLineElement, 'sourceEndOffset'),
      renderedText: sourceLineElement.textContent ?? '',
      renderedOffset,
    });

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
    // Defense in depth: documents corrupted by the old table serializer carry
    // literal U+001F cell separators; heal them (→ space) before the draft
    // can reach the mirror/save paths so the bytes never go back to disk.
    const sanitized = sanitizeMarkdownControlChars(markdown);
    lastEditorMarkdownRef.current = sanitized;
    setLocalDraft(sanitized);
  });

  // Serialize the editor's current state into localDraft. Skips silently when
  // not in WYSIWYG mode or while a CJK IME composition is in flight; the
  // compositionend handler reschedules in that case.
  const runWysiwygFlush = useEffectEvent(() => {
    if (currentModeRef.current !== 'Wysiwyg') return;
    const ed = editorInstanceRef.current;
    if (!ed) return;
    if (isWysiwygComposingRef.current || ed.view?.composing) return;
    publishWysiwygMarkdownDraft(
      resolvePersistedWysiwygMarkdown(
        ed.getMarkdown(),
        lastLoadedMarkdownRef.current,
        lastLoadedCanonicalRef.current,
      ),
    );
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
    const markdown = resolvePersistedWysiwygMarkdown(
      ed.getMarkdown(),
      lastLoadedMarkdownRef.current,
      lastLoadedCanonicalRef.current,
    );
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
  // Same idea as `wysiwygCursorLocationRef` but stores the markdown character
  // offset directly. The mode-switch handoff prefers this over reading
  // `editor.state.selection.head` live, because the live read can race with
  // intermediate transactions (display:none → blur, debounced flushes, the
  // localDraft sync effect) that briefly reset ProseMirror selection to 0.
  // The cached value is always the offset Tiptap reported the last time the
  // user actually moved the caret, which is what the user wants preserved.
  const wysiwygCursorOffsetRef = useRef<number>(0);
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
      createMarkdownImageExtension(() => activeDocumentPathRef.current),
      // MarkdownTable = stock Table + non-corrupting markdown round-trip
      // ('|' escaped in cells, multi-block cells joined with <br> instead of
      // a literal U+001F byte, no phantom header row on headerless tables).
      MarkdownTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PreventTableHoverSelection,
      // Deterministic Up/Down navigation between table rows (same column).
      // prosemirror-tables leaves vertical movement to the browser, which
      // WebKit gets wrong (Down jumps to the cell on the right). Must sit
      // before StarterKit-derived handlers so its ArrowUp/Down win inside a
      // table; outside a table it returns false and the defaults run.
      TableArrowNavigation,
      TaskList,
      TaskItem.configure({ nested: true }),
      // Recognise literal `[text](url)` as the user types — Tiptap's built-in
      // link extension only autolinks bare URLs and handles paste rules, not
      // the markdown bracket-paren syntax.
      MarkdownLinkInputRule,
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
        // Cmd+/ (Ctrl+/) — open the slash command menu at the current caret,
        // regardless of where the caret sits inside the block. The "type / at
        // block start" behaviour stays as-is; this shortcut is the
        // discoverable, position-agnostic equivalent users reach for after
        // they've typed something on the line.
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key === '/'
        ) {
          event.preventDefault();
          publishEditorEvent('slash:open-at-cursor', {});
          return true;
        }
        // Cmd+K (Ctrl+K on Win/Linux) — open the inline link editor at the
        // current selection. Mirrors the convention used by Notion / Google
        // Docs / Slack. We use the editor instance via the closure-stable ref
        // because `view` here only exposes ProseMirror primitives, not Tiptap
        // chain commands.
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          (event.key === 'k' || event.key === 'K')
        ) {
          const ed = editorInstanceRef.current;
          if (ed) {
            event.preventDefault();
            const { from, to } = ed.state.selection;
            const hasLink = ed.isActive('link');
            if (from === to && !hasLink) {
              // Empty caret: insert literal "link" text, select it, and
              // apply the link mark so the popup has a target to anchor on.
              // Matches the slash-menu Link item.
              ed.chain()
                .focus()
                .insertContent('link')
                .setTextSelection({ from, to: from + 4 })
                .setLink({ href: 'https://' })
                .run();
            } else if (!hasLink) {
              ed.chain()
                .focus()
                .extendMarkRange('link')
                .setLink({ href: 'https://' })
                .run();
            }
            publishEditorEvent('link:edit-request', { focusInput: true });
            return true;
          }
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
        const suppressed = shouldSuppressDuplicateImeTextInput({
          from,
          to,
          text,
          isComposing: isWysiwygComposingRef.current,
          lastCompositionEndAt: lastWysiwygCompositionEndAtRef.current,
          compositionData: activeWysiwygCompositionDataRef.current,
          lastCompositionData: lastWysiwygCompositionDataRef.current,
          textBetween: view.state.doc.textBetween.bind(view.state.doc),
        });
        imeLog('handleTextInput', view, {
          from,
          to,
          text,
          suppressed,
          inTable: view.state?.selection?.$from?.node
            ? view.state.selection.$from.parent.type.name
            : undefined,
        });
        if (suppressed) {
          return true;
        }
        return false;
      },
      handlePaste: (view: any, event: ClipboardEvent) =>
        handleWysiwygPlainTextPaste(
          view,
          event,
          editorInstanceRef.current,
          // Cmd/Ctrl+Shift+V → paste verbatim, bypassing markdown rendering.
          isPlainTextPasteRequest(view),
        ),
      // Copy/cut put markdown source on the clipboard's text/plain flavor
      // (the text/html flavor keeps the rich content for rich-text targets).
      clipboardTextSerializer: (slice: any) =>
        serializeWysiwygSliceToMarkdown(slice, editorInstanceRef.current),
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
        // DOM-level keydown sees every physical keypress, including the
        // Enter that WebKit routes straight into the IME during composition
        // (which never reaches ProseMirror's keymap). When that Enter lands
        // mid-composition we record the intent so `compositionend` can
        // replay it as a genuine newline.
        keydown: (view: any, event: Event) => {
          const ke = event as KeyboardEvent;
          const composingNow =
            ke.isComposing ||
            (view as { composing?: boolean }).composing ||
            isWysiwygComposingRef.current;
          if (ke.key === 'Enter') {
            imeLog('keydown Enter', view, {
              isComposing: ke.isComposing,
              viewComposing: (view as { composing?: boolean }).composing,
              refComposing: isWysiwygComposingRef.current,
              isTrusted: ke.isTrusted,
            });
          }
          if (
            ke.key === 'Enter' &&
            !ke.shiftKey &&
            !ke.metaKey &&
            !ke.ctrlKey &&
            !ke.altKey &&
            composingNow
          ) {
            pendingEnterAfterCompositionRef.current = true;
          }
          // A deliberate caret move ends the CJK syllable burst: the
          // carry-forward repair must not yank the caret back to where the
          // previous syllable ended after the user navigated away on purpose.
          // (The 600ms wall clock alone can't tell fast navigation from the
          // reversal cascade.) Composition-time arrows are left alone — they
          // belong to the IME.
          if (
            !composingNow &&
            (ke.key === 'ArrowLeft' ||
              ke.key === 'ArrowRight' ||
              ke.key === 'ArrowUp' ||
              ke.key === 'ArrowDown' ||
              ke.key === 'Home' ||
              ke.key === 'End' ||
              ke.key === 'PageUp' ||
              ke.key === 'PageDown')
          ) {
            tableCompositionExpectedEndRef.current = null;
            lastWysiwygCompositionEndAtRef.current = 0;
          }
          return false;
        },
        mousedown: () => {
          // Clicking is the clearest "burst over" signal — same rationale as
          // the navigation keys above.
          tableCompositionExpectedEndRef.current = null;
          lastWysiwygCompositionEndAtRef.current = 0;
          return false;
        },
        compositionstart: (view: any) => {
          isWysiwygComposingRef.current = true;
          activeWysiwygCompositionDataRef.current = '';
          imeLog('compositionstart', view);
          // Primary WebKit reversal repair: before this syllable composes, if
          // the caret was reset back to the cell start after the previous
          // syllable, move it forward to where that syllable ended. No-op
          // outside a cell and whenever the caret is already in place (Chrome).
          const inCell = selectionInsideTableCell(view.state);
          // Only carry forward across a rapid syllable burst (the reversal
          // cascade fires within tens of ms). A deliberate click-then-type is
          // far slower, so this guards against repositioning the caret when the
          // user intentionally moved it backward in a cell.
          const continuousBurst =
            Date.now() - lastWysiwygCompositionEndAtRef.current < CARRY_FORWARD_WINDOW_MS;
          if (inCell && continuousBurst) {
            const carry = computeTableCaretCarryForward({
              expectedEnd: tableCompositionExpectedEndRef.current,
              currentCaret: view.state.selection.from,
              docSize: view.state.doc.content.size,
              insideTableCell: true,
            });
            if (carry !== null) {
              const ed = editorInstanceRef.current;
              ed?.chain().setTextSelection(carry).run();
              imeLog('cell caret carry-forward', ed?.view ?? view, {
                to: carry,
              });
            }
          }
          tableCompositionExpectedEndRef.current = null;
          // Record where this composition begins (after any carry-forward),
          // but only inside a table cell (the only place the reversal occurs).
          tableCompositionAnchorRef.current = inCell
            ? editorInstanceRef.current?.state.selection.from ?? view.state.selection.from
            : null;
          if (wysiwygCompositionFlushTimerRef.current !== null) {
            window.clearTimeout(wysiwygCompositionFlushTimerRef.current);
            wysiwygCompositionFlushTimerRef.current = null;
          }
          return false;
        },
        compositionupdate: (view: any, event: Event) => {
          // `compositionupdate` fires before the DOM mutation, so by the time
          // readDOMChange calls handleTextInput this ref already holds the
          // text the composition is about to insert.
          activeWysiwygCompositionDataRef.current = (event as CompositionEvent).data ?? '';
          imeLog('compositionupdate', view, { data: (event as CompositionEvent).data });
          return false;
        },
        compositionend: (_view: any, event: Event) => {
          isWysiwygComposingRef.current = false;
          activeWysiwygCompositionDataRef.current = null;
          lastWysiwygCompositionEndAtRef.current = Date.now();
          lastWysiwygCompositionDataRef.current =
            (event as CompositionEvent).data ?? '';
          imeLog('compositionend', _view, {
            data: (event as CompositionEvent).data,
            pendingEnter: pendingEnterAfterCompositionRef.current,
          });
          // Replay an Enter that was swallowed by the IME mid-composition.
          //
          // Timing is the subtle part: prosemirror-view keeps
          // `view.composing === true` for ~50ms AFTER `compositionend`
          // fires (its composition-cleanup timeout). An earlier revision
          // ran this replay on a 0ms timer and bailed when
          // `view.composing` was still true — so in WebKit (where the flag
          // lingers) the replay almost always bailed and the newline was
          // lost: "한글 입력 후 엔터가 안 먹는다". We now (a) wait past that
          // window and (b) do NOT bail on `view.composing` — we already
          // know the composition ended because we're inside its handler;
          // we only re-check that we're still in WYSIWYG mode and that a
          // brand-new composition hasn't begun (tracked by our own ref,
          // which compositionstart sets synchronously).
          if (pendingEnterAfterCompositionRef.current) {
            pendingEnterAfterCompositionRef.current = false;
            const replayEpoch = wysiwygDocReplaceEpochRef.current;
            window.setTimeout(() => {
              const ed = editorInstanceRef.current;
              if (!ed || currentModeRef.current !== 'Wysiwyg') return;
              // A genuinely new composition starting cancels the replay
              // (the user kept typing rather than wanting a newline).
              if (isWysiwygComposingRef.current) return;
              // The doc was replaced (tab switch, external reload) since the
              // Enter was swallowed — the intent no longer applies.
              if (wysiwygDocReplaceEpochRef.current !== replayEpoch) return;
              ed.chain()
                .focus()
                .command(({ commands }) =>
                  // Mirror Tiptap's real Enter keymap so the replayed newline
                  // behaves identically to a non-IME Enter in every block.
                  // The base keymap (newlineInCode/createParagraphNear/
                  // liftEmptyBlock/splitBlock) does NOT know about list items —
                  // those are added by the list extensions — so without the
                  // splitListItem steps a replayed Enter inside a list split the
                  // paragraph wrongly instead of making a new item / exiting an
                  // empty one. On an empty item splitListItem fails and
                  // liftEmptyBlock lifts it out (double-Enter exits the list);
                  // the same liftEmptyBlock handles exiting an empty blockquote
                  // line.
                  commands.first([
                    () => commands.splitListItem('taskItem'),
                    () => commands.splitListItem('listItem'),
                    () => commands.newlineInCode(),
                    () => commands.createParagraphNear(),
                    () => commands.liftEmptyBlock(),
                    () => commands.splitBlock(),
                  ]),
                )
                .run();
            }, 80);
          }
          // Table-cell caret-jump correction. WebKit can reset the caret to
          // the cell start after committing the first syllable in a
          // previously-empty cell, so the next syllable lands in front of it
          // ("안녕하세요" → "녕하세요안"). We recorded the composition anchor
          // at compositionstart; if the caret has jumped to BEFORE
          // anchor + committed-length, push it back to where it belongs. We
          // act only when the jump actually happened (otherwise it's a no-op,
          // no jank) and only inside a table cell (paragraphs are untouched).
          // Deferred past ProseMirror's ~50ms composition-cleanup window so
          // our correction isn't overwritten when the view finalises.
          const anchor = tableCompositionAnchorRef.current;
          const committed = (event as CompositionEvent).data ?? '';
          tableCompositionAnchorRef.current = null;
          if (anchor !== null && committed.length > 0) {
            // Hand the expected end position to the next syllable's
            // compositionstart, which is where the reversal is actually
            // repaired (view.composing lingers here, blocking the timer below).
            tableCompositionExpectedEndRef.current = anchor + committed.length;
            const correctionEpoch = wysiwygDocReplaceEpochRef.current;
            window.setTimeout(() => {
              const ed = editorInstanceRef.current;
              if (!ed || currentModeRef.current !== 'Wysiwyg') return;
              if (isWysiwygComposingRef.current || ed.view?.composing) return;
              // `anchor` is an absolute position in the doc as it existed at
              // compositionstart; if setContent replaced the doc since, the
              // correction would move the caret to a meaningless coordinate.
              if (wysiwygDocReplaceEpochRef.current !== correctionEpoch) return;
              const current = ed.state.selection.from;
              const target = computeTableCaretCorrection({
                anchor,
                committedLength: committed.length,
                currentCaret: current,
                docSize: ed.state.doc.content.size,
                insideTableCell: selectionInsideTableCell(ed.state),
              });
              if (target !== null) {
                ed.chain().setTextSelection(target).run();
                imeLog('cell caret corrected', ed.view, { from: current, to: target });
              }
            }, 60);
          }
          scheduleWysiwygCompositionFlush();
          return false;
        },
        compositioncancel: () => {
          isWysiwygComposingRef.current = false;
          activeWysiwygCompositionDataRef.current = null;
          pendingEnterAfterCompositionRef.current = false;
          tableCompositionAnchorRef.current = null;
          tableCompositionExpectedEndRef.current = null;
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
      imeLog('onUpdate', nextEditor.view, {
        composing: nextEditor.view?.composing,
        refComposing: isWysiwygComposingRef.current,
      });
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
      imeLog('onSelectionUpdate', nextEditor.view, {
        composing: nextEditor.view?.composing,
        parent: nextEditor.state.selection.$from.parent.type.name,
      });
      // Mirror the WYSIWYG selection as a markdown source location (line +
      // column) so mode switches can hand the caret to CodeMirror at the same
      // logical position.
      const location = wysiwygCursorSourceLocation(nextEditor);
      wysiwygCursorLocationRef.current = location;
      wysiwygCursorOffsetRef.current = wysiwygCursorMarkdownOffset(nextEditor);
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
  const findViewState = resolveFindReplaceViewState({
    sourceResult: sourceFindResult,
    wysiwygResult: wysiwygFindResult,
    activeIndex: activeFindMatchIndex,
    activeDocumentOpen,
    currentMode,
    wysiwygEditorAvailable: Boolean(editor),
  });
  const {
    result: findResult,
    matches: findMatches,
    matchCount: findMatchCount,
    activeMatch: activeFindMatch,
    canReplace: canReplaceFindMatch,
    activeMatchNumber: activeFindMatchNumber,
  } = findViewState;

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

    focusSourceSelection(activeFindMatch.start, activeFindMatch.end, {
      focusEditor: false,
      centerIfOffscreen: true,
    });
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
          // Pair lastEditorMarkdownRef with the draft (see syncActiveDraft) —
          // a bare setLocalDraft would trigger a redundant full-doc setContent
          // that re-parses untouched content and jumps the caret.
          publishWysiwygMarkdownDraft(editor.getMarkdown());
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
          // Same pairing rule as the single-replace path above.
          publishWysiwygMarkdownDraft(editor.getMarkdown());
        }
        setActiveFindMatchIndex(0);
      }
      return;
    }

    setLocalDraft((current) => replaceAllMatches(current, findMatches, findReplacement));
    setActiveFindMatchIndex(0);
  };

  const tabViewState = useMemo(
    () => resolveDocumentTabViewState({ tabs, activeTabId, localDraft }),
    [activeTabId, localDraft, tabs],
  );
  const {
    activeTab,
    isSettingsTabActive,
    hasActiveTabEdits,
    hasAnyTabEdits,
    hasUnsavedChanges,
  } = tabViewState;

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

  const errorMessage = snapshot.lastError;
  const workspaceTreeView = useMemo(
    () =>
      resolveWorkspaceTreeViewState({
        paths: snapshot.workspaceDocuments,
        rootDir: snapshot.rootDir,
        filter: workspaceFilter,
      }),
    [snapshot.rootDir, snapshot.workspaceDocuments, workspaceFilter],
  );
  const {
    tree: workspaceTree,
    filteredTree: filteredWorkspaceTree,
    filtering: filteringWorkspace,
    signature: workspaceTreeSignature,
  } = workspaceTreeView;
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
      // `markdowner file.md` on a running instance is an explicit "open this
      // and let me type" — land the keyboard focus in the editor, matching
      // every other open path.
      focusActiveEditor();
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
          setSettingsLoaded(true);
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

        if (next.activeDocumentSource !== null) {
          // Hydrate the persisted caret map and arm the startup focus + caret
          // directive BEFORE the snapshot commit. Arming after applySnapshot
          // (as this path used to) meant the startup-restore effect had
          // already run for the rendered snapshot and never consumed the
          // directive — a CLI-opened file (which short-circuits the
          // persisted-tabs branch below) ended up with focus outside the
          // editor. The extra load_open_tabs round-trip before first paint is
          // milliseconds; failure is non-fatal.
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
          // No remembered caret still deserves startup focus at the doc start.
          if (!startupRestoreRef.current && next.activeDocumentPath) {
            startupRestoreRef.current = { path: next.activeDocumentPath, location: null };
          }
          applySnapshot(next);
          upsertActiveTabFromSnapshot(next, {
            markStartupTabsReady: true,
            preserveSettingsActive: true,
          });
          return;
        }
        applySnapshot(next);

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

  useEffect(() => {
    if (!activeDocumentOpen) return;

    const documentKey = `${activeTabId ?? 'none'}:${snapshot.activeDocumentPath ?? 'untitled'}`;
    if (lastSourceSelectionDocumentKeyRef.current === documentKey) return;
    // Track the document identity unconditionally so a later mode switch
    // (Wysiwyg → Source) on the *same* doc doesn't re-enter this branch and
    // fight the cursor-handoff effect for the caret position.
    const isInitialObservation = lastSourceSelectionDocumentKeyRef.current === null;
    lastSourceSelectionDocumentKeyRef.current = documentKey;
    if (currentMode === 'Wysiwyg') return;
    // Initial mount is handled by the startup-restore effect; skip restoring
    // again here so we don't dispatch a competing selection on first paint.
    if (isInitialObservation) return;
    // The Settings tab hides the editor column with `display:none`; a
    // scrollIntoView dispatch against zero-sized rects poisons CodeMirror's
    // cached geometry (WKWebView never re-measures on unhide). The key above
    // is already recorded, and returning from Settings changes activeTabId
    // again, so the restore still runs once the editor is visible.
    if (isSettingsTabActive) return;

    const savedLocation = snapshot.activeDocumentPath
      ? cursorByPathRef.current.get(snapshot.activeDocumentPath)
      : null;
    const location = savedLocation ?? { line: 1, column: 1 };
    const targetOffset = getSourceOffsetForLine(location.line) + Math.max(0, location.column - 1);
    const frame = window.requestAnimationFrame(() => {
      focusSourceSelection(targetOffset, targetOffset, { focusEditor: false });
    });
    return () => window.cancelAnimationFrame(frame);
    // This effect is keyed by the active document identity, not cursor motion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocumentOpen, activeTabId, currentMode, snapshot.activeDocumentPath, sourceEditorViewToken]);

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

  const markDefaultAppPromptSeen = () => {
    if (settings.defaultAppPromptSeen) return;
    handleSettingsChange({ ...settings, defaultAppPromptSeen: true });
  };

  const refreshDefaultMdHandlerStatus = async () => {
    const status = await defaultMdHandlerStatus();
    setDefaultMdHandlerStatus(status);
    return status;
  };

  const handleDefaultAppPromptOpenChange = (open: boolean) => {
    setDefaultAppPromptOpen(open);
    if (!open) {
      markDefaultAppPromptSeen();
    }
  };

  const handleSkipDefaultAppPrompt = () => {
    setDefaultAppPromptOpen(false);
    markDefaultAppPromptSeen();
  };

  const handleMakeDefaultApp = async () => {
    setDefaultAppPromptBusy(true);
    try {
      await setDefaultMdHandler();
      await refreshDefaultMdHandlerStatus();
    } catch (error) {
      reportOperationError(error, 'Could not make Markdowner the default Markdown app');
    } finally {
      setDefaultAppPromptBusy(false);
      setDefaultAppPromptOpen(false);
      markDefaultAppPromptSeen();
    }
  };

  const updateCheck = useUpdateCheck(settings, handleSettingsChange, settingsLoaded, {
    onManualCheckComplete: (result) => {
      setManualUpdateCheckInfo(result.available ? null : result);
    },
  });

  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    defaultMdHandlerStatus()
      .then((status) => {
        if (cancelled) return;
        setDefaultMdHandlerStatus(status);
        if (
          shouldShowDefaultAppPrompt({
            promptSeen: settings.defaultAppPromptSeen,
            status,
          })
        ) {
          setDefaultAppPromptOpen(true);
        }
      })
      .catch((error) => {
        console.error('Failed to query default Markdown app status:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsLoaded, settings.defaultAppPromptSeen]);

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
    const plan = resolveDraftMirrorSyncPlan({
      activeDocumentSource: snapshot.activeDocumentSource,
      activeDocumentPath: snapshot.activeDocumentPath,
      localDraft,
    });
    if (!plan) {
      return;
    }

    const timeout = window.setTimeout(() => {
      replaceActiveDocumentSource(plan.draft)
        .then((next) => {
          startTransition(() => {
            setSnapshot((current) =>
              resolveSyncedDraftSnapshot(current, next, plan.activeDocumentPath),
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

    const syncAction = resolveWysiwygContentSyncAction({
      activeTabId,
      lastSyncedTabId: lastEditorActiveTabIdRef.current,
      localDraft,
      lastEditorMarkdown: lastEditorMarkdownRef.current,
      isComposing: isWysiwygComposingRef.current,
      viewComposing: editor.view?.composing,
    });

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
    // Same-tab CJK IME safety is part of the skip decision: replacing the doc
    // mid-composition tears down ProseMirror's docView, while a tab change
    // must still proceed after finalizing the IME below.
    if (syncAction.kind === 'skip') {
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
    if (syncAction.shouldFinalizeComposition) {
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
    // The setContent below replaces the whole document, so any absolute
    // positions the WebKit table-cell caret repair captured beforehand are
    // meaningless afterwards — drop them and invalidate the deferred repair
    // timers (they compare this epoch) so the caret can't be yanked to a
    // stale pre-replacement coordinate.
    wysiwygDocReplaceEpochRef.current += 1;
    tableCompositionAnchorRef.current = null;
    tableCompositionExpectedEndRef.current = null;
    const nextContent = localDraft || '';
    const setContentOptions = {
      contentType: 'markdown',
      emitUpdate: false,
    } as const;

    if (syncAction.shouldClearDomSelection) {
      const editorDom = editor.view?.dom;
      const rangeApiHasGeometry =
        typeof editorDom?.ownerDocument?.createRange === 'function' &&
        typeof editorDom.ownerDocument.createRange().getClientRects === 'function';
      const canCollapseViaEditor =
        typeof HTMLElement === 'undefined' ||
        !(editorDom instanceof HTMLElement) ||
        rangeApiHasGeometry;
      const collapsedViaEditor = canCollapseViaEditor
        ? editor
            .chain()
            .setContent(nextContent, setContentOptions)
            .setTextSelection({ from: 0, to: 0 })
            .run() !== false
        : false;
      if (!canCollapseViaEditor) {
        editor.commands.setContent(nextContent, setContentOptions);
      }
      // ProseMirror's transaction mapper carries the previous tab's
      // selection through the doc replacement above — when the prior
      // selection covered a range (Cmd+A, drag-selected paragraph, a find
      // hit, a node-selected image) the new tab can open with WebKit
      // visibly rendering that range against the new content. Collapse
      // ProseMirror state to a single caret so the focus call
      // that follows (in focusActiveEditor / the user's first click)
      // doesn't paint the entire freshly-loaded file as highlighted.
      // JSDOM lacks Range#getClientRects; in that environment we keep the
      // old DOM-only fallback to avoid ProseMirror's scroll-to-selection path.
      if (!collapsedViaEditor) {
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
    } else {
      editor.commands.setContent(nextContent, setContentOptions);
    }

    // Capture the canonical round-trip of the just-loaded markdown so the
    // save path can detect "user hasn't actually edited anything" and write
    // the original bytes back to disk verbatim. Without this, opening a file
    // containing markdown shapes @tiptap/markdown can't perfectly round-trip
    // (raw HTML blocks, escaped `\*`, tilde fences, autolinks, multi-paragraph
    // list items …) and pressing Cmd+S would silently rewrite the file to
    // the normalised equivalent — exactly the "저장/로드 시 내용 깨짐" bug.
    lastLoadedMarkdownRef.current = nextContent;
    try {
      lastLoadedCanonicalRef.current = editor.getMarkdown();
    } catch {
      lastLoadedCanonicalRef.current = null;
    }
  }, [editor, localDraft, activeTabId]);

  // One-shot startup focus + caret restore. The bootstrap path stashes the
  // target tab's path (and optionally its remembered SourceCursorLocation)
  // into startupRestoreRef once it picks an active tab. This effect waits
  // for the editor surface for that path to be ready, dispatches the saved
  // selection (or focuses the doc start), and then clears the directive so
  // subsequent tab switches don't re-trigger startup focus.
  //
  // ORDER MATTERS: this effect MUST be declared AFTER the localDraft→editor
  // sync effect above. Effects in the same commit run in declaration order;
  // declared earlier (as it once was) it observed the still-empty placeholder
  // doc in Wysiwyg mode, bailed on the docSize guard, and never re-ran —
  // the sync effect loads content via refs + emitUpdate:false, so none of
  // this effect's deps change afterwards and startup focus stalled forever.
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
      const shouldFocus =
        !isFindReplaceOpenRef.current &&
        shouldFocusStartupEditor({
          activeElement: document.activeElement,
          documentBody: document.body,
          documentElement: document.documentElement,
          editorDom: editorInstance.view.dom,
        });
      try {
        if (pos !== null) {
          if (shouldFocus) {
            editorInstance.chain().focus().setTextSelection(pos).scrollIntoView().run();
          } else {
            editorInstance.chain().setTextSelection(pos).scrollIntoView().run();
          }
        } else if (shouldFocus) {
          editorInstance.chain().focus('start').run();
        }
      } catch {
        if (shouldFocus) {
          editorInstance.commands.focus?.();
        }
      }
      startupRestoreRef.current = null;
      return;
    }
    // Editor / SplitView: drive CodeMirror to the saved line+column.
    const view = sourceEditorViewRef.current;
    if (!view) return;
    if (localDraft.length === 0 && pending.location) return;
    view.dispatch({
      selection: sourceEditorSelectionForLocation(view.state.doc, location),
      scrollIntoView: true,
    });
    if (
      !isFindReplaceOpenRef.current &&
      shouldFocusStartupEditor({
        activeElement: document.activeElement,
        documentBody: document.body,
        documentElement: document.documentElement,
        editorDom: view.dom,
      })
    ) {
      view.focus();
    }
    startupRestoreRef.current = null;
  }, [
    snapshot,
    activeTabId,
    currentMode,
    editor,
    localDraft,
    sourceEditorViewToken,
  ]);

  const previewSource = resolveEditorPreviewSource({
    activeDocumentOpen,
    debouncedDraft: debouncedLocalDraft,
  });
  const sourceEditorExtensions = useMemo(
    () =>
      buildSourceEditorExtensions({
        activeDocumentPath: () => activeDocumentPathRef.current,
        editorLineWrap: settings.editorLineWrap,
        focusModeEnabled: settings.focusModeEnabled,
        typewriterModeEnabled: settings.typewriterModeEnabled,
        onViewportChange: handleSourceEditorViewportChange,
        onTypewriterChange: handleSourceEditorTypewriterChange,
      }),
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
    //
    // Publish through publishWysiwygMarkdownDraft (NOT bare setLocalDraft) so
    // lastEditorMarkdownRef stays paired with the normalized draft. A bare
    // setLocalDraft here desyncs the pair — getMarkdown() never emits a
    // trailing newline, so EVERY post-edit save (autosave tick, Cmd+S,
    // save-on-close) would make the localDraft↔editor sync effect run a
    // destructive whole-document setContent mid-typing: keystrokes inside the
    // 120ms flush window get erased ("ooo" → "o") and the caret is yanked off
    // the typing position. The trailing-newline-only delta parses to an
    // identical ProseMirror doc, so skipping the resync is lossless in both
    // Wysiwyg and source mode.
    if (plan.shouldUpdateLocalDraft) {
      publishWysiwygMarkdownDraft(plan.outgoingDraft);
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
    // Every invocation appends a fresh Untitled tab (Zed-style): untitled
    // buffers are independent per-tab drafts, and Rust models each one as its
    // own internal untitled document.
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
    const defaultPath = defaultOpenDocumentDialogPath(snapshot);
    const selected = await openDialog({
      multiple: true,
      directory: false,
      ...(defaultPath ? { defaultPath } : {}),
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
    const defaultPath = defaultOpenWorkspaceDialogPath(snapshot);
    const selected = await openDialog({
      multiple: false,
      directory: true,
      ...(defaultPath ? { defaultPath } : {}),
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
    const closedTab = snapshotClosedDocumentTab(activeTabId, currentDraft);
    const closePromptState = resolveActiveClosePromptState({
      tabs,
      activeTabId,
      activeDraft: currentDraft,
    });
    if (!closePromptState.requiresPrompt) {
      rememberClosedTab(closedTab);
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
            rememberClosedTab(closedTab);
            clearActiveDocumentSurface();
          }
        });
        return;
      }

      if (closeDecisionAction.kind === 'discard') {
        rememberClosedTab(closedTab);
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

  const autoSaveEligibility = resolveAutoSaveEligibility({
    autoSave: settings.autoSave,
    busy,
    activeDocumentOpen,
    activeDocumentPath: snapshot.activeDocumentPath,
    hasUnsavedChanges,
  });

  const triggerAutoSave = useEffectEvent(() => {
    if (!autoSaveEligibility.shouldRun) return;
    void handleSave();
  });

  useEffect(() => {
    if (!autoSaveEligibility.shouldSchedule) return;

    const timer = window.setTimeout(() => {
      triggerAutoSave();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    settings.autoSave,
    activeDocumentOpen,
    snapshot.activeDocumentPath,
    hasUnsavedChanges,
    autoSaveEligibility.shouldSchedule,
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
    // Resolve the cursor's markdown offset in the mode we're *leaving*.
    //
    // For WYSIWYG we consult three sources in order of trust:
    //   1. The cached (line, column) the selection-update handler captured
    //      on every Tiptap selection change. This is the only path that
    //      uses ProseMirror's `state.selection.head` at the moment the
    //      caret last moved, so it can't be perturbed by intermediate
    //      transactions (flushWysiwygDraftNow's blur, the localDraft sync
    //      effect, applyModeOptimistically) between keydown and effect.
    //   2. The cached markdown character offset (same provenance, parallel
    //      data path).
    //   3. A live recomputation via the markdown serialiser as a last
    //      resort — useful right after mount, before any selection event
    //      has populated the refs.
    //
    // The line+column path has a known one-character drift only at the
    // very end of the document when WYSIWYG's TrailingNode appends an
    // empty paragraph that doesn't exist on disk, and we clamp into the
    // source below; mapping mid-document positions is exact. We use it
    // first because the "cursor jumps to offset 0" failures we've seen
    // in production all trace back to the markdown serialiser returning
    // an empty string for some slices, which collapses paths (2)/(3) but
    // leaves (1) intact.
    let markdownOffset: number;
    if (previousMode === 'Wysiwyg') {
      const savedLoc = wysiwygCursorLocationRef.current;
      if (
        savedLoc &&
        Number.isFinite(savedLoc.line) &&
        savedLoc.line >= 1 &&
        Number.isFinite(savedLoc.column) &&
        savedLoc.column >= 1 &&
        (savedLoc.line > 1 || savedLoc.column > 1)
      ) {
        const lineStart = getSourceOffsetForLine(savedLoc.line);
        markdownOffset = lineStart + Math.max(0, savedLoc.column - 1);
      } else {
        const cached = wysiwygCursorOffsetRef.current;
        if (Number.isFinite(cached) && cached > 0) {
          markdownOffset = cached;
        } else {
          const live = wysiwygCursorMarkdownOffset(editorInstance);
          markdownOffset = Number.isFinite(live) && live > 0 ? live : 0;
        }
      }
    } else {
      markdownOffset = sourceMarkdownOffsetFromCurrentSelection();
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

  // CodeMirror caches its viewport geometry and only re-measures when its
  // ResizeObserver fires. The source pane stays mounted but is hidden with
  // `display:none` in Wysiwyg mode, and WKWebView does NOT fire that observer
  // on a `display:none → block` transition — so returning to Editor/SplitView
  // (or launching straight into Wysiwyg, then switching) can leave CodeMirror
  // painting a stale, collapsed height until a keystroke or scroll forces a
  // measure. That's the intermittent "editor height looks broken" glitch.
  // Force a re-measure once the source pane is visible again; the rAF lets the
  // freshly-shown flex layout settle first (same reason the cursor-handoff
  // effect above defers). Editor↔SplitView is covered too — the source pane's
  // width flips there, so its line wrapping needs a re-measure as well.
  // The Settings tab hides the WHOLE editor column with `display:none` (the
  // same WKWebView observer gap), so its close must also re-measure — while
  // it is open, measuring would read zero rects and poison the height map.
  useEffect(() => {
    if (!activeDocumentOpen) return;
    if (isSettingsTabActive) return;
    if (currentMode !== 'Editor' && currentMode !== 'SplitView') return;
    const view = sourceEditorViewRef.current;
    if (!view) return;
    const frame = window.requestAnimationFrame(() => {
      view.requestMeasure();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentMode, activeDocumentOpen, sourceEditorViewToken, isSettingsTabActive]);

  const handleSetMode = useEffectEvent(async (nextMode: EditorMode) => {
    // Always read snapshot/localDraft from the latest state via useEffectEvent
    // so concurrent menu, palette, and keyboard chord paths agree on the truth.
    if (snapshot.mode === nextMode) {
      return;
    }

    // Snapshot the outgoing caret position BEFORE we kick off any state work
    // (the optimistic mode flip and the awaited setMode round-trip can both
    // race with intermediate selection updates). Reading it here, while
    // ProseMirror's state.selection.head is still pointed at whatever the
    // user last clicked / arrowed onto, gives the handoff effect a reliable
    // value to consume — independent of whether onSelectionUpdate happened
    // to fire between the user's caret move and the mode-switch keypress.
    if (snapshot.mode === 'Wysiwyg' && nextMode !== 'Wysiwyg') {
      const ed = editorInstanceRef.current;
      if (ed) {
        const liveLocation = wysiwygCursorSourceLocation(ed);
        if (
          liveLocation &&
          Number.isFinite(liveLocation.line) &&
          liveLocation.line >= 1
        ) {
          wysiwygCursorLocationRef.current = liveLocation;
        }
        const liveOffset = wysiwygCursorMarkdownOffset(ed);
        if (Number.isFinite(liveOffset) && liveOffset > 0) {
          wysiwygCursorOffsetRef.current = liveOffset;
        }
      }
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
          // area swaps to the settings content.
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
    const closedTab = snapshotClosedDocumentTab(targetId);
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
        rememberClosedTab(closedTab);
        if (transition.clearPreSettingsDocTabId) {
          preSettingsDocTabIdRef.current = null;
        }
        setTabs(transition.tabs);
        setActiveTabId(transition.activeTabId);
        return;
      case 'switchThenRemove':
        // Pick a neighbor to activate first, then drop the closed tab.
        await switchToTab(transition.switchToTabId);
        rememberClosedTab(closedTab);
        setTabs((prev) => prev.filter((tab) => tab.id !== transition.targetId));
    }
  });

  const handleReopenClosedTab = useEffectEvent(async () => {
    const { closedTab, remainingClosedTabs } = popClosedDocumentTab(
      closedDocumentTabsRef.current,
    );
    if (!closedTab) {
      return;
    }

    // Only dedupe by path for saved files. A closed untitled tab must come
    // back as its own tab — a null-path lookup would steal whichever untitled
    // tab happens to be open instead of restoring the closed draft.
    const existingTab = closedTab.path
      ? findDocumentTabByPath(tabsRef.current, closedTab.path)
      : undefined;
    if (existingTab) {
      setClosedDocumentTabStack(remainingClosedTabs);
      await switchToTab(existingTab.id);
      focusActiveEditor();
      return;
    }

    const token = nextEditorOpRequest();
    await withBusy(async () => {
      stashActiveTabDraft();
      await syncActiveDraftBestEffort(undefined, editorOpAbortOptions(token));
      if (isEditorOpStale(token)) return;

      let restoredTab: DocumentTab;
      if (closedTab.path) {
        try {
          const next = await openDocument(closedTab.path);
          if (isEditorOpStale(token)) return;
          applySnapshot(next, true);
          restoredTab = createDocumentTab({
            id: closedTab.id,
            path: next.activeDocumentPath ?? closedTab.path,
            name: next.activeDocumentName ?? closedTab.name,
            source: next.activeDocumentSource ?? closedTab.source,
            draft: closedTab.draft,
          });
        } catch {
          if (isEditorOpStale(token)) return;
          restoredTab = createMissingDocumentTab({
            id: closedTab.id,
            path: closedTab.path,
            name: closedTab.name,
          });
        }
      } else {
        const next = await newDocument();
        if (isEditorOpStale(token)) return;
        applySnapshot(next, true);
        restoredTab = createDocumentTab({
          id: closedTab.id,
          path: next.activeDocumentPath,
          name: next.activeDocumentName ?? closedTab.name,
          source: next.activeDocumentSource ?? closedTab.source,
          draft: closedTab.draft,
        });
      }

      const nextTabs = [...tabsRef.current, restoredTab];
      tabsRef.current = nextTabs;
      activeTabIdRef.current = restoredTab.id;
      closedDocumentTabsRef.current = remainingClosedTabs;
      startTransition(() => {
        setTabs(nextTabs);
        setActiveTabId(restoredTab.id);
        setClosedDocumentTabs(remainingClosedTabs);
        setLocalDraft(restoredTab.draft);
      });
    });

    if (isEditorOpStale(token)) return;
    focusActiveEditor();
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

      // Option+Z toggles Word Wrap (VS Code convention). preventDefault stops
      // macOS from inserting the `Ω` that Option+Z would otherwise produce.
      if (resolveWordWrapShortcut(event)) {
        event.preventDefault();
        handleSettingsChange({
          ...settings,
          editorLineWrap: !settings.editorLineWrap,
        });
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
          case 'reopenClosedTab':
            void handleReopenClosedTab();
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
          case 'toggleFocusMode':
            handleSettingsChange({
              ...settings,
              focusModeEnabled: !settings.focusModeEnabled,
            });
            return;
          case 'toggleTableViewMode':
            handleSettingsChange({
              ...settings,
              tableViewMode: settings.tableViewMode === 'inline' ? 'normal' : 'inline',
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
  // - 0 tabs (nothing open): hide the whole *application* like ⌘H, via the Rust
  //   `hide_app_or_window` command. This returns focus to the previously active
  //   app on macOS instead of leaving Markdowner frontmost with no window. The
  //   app stays in the dock; the Rust `Reopen` handler re-shows the window when
  //   the user clicks the dock icon. Non-macOS platforms hide the window.
  // - 1+ tabs: close the active tab. The final tab leaves the window open on
  //   the empty document surface after any required dirty confirmation.
  const handleCloseTabOrWindow = useEffectEvent(async () => {
    if (tabs.length === 0) {
      await invoke('hide_app_or_window');
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
                // Dropping a file is an explicit open — focus the editor like
                // File>Open does. focusActiveEditor is a useEffectEvent, so
                // this mount-time listener still reads the current mode.
                focusActiveEditor();
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

  const shellChromeModel = buildShellChromeModel({
    tabs,
    activeTabId,
    dirtyTabIds: tabViewState.dirtyTabIds,
    currentMode,
    themeKind: snapshot.theme.kind,
    busy,
    activeDocumentOpen,
    activeDocumentDirty: snapshot.activeDocumentDirty,
    activeDocumentName: snapshot.activeDocumentName,
    activeDocumentPath: snapshot.activeDocumentPath,
    rootDir: snapshot.rootDir,
    cursorPosition,
    documentStats,
  });
  const { documentMeta, openEditorItems, tabStripItems, statusBarModel } = shellChromeModel;
  const sidebarLayout = resolveSidebarLayoutState({
    isOpen: isSidebarOpen,
    width: sidebarWidth,
    isResizing: isResizingSidebar,
  });
  const quickOpenSignature = buildQuickOpenSignature(snapshot);
  // The signature covers the exact snapshot fields Quick Open needs; other
  // active-document snapshot changes should not rebuild large file lists.
  const quickOpenView = useMemo(
    () => resolveQuickOpenViewState(snapshot),
    [quickOpenSignature],
  );
  const { items: quickOpenItems, workspacePathSet: quickOpenWorkspacePathSet } =
    quickOpenView;

  const handleQuickOpenSelect = (path: string) => {
    if (resolveQuickOpenSelectionKind(path, quickOpenWorkspacePathSet) === 'workspace') {
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
      <TitleBar
        onStartWindowDrag={handleStartWindowDrag}
        menu={
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
        }
      />
      {updateCheck.bannerVisible && updateCheck.info ? (
        <UpdateBanner
          latestVersion={updateCheck.info.latestVersion}
          actionLabel="Download & Install"
          busy={updateCheck.installing}
          onAction={updateCheck.install}
          onDismiss={updateCheck.dismissBanner}
        />
      ) : manualUpdateCheckInfo ? (
        <UpdateBanner
          variant="current"
          latestVersion={manualUpdateCheckInfo.latestVersion}
          onDismiss={() => setManualUpdateCheckInfo(null)}
        />
      ) : null}
      <div
        className={cn(
          'min-h-0 flex-1 grid',
          sidebarLayout.gridShouldAnimate &&
            'transition-[grid-template-columns] duration-300 ease-in-out',
        )}
        style={{ gridTemplateColumns: sidebarLayout.gridTemplateColumns }}
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
          openEditors={openEditorItems}
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
          renderWorkspaceTreeNodes={() => (
            <WorkspaceTree
              nodes={filteredWorkspaceTree}
              activePath={snapshot.activeDocumentPath}
              collapsedKeys={collapsedFolderKeys}
              filtering={filteringWorkspace}
              onToggleFolder={handleToggleWorkspaceFolder}
              onOpenFile={(path) => void handleOpenWorkspaceDocument(path)}
            />
          )}
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
        <SidebarResizeHandle
          width={sidebarWidth}
          layout={sidebarLayout}
          onPointerDown={handleSidebarResizeStart}
          onResetWidth={handleSidebarResetWidth}
          onKeyDown={handleSidebarResizeKeyDown}
        />

      <div className="flex min-h-0 min-w-0 flex-col">
        <Tabs
          items={tabStripItems}
          activeTabId={activeTabId}
          onSelectTab={(id) => void switchToTab(id)}
          onCloseTab={(id) => void handleCloseTab(id)}
        />
      {isSettingsTabActive ? (
        <SettingsTabContent
          settings={settings}
          onSettingsChange={handleSettingsChange}
          themeKind={snapshot.theme.kind}
          onSetTheme={(theme) => void handleSetTheme(theme)}
          onFollowSystemTheme={() => void handleFollowSystemTheme()}
          updateInfo={updateCheck.info}
          updateActionLabel="Download & Install"
          updateBusy={updateCheck.installing}
          updateChecking={updateCheck.checking}
          onUpdateAction={updateCheck.install}
          onCheckForUpdate={updateCheck.checkNow}
          defaultMdHandler={defaultMdHandler}
          defaultMdHandlerBusy={defaultAppPromptBusy}
          onDefaultMdHandlerChange={setDefaultMdHandlerStatus}
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
        wrapColumn={settings.editorWrapColumn}
        showWrapLine={settings.editorShowWrapLine}
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
        tableViewMode={settings.tableViewMode}
        editorContent={
          <WysiwygEditorChrome
            editor={editor}
            enabled={currentMode === 'Wysiwyg'}
            activeDocumentPath={snapshot.activeDocumentPath}
          />
        }
        sourceEditor={
          <SourceEditorPane
            value={localDraft}
            extensions={sourceEditorExtensions}
            themeKind={snapshot.theme.kind}
            onChange={handleSourceEditorChange}
            onStatistics={handleSourceEditorStatistics}
            onCreateEditor={handleSourceEditorCreate}
            containerRef={sourceEditorContainerRef}
          />
        }
        splitViewPreview={
          <MarkdownPreviewPane
            source={previewSource}
            activeDocumentPath={snapshot.activeDocumentPath}
          />
        }
      />
      </div>
      </div>
      </div>
      <AppOverlays
        quickOpenOpen={isQuickOpenOpen}
        onQuickOpenOpenChange={setIsQuickOpenOpen}
        quickOpenItems={quickOpenItems}
        onQuickOpenSelect={handleQuickOpenSelect}
        commandPaletteOpen={isCommandPaletteOpen}
        onCommandPaletteOpenChange={setIsCommandPaletteOpen}
        commandPaletteCommands={paletteCommands}
        documentStatsOpen={isDocumentStatsOpen}
        onDocumentStatsOpenChange={setIsDocumentStatsOpen}
        documentName={snapshot.activeDocumentName}
        documentPath={snapshot.activeDocumentPath}
        stats={documentStats}
        shortcutsOpen={isShortcutsOpen}
        onShortcutsOpenChange={setIsShortcutsOpen}
        defaultAppPromptOpen={defaultAppPromptOpen}
        defaultAppPromptBusy={defaultAppPromptBusy}
        onDefaultAppPromptOpenChange={handleDefaultAppPromptOpenChange}
        onMakeDefaultApp={() => void handleMakeDefaultApp()}
        onSkipDefaultAppPrompt={handleSkipDefaultAppPrompt}
      />

      <StatusBar
        {...statusBarModel}
        updateAvailable={updateCheck.info?.available ?? false}
        onUpdateClick={() => {
          if (!isSettingsTabActive) {
            void toggleSettingsTab();
          }
        }}
      />
      <ImeDebugOverlay />
    </div>
  );
}
