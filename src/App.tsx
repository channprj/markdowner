import { markdown } from '@codemirror/lang-markdown';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  message,
  open as openDialog,
  save as saveDialog,
} from '@tauri-apps/plugin-dialog';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
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
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { startTransition, useEffect, useEffectEvent, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { ActivityBar } from '@/shell/ActivityBar';
import { CommandPalette, type CommandPaletteCommand } from '@/shell/CommandPalette';
import { EditorArea } from '@/shell/EditorArea';
import { Header } from '@/shell/Header';
import { QuickOpen, type QuickOpenItem } from '@/shell/QuickOpen';
import { SideBar } from '@/shell/SideBar';
import { StatusBar } from '@/shell/StatusBar';
import { SettingsDialog } from '@/shell/SettingsDialog';

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
} from './lib/desktop';
import {
  DEFAULT_SETTINGS,
  type Settings,
  loadSettings,
  saveSettings,
} from './lib/settings';
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
const MENU_COMMAND_CLOSE_WINDOW = 'close-window';

const THEME_MODE_STORAGE_KEY = 'markdowner.themeMode';
type ThemeMode = 'system' | 'manual';

function readThemeMode(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_MODE_STORAGE_KEY) === 'manual' ? 'manual' : 'system';
  } catch {
    return 'system';
  }
}

function writeThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable; ignore
  }
}

function resolveOsTheme(): ThemeKind {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'BuiltInDark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'BuiltInDark' : 'BuiltInLight';
}

function usesCommandModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

const SIDEBAR_STATE_KEY = 'markdowner.sidebarOpen';
const SIDEBAR_WIDTH_KEY = 'markdowner.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_KEYBOARD_STEP = 8;
const SIDEBAR_KEYBOARD_PAGE_STEP = 32;

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
  { mode: 'Editor', label: 'Editor', shortcutSymbol: '⌘1', shortcutText: 'Cmd+1', ariaKeyshortcuts: 'Meta+1 Control+1' },
  { mode: 'Wysiwyg', label: 'WYSIWYG', shortcutSymbol: '⌘2', shortcutText: 'Cmd+2', ariaKeyshortcuts: 'Meta+2 Control+2' },
  { mode: 'SplitView', label: 'Split View', shortcutSymbol: '⌘3', shortcutText: 'Cmd+3', ariaKeyshortcuts: 'Meta+3 Control+3' },
];

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

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [localDraft, setLocalDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [externalChangeMessage, setExternalChangeMessage] = useState<string | null>(null);
  const [showExternalChangeActions, setShowExternalChangeActions] = useState(false);
  const [externalCompareSource, setExternalCompareSource] = useState<string | null>(null);
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<string[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(readSidebarState());
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [debouncedLocalDraft, setDebouncedLocalDraft] = useState(localDraft);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });

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
    return { words, characters };
  }, [localDraft]);

  const handleToggleSidebar = useEffectEvent(() => {
    setIsSidebarOpen((current) => {
      const next = !current;
      writeSidebarState(next);
      return next;
    });
  });

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
  const activeDocumentOpen = snapshot.activeDocumentSource !== null;
  const hasUnsavedChanges =
    activeDocumentOpen && localDraft !== (snapshot.activeDocumentSource ?? '')
      ? true
      : snapshot.activeDocumentDirty;
  const errorMessage = snapshot.lastError;
  const activeDocumentName = snapshot.activeDocumentName ?? 'No document open';
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

  useEffect(() => {
    let cancelled = false;

    bootstrap()
      .then(async (next) => {
        if (cancelled) {
          return;
        }
        if (readThemeMode() === 'system' && next.theme.kind !== 'CustomCss') {
          const osKind = resolveOsTheme();
          if (next.theme.kind !== osKind) {
            try {
              const synced = await setTheme(osKind);
              if (!cancelled) {
                applySnapshot(synced);
              }
              return;
            } catch (error) {
              console.error(error);
            }
          }
        }
        applySnapshot(next);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((next) => {
        if (cancelled) return;
        startTransition(() => {
          setSettings(next);
        });
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsChange = (next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleOsThemeChange = async () => {
      if (readThemeMode() !== 'system') {
        return;
      }
      try {
        const next = await setTheme(resolveOsTheme());
        applySnapshot(next, true);
      } catch (error) {
        console.error(error);
      }
    };
    mediaQuery.addEventListener('change', handleOsThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleOsThemeChange);
    };
  }, []);

  useEffect(() => {
    applyThemeSelection(snapshot.theme.kind);
    applyImportedStylesheet(snapshot);
  }, [snapshot]);

  useEffect(() => {
    document.title = buildWindowTitle(snapshot);
  }, [snapshot]);

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

    const timeout = window.setTimeout(() => {
      replaceActiveDocumentSource(localDraft)
        .then((next) => applySnapshot(next, true))
        .catch((error) => console.error(error));
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [localDraft, snapshot.activeDocumentPath, snapshot.activeDocumentSource]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
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
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const markdownFromEditor = editor.getMarkdown();
    if (markdownFromEditor !== localDraft) {
      editor.commands.setContent(localDraft || '', { contentType: 'markdown' });
    }
  }, [editor, localDraft]);

  const previewSource = activeDocumentOpen
    ? debouncedLocalDraft
    : '*Open a Markdown document to preview it.*';

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
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

  const syncActiveDraft = async () => {
    if (!activeDocumentOpen) {
      return;
    }

    const synced = await replaceActiveDocumentSource(localDraft);
    applySnapshot(synced, true);
  };

  const handleNewDocument = async () => {
    await withBusy(async () => {
      await syncActiveDraft();
      const next = await newDocument();
      applySnapshot(next);
    });
  };

  const handleOpenDocument = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    await withBusy(async () => {
      await syncActiveDraft();
      const next = await openDocument(selected);
      applySnapshot(next);
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
      await syncActiveDraft();
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

  const handleSetMode = async (nextMode: EditorMode) => {
    await withBusy(async () => {
      await syncActiveDraft();
      const next = await setMode(nextMode);
      applySnapshot(next, true);
    });
  };

  const handleSetTheme = async (themeKind: ThemeKind) => {
    await withBusy(async () => {
      writeThemeMode('manual');
      setThemeMode('manual');
      const next = await setTheme(themeKind);
      applySnapshot(next, true);
    });
  };

  const handleFollowSystemTheme = async () => {
    await withBusy(async () => {
      writeThemeMode('system');
      setThemeMode('system');
      const next = await setTheme(resolveOsTheme());
      applySnapshot(next, true);
    });
  };

  const handleOpenWorkspaceDocument = async (path: string) => {
    await withBusy(async () => {
      await syncActiveDraft();
      const next = await openWorkspaceDocument(path);
      applySnapshot(next);
    });
  };

  const handleOpenRecentDocument = async (path: string) => {
    await withBusy(async () => {
      await syncActiveDraft();
      const next = await openDocument(path);
      applySnapshot(next);
    });
  };

  const handleToggleWorkspaceFolder = (key: string) => {
    setCollapsedFolderKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  };

  const handleNativeMenuCommand = useEffectEvent(async (command: string) => {
    if (busy) {
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
        await handleWindowCloseCommand();
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

      if (matchesShortcut(event, 'n')) {
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
        setIsSettingsOpen((prev) => !prev);
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

      if (matchesShortcut(event, '1')) {
        event.preventDefault();
        void handleSetMode('Editor');
        return;
      }

      if (matchesShortcut(event, '2')) {
        event.preventDefault();
        void handleSetMode('Wysiwyg');
        return;
      }

      if (matchesShortcut(event, '3')) {
        event.preventDefault();
        void handleSetMode('SplitView');
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcut);

    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcut);
    };
  }, [busy, localDraft, snapshot]);

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
        console.error(error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleWindowCloseRequest = useEffectEvent(
    async (event: { preventDefault: () => void }) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();

      if (busy) {
        return;
      }

      try {
        const currentWindow = getCurrentWindow();
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

        if (decision === 'Save') {
          await withBusy(async () => {
            const saved = await saveActiveDocumentForClose();
            if (saved) {
              await currentWindow.destroy();
            }
          });
          return;
        }

        if (decision === "Don't Save") {
          await currentWindow.destroy();
        }
      } catch (error) {
        console.error(error);
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
        console.error(error);
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
              await syncActiveDraft();
              const next = await openDroppedPath(firstPath);
              applySnapshot(next, true);
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
        console.error('Failed to listen to drag-drop event:', error);
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
      run: () => setIsSettingsOpen(true),
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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <Header
        title={activeDocumentName ? `${activeDocumentName}${snapshot.activeDocumentDirty ? ' •' : ''}` : 'Markdowner'}
        titleTooltip={snapshot.activeDocumentPath ?? undefined}
        leftContent={
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', isSidebarOpen && 'bg-accent text-accent-foreground')}
              onClick={handleToggleSidebar}
              title="Toggle Sidebar (Cmd+B)"
              aria-label="Toggle Sidebar"
              aria-pressed={isSidebarOpen}
              aria-keyshortcuts="Meta+B Control+B"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-panel-left"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={handleSave}
              disabled={!activeDocumentOpen || busy}
              title="Save (Cmd+S)"
              aria-keyshortcuts="Meta+S Control+S"
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={handleSaveAs}
              disabled={!activeDocumentOpen || busy}
              title="Save As (Cmd+Shift+S)"
              aria-keyshortcuts="Meta+Shift+S Control+Shift+S"
            >
              Save As…
            </Button>
          </>
        }
        rightContent={
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={handleImportTheme}
              disabled={busy}
              title="Import a custom CSS theme"
            >
              Import CSS…
            </Button>
            <ToggleGroup
              type="single"
              value={currentMode}
              onValueChange={(value) => {
                if (value) {
                  void handleSetMode(value as EditorMode);
                }
              }}
              variant="outline"
              size="sm"
              className="h-8"
            >
              {EDITOR_MODE_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.mode}
                  value={option.mode}
                  disabled={busy}
                  aria-label={option.label}
                  title={`${option.label} (${option.shortcutText})`}
                  aria-keyshortcuts={option.ariaKeyshortcuts}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              value={
                themeMode === 'system'
                  ? 'system'
                  : snapshot.theme.kind === 'CustomCss'
                  ? ''
                  : snapshot.theme.kind
              }
              onValueChange={(value) => {
                if (!value) return;
                if (value === 'system') {
                  void handleFollowSystemTheme();
                } else {
                  void handleSetTheme(value as ThemeKind);
                }
              }}
              variant="outline"
              size="sm"
              className="h-8"
            >
              <ToggleGroupItem
                value="BuiltInLight"
                disabled={busy}
                aria-label="Light theme"
                title="Light theme"
              >
                Light
              </ToggleGroupItem>
              <ToggleGroupItem
                value="BuiltInDark"
                disabled={busy}
                aria-label="Dark theme"
                title="Dark theme"
              >
                Dark
              </ToggleGroupItem>
              <ToggleGroupItem
                value="system"
                disabled={busy}
                aria-label="Follow system theme"
                title="Follow system theme"
              >
                System
              </ToggleGroupItem>
            </ToggleGroup>
          </>
        }
      />
      <div
        className={cn(
          'flex-1 grid',
          !isResizingSidebar && 'transition-[grid-template-columns] duration-300 ease-in-out',
        )}
        style={{
          gridTemplateColumns: isSidebarOpen
            ? `48px ${sidebarWidth}px 4px minmax(0, 1fr)`
            : '48px 0px 0px minmax(0, 1fr)',
        }}
      >
        <ActivityBar
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenQuickOpen={() => setIsQuickOpenOpen(true)}
          onToggleSidebar={handleToggleSidebar}
          isSidebarOpen={isSidebarOpen}
          isSettingsOpen={isSettingsOpen}
          isQuickOpenOpen={isQuickOpenOpen}
        />
        <SideBar
          isOpen={isSidebarOpen}
          busy={busy}
          workspaceFilter={workspaceFilter}
          onWorkspaceFilterChange={setWorkspaceFilter}
          workspaceTreeLength={workspaceTree.length}
          filteredWorkspaceTreeLength={filteredWorkspaceTree.length}
          recentDocuments={snapshot.recentDocuments}
          activeDocumentPath={snapshot.activeDocumentPath}
          rootDir={snapshot.rootDir}
          onNewDocument={handleNewDocument}
          onOpenWorkspace={handleOpenWorkspace}
          onOpenDocument={handleOpenDocument}
          onOpenRecentDocument={handleOpenRecentDocument}
          renderWorkspaceTreeNodes={() => filteredWorkspaceTree.map((node) => renderWorkspaceTreeNode(node))}
          displayFileName={displayFileName}
          displayWorkspacePath={displayWorkspacePath}
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
        fontSize={settings.editorFontSize || DEFAULT_SETTINGS.editorFontSize}
        fontFamily={settings.editorFontFamily}
        editorContent={<EditorContent editor={editor} />}
        sourceEditor={
          <CodeMirror
            value={localDraft}
            height="100%"
            extensions={settings.editorLineWrap ? [markdown(), EditorView.lineWrapping] : [markdown()]}
            onChange={(value) => setLocalDraft(value)}
            onStatistics={(stats) => {
              const head = stats.selectionAsSingle.head;
              setCursorPosition({
                line: stats.line.number,
                column: head - stats.line.from + 1,
              });
            }}
            theme={snapshot.theme.kind === 'BuiltInDark' ? 'dark' : 'light'}
          />
        }
        splitViewPreview={
          <div
            className={cn(
              'markdown-surface flex-1 px-8 py-6',
              MARKDOWN_CONTENT_SCOPE_CLASS,
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewSource}</ReactMarkdown>
          </div>
        }
      />
      </div>
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
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

      <StatusBar
        mode={formatEditorMode(currentMode)}
        theme={formatThemeLabel(snapshot.theme.kind)}
        isDirty={activeDocumentOpen ? snapshot.activeDocumentDirty : null}
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
      />
    </div>
  );
}
