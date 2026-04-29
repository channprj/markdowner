import { markdown } from '@codemirror/lang-markdown';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
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
import { startTransition, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  type AppSnapshot,
  type EditorMode,
  type ThemeKind,
  bootstrap,
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
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<string[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState('');

  const currentMode = snapshot.mode;
  const activeDocumentOpen = snapshot.activeDocumentSource !== null;
  const errorMessage = snapshot.lastError;
  const activeDocumentName = snapshot.activeDocumentName ?? 'No document open';
  const workspaceTree = buildWorkspaceTree(snapshot.workspaceDocuments, snapshot.rootDir);
  const filteredWorkspaceTree = filterWorkspaceTree(workspaceTree, workspaceFilter);
  const filteringWorkspace = workspaceFilter.trim().length > 0;
  const workspaceTreeSignature = `${snapshot.rootDir ?? ''}\u0000${snapshot.workspaceDocuments.join('\u0000')}`;

  const applySnapshot = (next: AppSnapshot, preserveDraft = false) => {
    startTransition(() => {
      setSnapshot(next);
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
      const next = await saveActiveDocument();
      applySnapshot(next, true);
    });
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

  return (
    <div className="desktop-shell">
      <aside className="left-rail">
        <div className="brand-block">
          <div className="eyebrow">Markdowner</div>
          <h1>Desktop editor foundation</h1>
          <p>
            Tauri shell, Rust core bridge, and three editing surfaces are now wired
            through one desktop app skeleton.
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

        <section className="editor-frame">
          {!activeDocumentOpen ? (
            <div className="empty-state">
              <h2>Launch the first desktop editing flow</h2>
              <p>
                Open a Markdown file or workspace to exercise the new Tauri shell with the
                Rust core bridge.
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
