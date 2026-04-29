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
  openDocument,
  openWorkspace,
  openWorkspaceDocument,
  replaceActiveDocumentSource,
  saveActiveDocument,
  saveActiveDocumentAs,
  setMode,
  setTheme,
} from './lib/desktop';

const EMPTY_SNAPSHOT: AppSnapshot = {
  rootDir: null,
  workspaceDocuments: [],
  recentDocuments: [],
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
  style.textContent = snapshot.theme.stylesheet;
  if (!existing) {
    document.head.appendChild(style);
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [localDraft, setLocalDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const currentMode = snapshot.mode;
  const activeDocumentOpen = Boolean(snapshot.activeDocumentPath);
  const errorMessage = snapshot.lastError;

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
    if (!snapshot.activeDocumentPath) {
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
        class: 'editor-surface tiptap-surface',
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

  const previewSource = localDraft || '*Open a Markdown document to preview it.*';

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
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
      const next = await openWorkspace(selected);
      applySnapshot(next);
    });
  };

  const handleSave = async () => {
    if (!snapshot.activeDocumentPath) {
      return;
    }

    await withBusy(async () => {
      const synced = await replaceActiveDocumentSource(localDraft);
      applySnapshot(synced, true);
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
    if (!snapshot.activeDocumentPath) {
      return;
    }

    const selected = await saveDialog({
      defaultPath: snapshot.activeDocumentPath,
      filters: [{ name: 'Markdown', extensions: MARKDOWN_FILE_EXTENSIONS }],
    });

    if (typeof selected !== 'string') {
      return;
    }

    await withBusy(async () => {
      const synced = await replaceActiveDocumentSource(localDraft);
      applySnapshot(synced, true);
      const next = await saveActiveDocumentAs(selected);
      applySnapshot(next, true);
    });
  };

  const handleSetMode = async (nextMode: EditorMode) => {
    await withBusy(async () => {
      if (snapshot.activeDocumentPath) {
        const synced = await replaceActiveDocumentSource(localDraft);
        applySnapshot(synced, true);
      }

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
      if (snapshot.activeDocumentPath) {
        const synced = await replaceActiveDocumentSource(localDraft);
        applySnapshot(synced, true);
      }

      const next = await openWorkspaceDocument(path);
      applySnapshot(next);
    });
  };

  const handleOpenRecentDocument = async (path: string) => {
    await withBusy(async () => {
      if (snapshot.activeDocumentPath) {
        const synced = await replaceActiveDocumentSource(localDraft);
        applySnapshot(synced, true);
      }

      const next = await openDocument(path);
      applySnapshot(next);
    });
  };

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
          <button className="secondary-button" onClick={handleOpenWorkspace} disabled={busy}>
            Open Folder…
          </button>
          <button className="secondary-button" onClick={handleOpenDocument} disabled={busy}>
            Open Markdown…
          </button>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-header">Files</div>
          {snapshot.workspaceDocuments.length === 0 ? (
            <div className="empty-hint">Open a folder to populate the file tree.</div>
          ) : (
            <div className="tree-list">
              {snapshot.workspaceDocuments.map((path) => (
                <button
                  key={path}
                  className={
                    path === snapshot.activeDocumentPath
                      ? 'tree-item tree-item-active'
                      : 'tree-item'
                  }
                  onClick={() => handleOpenWorkspaceDocument(path)}
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
            <div className="document-title">
              {snapshot.activeDocumentPath
                ? displayFileName(snapshot.activeDocumentPath)
                : 'No document open'}
            </div>
            <div className="document-meta">
              {snapshot.rootDir ?? 'Open a workspace or a Markdown file to begin.'}
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
            <div className="editor-scroll preview-shell">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewSource}</ReactMarkdown>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
