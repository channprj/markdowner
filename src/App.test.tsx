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
const importThemeMock = vi.fn();
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

vi.mock('./lib/desktop', () => ({
  bootstrap: bootstrapMock,
  importTheme: importThemeMock,
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

    await screen.findByText('meeting-notes.md');

    expect(document.title).toBe('● meeting-notes.md — Markdowner');
  });

  it('scopes imported custom CSS to markdown content surfaces', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'theme-preview.md',
        activeDocumentPath: '/tmp/project/theme-preview.md',
        activeDocumentSource: '# Scoped preview',
        mode: 'Preview',
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

    await screen.findByText('Untitled.md');

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

  it('syncs the unsaved draft before creating a new document', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Source',
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
        mode: 'Source',
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
        mode: 'Source',
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

    await screen.findByText('meeting-notes.md');

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

  it('switches modes with the keyboard shortcuts', async () => {
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
        mode: 'Source',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText('meeting-notes.md');

    fireEvent.keyDown(window, { key: '2', metaKey: true });

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Source');
    });
  });
});
