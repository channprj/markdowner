import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSnapshot } from './lib/desktop';

const bootstrapMock = vi.fn();
const activeDocumentDiskSourceMock = vi.fn();
const importThemeMock = vi.fn();
const hasActiveDocumentExternalChangesMock = vi.fn();
const newDocumentMock = vi.fn();
const openDocumentMock = vi.fn();
const openWorkspaceMock = vi.fn();
const openWorkspaceDocumentMock = vi.fn();
const replaceActiveDocumentSourceMock = vi.fn();
const saveActiveDocumentMock = vi.fn();
const saveActiveDocumentAsMock = vi.fn();
const setModeMock = vi.fn();
const setThemeMock = vi.fn();
const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();
const messageMock = vi.fn();
const destroyWindowMock = vi.fn();
const onCloseRequestedMock = vi.fn();
const listenMock = vi.fn();
let closeRequestedHandler:
  | ((event: { preventDefault: () => void }) => Promise<void>)
  | undefined;
let menuCommandHandler:
  | ((event: { payload: string }) => void | Promise<void>)
  | undefined;

vi.mock('./lib/desktop', () => ({
  bootstrap: bootstrapMock,
  activeDocumentDiskSource: activeDocumentDiskSourceMock,
  importTheme: importThemeMock,
  hasActiveDocumentExternalChanges: hasActiveDocumentExternalChangesMock,
  newDocument: newDocumentMock,
  openDocument: openDocumentMock,
  openWorkspace: openWorkspaceMock,
  openWorkspaceDocument: openWorkspaceDocumentMock,
  replaceActiveDocumentSource: replaceActiveDocumentSourceMock,
  saveActiveDocument: saveActiveDocumentMock,
  saveActiveDocumentAs: saveActiveDocumentAsMock,
  setMode: setModeMock,
  setTheme: setThemeMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openDialogMock,
  save: saveDialogMock,
  message: messageMock,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: destroyWindowMock,
    onCloseRequested: onCloseRequestedMock,
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tiptap/react', () => ({
  EditorContent: () => null,
  useEditor: () => null,
}));

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Source editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const baseSnapshot = (overrides: Partial<AppSnapshot> = {}): AppSnapshot => ({
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
  ...overrides,
});

describe('App recent documents', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    bootstrapMock.mockReset();
    activeDocumentDiskSourceMock.mockReset();
    importThemeMock.mockReset();
    newDocumentMock.mockReset();
    openDocumentMock.mockReset();
    openWorkspaceMock.mockReset();
    openWorkspaceDocumentMock.mockReset();
    replaceActiveDocumentSourceMock.mockReset();
    saveActiveDocumentMock.mockReset();
    saveActiveDocumentAsMock.mockReset();
    setModeMock.mockReset();
    setThemeMock.mockReset();
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    messageMock.mockReset();
    destroyWindowMock.mockReset();
    onCloseRequestedMock.mockReset();
    listenMock.mockReset();
    hasActiveDocumentExternalChangesMock.mockReset();
    closeRequestedHandler = undefined;
    menuCommandHandler = undefined;
    onCloseRequestedMock.mockImplementation(async (handler) => {
      closeRequestedHandler = handler;
      return vi.fn();
    });
    hasActiveDocumentExternalChangesMock.mockResolvedValue(false);
    activeDocumentDiskSourceMock.mockReset();
    activeDocumentDiskSourceMock.mockRejectedValue(new Error('No active document'));
    listenMock.mockImplementation(async (eventName, handler) => {
      if (eventName === 'markdowner://menu-command') {
        menuCommandHandler = handler;
      }

      return vi.fn();
    });

    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );

    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) =>
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: source,
        activeDocumentDirty: true,
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );
  });

  it('reopens a recent document from the sidebar', async () => {
    const { default: App } = await import('./App');

    render(<App />);

    const recentButton = await screen.findByRole('button', {
      name: /meeting-notes\.md/i,
    });

    fireEvent.click(recentButton);

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/meeting-notes.md');
    });
  });

  it('renders workspace documents in a nested folder tree', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'draft.md',
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
        activeDocumentPath: '/tmp/project/guides/draft.md',
        activeDocumentSource: '# Draft',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    expect(await screen.findByText('guides')).toBeInTheDocument();
    expect(screen.getByText('reference')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft\.md/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api\.md/i })).toBeInTheDocument();
  });

  it('collapses and re-expands workspace folders from the sidebar', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'draft.md',
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
        activeDocumentPath: '/tmp/project/guides/draft.md',
        activeDocumentSource: '# Draft',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const guidesFolderButton = await screen.findByRole('button', { name: 'guides' });
    expect(guidesFolderButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /draft\.md/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api\.md/i })).toBeInTheDocument();

    fireEvent.click(guidesFolderButton);

    await waitFor(() => {
      expect(guidesFolderButton).toHaveAttribute('aria-expanded', 'false');
    });
    expect(screen.queryByRole('button', { name: /draft\.md/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /api\.md/i })).not.toBeInTheDocument();

    fireEvent.click(guidesFolderButton);

    await waitFor(() => {
      expect(guidesFolderButton).toHaveAttribute('aria-expanded', 'true');
    });
    expect(screen.getByRole('button', { name: /draft\.md/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api\.md/i })).toBeInTheDocument();
  });

  it('filters workspace files while keeping matching folder ancestry visible', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'draft.md',
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
        activeDocumentPath: '/tmp/project/guides/draft.md',
        activeDocumentSource: '# Draft',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const guidesFolderButton = await screen.findByRole('button', { name: 'guides' });
    fireEvent.click(guidesFolderButton);

    await waitFor(() => {
      expect(guidesFolderButton).toHaveAttribute('aria-expanded', 'false');
    });

    const filterInput = screen.getByRole('textbox', { name: /filter files/i });
    fireEvent.change(filterInput, { target: { value: 'api' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'guides' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'reference' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /api\.md/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /draft\.md/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /readme\.md/i })).not.toBeInTheDocument();
  });

  it('renders Windows-style paths with file basenames and workspace-relative labels', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'draft.md',
        rootDir: 'C:\\Users\\chann\\workspace',
        workspaceDocuments: ['C:\\Users\\chann\\workspace\\guides\\draft.md'],
        recentDocuments: ['C:\\Users\\chann\\workspace\\guides\\draft.md'],
        activeDocumentPath: 'C:\\Users\\chann\\workspace\\guides\\draft.md',
        activeDocumentSource: '# Draft',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    expect(await screen.findAllByText('draft.md')).toHaveLength(3);
    expect(screen.getAllByText('guides/draft.md')).toHaveLength(3);
  });

  it('shows the cursor Ln/Col in the status bar for source-pane modes only', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    expect(await screen.findByText(/^Ln 1, Col 1$/)).toBeInTheDocument();

    setModeMock.mockResolvedValueOnce(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Wysiwyg',
      }),
    );

    fireEvent.keyDown(window, { key: '2', metaKey: true });

    await waitFor(() => {
      expect(screen.queryByText(/^Ln \d+, Col \d+$/)).not.toBeInTheDocument();
    });
  });

  it('reflects the active document dirty state in the window title', async () => {
    document.title = 'Markdowner';
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/^meeting-notes\.md/);

    expect(document.title).toBe('● meeting-notes.md — Markdowner');
  });

  it('scopes imported custom CSS to markdown content surfaces', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'theme-preview.md',
        activeDocumentPath: '/tmp/project/theme-preview.md',
        activeDocumentSource: '# Scoped preview',
        mode: 'SplitView',
        theme: {
          kind: 'CustomCss',
          stylesheet: 'body, h1 { color: tomato; }',
          stylesheetPath: '/tmp/project/theme.css',
        },
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const previewHeading = await screen.findByText('Scoped preview');
    expect(previewHeading.closest('.markdowner-content')).not.toBeNull();

    const importedTheme = document.getElementById('markdowner-imported-theme');
    expect(importedTheme?.textContent).toContain('.markdowner-content');
    expect(importedTheme?.textContent).not.toContain('body, h1 {');
  });

  it('saves the active document to a new path from the shell', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );
    saveDialogMock.mockResolvedValue('/tmp/project/archive/meeting-notes-copy.md');
    saveActiveDocumentAsMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentPath: '/tmp/project/archive/meeting-notes-copy.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: [
          '/tmp/project/archive/meeting-notes-copy.md',
          '/tmp/project/meeting-notes.md',
        ],
      }),
    );

    const { default: App } = await import('./App');

    const view = render(<App />);

    const saveAsButton = within(view.container).getByRole('button', {
      name: /save as/i,
    });

    await waitFor(() => {
      expect(saveAsButton).not.toHaveAttribute('disabled');
    });

    fireEvent.click(saveAsButton);

    await waitFor(() => {
      expect(saveDialogMock).toHaveBeenCalledWith({
        defaultPath: '/tmp/project/meeting-notes.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      expect(saveActiveDocumentAsMock).toHaveBeenCalledWith(
        '/tmp/project/archive/meeting-notes-copy.md',
      );
    });
  });

  it('creates an untitled document and saves it through Save As', async () => {
    newDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        activeDocumentDirty: true,
      }),
    );
    saveDialogMock.mockResolvedValue('/tmp/project/notes/untitled.md');
    saveActiveDocumentAsMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'untitled.md',
        activeDocumentPath: '/tmp/project/notes/untitled.md',
        activeDocumentSource: '',
        recentDocuments: ['/tmp/project/notes/untitled.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const newDocumentButton = await screen.findByRole('button', {
      name: /new document/i,
    });
    fireEvent.click(newDocumentButton);

    await screen.findByText(/^Untitled\.md/);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => {
      expect(saveButton).not.toHaveAttribute('disabled');
    });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(newDocumentMock).toHaveBeenCalled();
      expect(saveDialogMock).toHaveBeenCalledWith({
        defaultPath: 'Untitled.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      expect(saveActiveDocumentMock).not.toHaveBeenCalled();
      expect(saveActiveDocumentAsMock).toHaveBeenCalledWith(
        '/tmp/project/notes/untitled.md',
      );
    });
  });

  it('blocks save when the active document changed on disk', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    saveActiveDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await screen.findByText(/^meeting-notes\.md/);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(hasActiveDocumentExternalChangesMock).toHaveBeenCalled();
      expect(saveActiveDocumentMock).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          /Could not save 'meeting-notes\.md' because it changed on disk\./i,
        ),
      ).toBeInTheDocument();
    });
  });

  it('lets the user reload from disk when external changes are detected', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes\n\nUpdated from disk',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await screen.findByText(/^meeting-notes\.md/);
    fireEvent.click(saveButton);

    const reloadButton = await screen.findByRole('button', { name: /reload from disk/i });
    fireEvent.click(reloadButton);

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/meeting-notes.md');
      expect(
        screen.queryByText(
          /Could not save 'meeting-notes\.md' because it changed on disk\./i,
        ),
      ).not.toBeInTheDocument();
    });
  });

  it('lets the user keep local edits when external changes are detected', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await screen.findByText(/^meeting-notes\.md/);
    fireEvent.click(saveButton);

    const keepButton = await screen.findByRole('button', { name: /keep local/i });
    fireEvent.click(keepButton);

    await waitFor(() => {
      expect(
        screen.queryByText(
          /Could not save 'meeting-notes\.md' because it changed on disk\./i,
        ),
      ).not.toBeInTheDocument();
    });
    expect(openDocumentMock).not.toHaveBeenCalled();
  });

  it('lets the user compare local and disk versions when external changes are detected', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    activeDocumentDiskSourceMock.mockResolvedValue('# Meeting notes\n\nUpdated from disk');
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    const compareButton = await screen.findByRole('button', { name: /compare/i });
    fireEvent.click(compareButton);

    await waitFor(() => {
      expect(activeDocumentDiskSourceMock).toHaveBeenCalled();
      expect(screen.getByText('Disk')).toBeInTheDocument();
      expect(screen.getByText('Local')).toBeInTheDocument();
      const preElements = document.querySelectorAll('pre');
      expect(preElements.length).toBe(2);
      expect(preElements[0]?.textContent).toContain('Updated from disk');
    });

    const hideButton = screen.getByRole('button', { name: /hide comparison/i });
    fireEvent.click(hideButton);

    expect(screen.queryByText('Disk')).not.toBeInTheDocument();
  });

  it('syncs the unsaved draft before creating a new document', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    newDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        activeDocumentDirty: true,
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });

    const newDocumentButton = await screen.findByRole('button', {
      name: /new document/i,
    });
    fireEvent.click(newDocumentButton);

    await waitFor(() => {
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith(
        '# Meeting notes\n\nUnsaved edit',
      );
      expect(newDocumentMock).toHaveBeenCalled();
    });

    expect(
      replaceActiveDocumentSourceMock.mock.invocationCallOrder[0],
    ).toBeLessThan(newDocumentMock.mock.invocationCallOrder[0]);
  });

  it('preserves the unsaved draft when opening a workspace', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    openDialogMock.mockResolvedValue('/tmp/project');
    openWorkspaceMock.mockImplementation(async () =>
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/README.md'],
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource:
          replaceActiveDocumentSourceMock.mock.calls.length > 0
            ? '# Meeting notes\n\nUnsaved edit'
            : '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });

    const openWorkspaceButton = await screen.findByRole('button', {
      name: /open folder/i,
    });
    fireEvent.click(openWorkspaceButton);

    await waitFor(() => {
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith(
        '# Meeting notes\n\nUnsaved edit',
      );
      expect(openWorkspaceMock).toHaveBeenCalledWith('/tmp/project');
      expect(screen.getByRole('textbox', { name: /source editor/i })).toHaveValue(
        '# Meeting notes\n\nUnsaved edit',
      );
    });
  });

  it('saves the active document with the keyboard shortcut', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    saveActiveDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/^meeting-notes\.md/);

    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(saveActiveDocumentMock).toHaveBeenCalled();
    });
  });

  it('opens a workspace with the keyboard shortcut', async () => {
    openDialogMock.mockResolvedValue('/tmp/project');
    openWorkspaceMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/README.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        multiple: false,
        directory: true,
      });
      expect(openWorkspaceMock).toHaveBeenCalledWith('/tmp/project');
    });
  });

  it('switches modes with the keyboard shortcuts (Cmd+1/2/3)', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    setModeMock.mockImplementation(async (mode) =>
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode,
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/^meeting-notes\.md/);

    fireEvent.keyDown(window, { key: '1', metaKey: true });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Editor');
    });

    fireEvent.keyDown(window, { key: '2', metaKey: true });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Wysiwyg');
    });

    fireEvent.keyDown(window, { key: '3', metaKey: true });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('SplitView');
    });
  });

  it('renders friendly mode labels in the header toggle and status bar', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/^meeting-notes\.md/);

    const editorToggle = screen.getByRole('radio', { name: 'Editor' });
    const wysiwygToggle = screen.getByRole('radio', { name: 'WYSIWYG' });
    const splitToggle = screen.getByRole('radio', { name: 'Split View' });

    expect(editorToggle).toHaveAttribute('title', 'Editor (Cmd+1)');
    expect(wysiwygToggle).toHaveAttribute('title', 'WYSIWYG (Cmd+2)');
    expect(splitToggle).toHaveAttribute('title', 'Split View (Cmd+3)');

    const toggles = screen.getAllByRole('radio');
    expect(toggles[0]).toBe(editorToggle);
    expect(toggles[1]).toBe(wysiwygToggle);
    expect(toggles[2]).toBe(splitToggle);

    expect(splitToggle).toHaveAttribute('aria-checked', 'true');

    expect(screen.getAllByText('Split View').length).toBeGreaterThanOrEqual(2);
  });

  it('restores the persisted sidebar width on startup and clamps it to 220-320px', async () => {
    window.localStorage.setItem('markdowner.sidebarOpen', 'true');
    window.localStorage.setItem('markdowner.sidebarWidth', '999');

    try {
      const { default: App } = await import('./App');

      render(<App />);

      const separator = await screen.findByRole('separator', { name: /resize sidebar/i });
      expect(separator).toHaveAttribute('aria-valuemin', '220');
      expect(separator).toHaveAttribute('aria-valuemax', '320');
      expect(separator).toHaveAttribute('aria-valuenow', '320');
    } finally {
      window.localStorage.removeItem('markdowner.sidebarOpen');
      window.localStorage.removeItem('markdowner.sidebarWidth');
    }
  });

  it('opens the Quick Open dialog with Cmd+P and routes a workspace file selection', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
      }),
    );
    openWorkspaceDocumentMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
        activeDocumentName: 'api.md',
        activeDocumentPath: '/tmp/project/guides/reference/api.md',
        activeDocumentSource: '# API',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(quickOpenDialog).getByRole('textbox', {
      name: /quick open file search/i,
    });

    fireEvent.change(input, { target: { value: 'api' } });

    const apiOption = await within(quickOpenDialog).findByRole('option', {
      name: /api\.md/i,
    });

    fireEvent.click(apiOption);

    await waitFor(() => {
      expect(openWorkspaceDocumentMock).toHaveBeenCalledWith(
        '/tmp/project/guides/reference/api.md',
      );
    });
  });

  it('opens the Command Palette with Cmd+Shift+P and runs a selected command', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'split' } });

    const splitOption = await within(dialog).findByRole('option', {
      name: /mode: split view/i,
    });
    fireEvent.click(splitOption);

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('SplitView');
    });

    expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull();
  });

  it('opens the Settings dialog with the Cmd+, keyboard shortcut', async () => {
    invokeMock.mockResolvedValue({
      autoSave: false,
      editorFontSize: 14,
      editorFontFamily: '',
    });

    const { default: App } = await import('./App');

    render(<App />);

    expect(screen.queryByRole('dialog', { name: /settings/i })).toBeNull();

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    await screen.findByRole('dialog', { name: /settings/i });
  });

  it('applies the persisted editor font size to the source pane on startup', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 22,
          editorFontFamily: 'JetBrains Mono',
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const surface = await screen.findByTestId('editor-surface-source');
    await waitFor(() => {
      expect(surface.style.fontSize).toBe('22px');
    });
    expect(surface.style.fontFamily).toContain('JetBrains Mono');
  });

  it('persists font size changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const fontSizeInput = within(dialog).getByLabelText(/font size/i);

    fireEvent.change(fontSizeInput, { target: { value: '18' } });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorFontSize: 18 }),
      });
    });
  });

  it('opens a Markdown document from the native menu event', async () => {
    openDialogMock.mockResolvedValue('/tmp/project/from-menu.md');
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'from-menu.md',
        activeDocumentPath: '/tmp/project/from-menu.md',
        activeDocumentSource: '# From menu',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'open-document' });

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        multiple: false,
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/from-menu.md');
    });
  });

  it('closes the window from the native close menu command when document is clean', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'close-window' });

    await waitFor(() => {
      expect(destroyWindowMock).toHaveBeenCalled();
    });
  });

  it('switches modes from the native menu event', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'mode-splitview' });

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('SplitView');
    });
  });

  it('prompts to save dirty changes before closing the window', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    messageMock.mockResolvedValue('Save');
    saveActiveDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes\n\nUnsaved edit',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });

    const preventDefault = vi.fn();
    await closeRequestedHandler?.({ preventDefault });

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
      expect(messageMock).toHaveBeenCalledWith(
        "Save changes to 'meeting-notes.md' before closing?",
        {
          buttons: {
            yes: 'Save',
            no: "Don't Save",
            cancel: 'Cancel',
          },
          kind: 'warning',
          title: 'Markdowner',
        },
      );
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith(
        '# Meeting notes\n\nUnsaved edit',
      );
      expect(saveActiveDocumentMock).toHaveBeenCalled();
      expect(destroyWindowMock).toHaveBeenCalled();
    });
  });

  it('keeps the window open when the active document changed externally and user chose save', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
      }),
    );
    messageMock.mockResolvedValue('Save');

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });

    const preventDefault = vi.fn();
    await closeRequestedHandler?.({ preventDefault });

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
      expect(messageMock).toHaveBeenCalledWith(
        "Save changes to 'meeting-notes.md' before closing?",
        {
          buttons: {
            yes: 'Save',
            no: "Don't Save",
            cancel: 'Cancel',
          },
          kind: 'warning',
          title: 'Markdowner',
        },
      );
      expect(hasActiveDocumentExternalChangesMock).toHaveBeenCalled();
    });

    expect(destroyWindowMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /Could not save 'meeting-notes\.md' because it changed on disk\./i,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the dirty window open when close confirmation is cancelled', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
      }),
    );
    messageMock.mockResolvedValue('Cancel');

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });

    const preventDefault = vi.fn();
    await closeRequestedHandler?.({ preventDefault });

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
      expect(messageMock).toHaveBeenCalled();
    });

    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(destroyWindowMock).not.toHaveBeenCalled();
  });

  it('runs Save As before closing an untitled dirty draft', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        activeDocumentDirty: true,
      }),
    );
    messageMock.mockResolvedValue('Save');
    saveDialogMock.mockResolvedValue('/tmp/project/notes/untitled.md');
    saveActiveDocumentAsMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'untitled.md',
        activeDocumentPath: '/tmp/project/notes/untitled.md',
        activeDocumentSource: '',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });

    const preventDefault = vi.fn();
    await closeRequestedHandler?.({ preventDefault });

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
      expect(saveDialogMock).toHaveBeenCalledWith({
        defaultPath: 'Untitled.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      expect(saveActiveDocumentAsMock).toHaveBeenCalledWith('/tmp/project/notes/untitled.md');
      expect(destroyWindowMock).toHaveBeenCalled();
    });
  });
});
