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
import CodeMirror from '@uiw/react-codemirror';
import { startTransition, useEffect, useEffectEvent, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
} from './lib/desktop';
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

function usesCommandModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
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
      .then((next) => {
        if (!cancelled) {
          applySnapshot(next);
        }
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
    ? localDraft
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

  const handleSetMode = async (nextMode: EditorMode) => {
    await withBusy(async () => {
      await syncActiveDraft();
      const next = await setMode(nextMode);
      applySnapshot(next, true);
    });
  };

  const handleSetTheme = async (themeKind: ThemeKind) => {
    await withBusy(async () => {
      const next = await setTheme(themeKind);
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
      case 'mode-source':
        await handleSetMode('Source');
        return;
      case 'mode-preview':
        await handleSetMode('Preview');
      default:
    }
  });

  const renderWorkspaceTreeNode = (node: WorkspaceTreeNode, depth = 0) => {
    if (node.kind === 'folder') {
      const collapsed = !filteringWorkspace && collapsedFolderKeys.includes(node.key);

      return (
        <div key={node.key} className="tree-folder">
          <button
            type="button"
            className="tree-folder-toggle"
            aria-expanded={!collapsed}
            onClick={() => handleToggleWorkspaceFolder(node.key)}
            style={{ paddingLeft: `${depth * 18}px` }}
          >
            <span className="tree-folder-caret" aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
            <span>{node.name}</span>
          </button>
          {!collapsed ? (
            <div className="tree-folder-children">
              {node.children.map((child) => renderWorkspaceTreeNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <button
        key={node.key}
        className={
          node.path === snapshot.activeDocumentPath ? 'tree-item tree-item-active' : 'tree-item'
        }
        onClick={() => handleOpenWorkspaceDocument(node.path)}
        style={{ paddingLeft: `${14 + depth * 18}px` }}
      >
        <span className="tree-name">{node.name}</span>
        <span className="tree-path">{node.relativePath}</span>
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
        void handleSetMode('Wysiwyg');
        return;
      }

      if (matchesShortcut(event, '2')) {
        event.preventDefault();
        void handleSetMode('Source');
        return;
      }

      if (matchesShortcut(event, '3')) {
        event.preventDefault();
        void handleSetMode('Preview');
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

  return (
    <div className="desktop-shell">
      <aside className="left-rail">
        <div className="brand-block">
          <div className="eyebrow">Markdowner</div>
          <h1>Write Markdown with confidence</h1>
          <p>
            Work locally, keep your files intact, and switch between WYSIWYG, Source,
            and Preview without losing your place.
          </p>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-header">Workspace</div>
          <button className="primary-button" onClick={handleNewDocument} disabled={busy}>
            New Document
          </button>
          <button className="secondary-button" onClick={handleOpenWorkspace} disabled={busy}>
            Open Folder…
          </button>
          <button className="secondary-button" onClick={handleOpenDocument} disabled={busy}>
            Open Markdown…
          </button>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-header">Files</div>
          {workspaceTree.length === 0 ? (
            <div className="empty-hint">Open a folder to populate the file tree.</div>
          ) : (
            <>
              <label className="sidebar-field">
                <span className="sidebar-field-label">Filter files</span>
                <input
                  type="text"
                  className="sidebar-input"
                  value={workspaceFilter}
                  onChange={(event) => setWorkspaceFilter(event.target.value)}
                  placeholder="Search this workspace"
                  disabled={busy}
                  aria-label="Filter files"
                />
              </label>
              {filteredWorkspaceTree.length === 0 ? (
                <div className="empty-hint">No files match this filter.</div>
              ) : (
                <div className="tree-list">
                  {filteredWorkspaceTree.map((node) => renderWorkspaceTreeNode(node))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-header">Recent</div>
          {snapshot.recentDocuments.length === 0 ? (
            <div className="empty-hint">Recent documents will appear here.</div>
          ) : (
            <div className="recent-list">
              {snapshot.recentDocuments.slice(0, 5).map((path) => (
                <button
                  key={path}
                  className={
                    path === snapshot.activeDocumentPath
                      ? 'tree-item tree-item-active recent-item-button'
                      : 'tree-item recent-item-button'
                  }
                  onClick={() => handleOpenRecentDocument(path)}
                  disabled={busy}
                  title={path}
                >
                  <span className="tree-name">{displayFileName(path)}</span>
                  <span className="tree-path">
                    {displayWorkspacePath(path, snapshot.rootDir)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="workspace-shell">
        <header className="topbar">
          <div className="topbar-actions">
            <button className="primary-button" onClick={handleSave} disabled={!activeDocumentOpen || busy}>
              Save
            </button>
            <button
              className="secondary-button"
              onClick={handleSaveAs}
              disabled={!activeDocumentOpen || busy}
            >
              Save As…
            </button>
            <button className="secondary-button" onClick={handleImportTheme} disabled={busy}>
              Import CSS Theme…
            </button>
          </div>

          <div className="segmented-control">
            {(['Wysiwyg', 'Source', 'Preview'] as EditorMode[]).map((mode) => (
              <button
                key={mode}
                className={mode === currentMode ? 'segment segment-active' : 'segment'}
                onClick={() => handleSetMode(mode)}
                disabled={busy}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="segmented-control">
            {([
              ['BuiltInLight', 'Light'],
              ['BuiltInDark', 'Dark'],
            ] as Array<[ThemeKind, string]>).map(([themeKind, label]) => (
              <button
                key={themeKind}
                className={snapshot.theme.kind === themeKind ? 'segment segment-active' : 'segment'}
                onClick={() => handleSetTheme(themeKind)}
                disabled={busy}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <section className="document-header">
          <div>
            <div className="document-title">{activeDocumentName}</div>
            <div className="document-meta">
              {snapshot.activeDocumentPath
                ? displayWorkspacePath(snapshot.activeDocumentPath, snapshot.rootDir)
                : activeDocumentOpen
                  ? 'Save As to choose where this draft lives.'
                  : 'Open a workspace or a Markdown file to begin.'}
            </div>
          </div>
          <div className="document-status">
            <span className={snapshot.activeDocumentDirty ? 'status-pill dirty' : 'status-pill clean'}>
              {snapshot.activeDocumentDirty ? 'Unsaved' : 'Saved'}
            </span>
            <span className="status-pill neutral">{snapshot.theme.kind}</span>
          </div>
        </section>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
        {externalChangeMessage ? (
          <div className="error-banner">
            <div>{externalChangeMessage}</div>
            {showExternalChangeActions ? (
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void handleReloadActiveDocument()}
                >
                  Reload from disk
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={handleKeepLocalChanges}
                >
                  Keep local
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void handleCompareExternalChanges()}
                >
                  Compare
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {externalCompareSource !== null ? (
          <div className="error-banner" style={{ whiteSpace: 'pre-wrap' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <strong>Disk vs local</strong>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setExternalCompareSource(null)}
              >
                Hide comparison
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <h4>Disk</h4>
                <pre>{externalCompareSource}</pre>
              </div>
              <div>
                <h4>Local</h4>
                <pre>{localDraft}</pre>
              </div>
            </div>
          </div>
        ) : null}

        <section className="editor-frame">
          {!activeDocumentOpen ? (
            <div className="empty-state">
              <h2>Start your next document</h2>
              <p>
                Create a new draft or open a Markdown file to begin editing right away.
              </p>
            </div>
          ) : null}

          {activeDocumentOpen && currentMode === 'Wysiwyg' ? (
            <EditorContent editor={editor} className="editor-scroll" />
          ) : null}

          {activeDocumentOpen && currentMode === 'Source' ? (
            <div className="editor-scroll codemirror-shell">
              <CodeMirror
                value={localDraft}
                height="100%"
                extensions={[markdown()]}
                onChange={(value) => setLocalDraft(value)}
                theme={snapshot.theme.kind === 'BuiltInDark' ? 'dark' : 'light'}
              />
            </div>
          ) : null}

          {activeDocumentOpen && currentMode === 'Preview' ? (
            <div
              className={`editor-scroll preview-shell ${MARKDOWN_CONTENT_SCOPE_CLASS}`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewSource}</ReactMarkdown>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
