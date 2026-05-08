import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSnapshot, EditorMode } from './lib/desktop';

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
const openDroppedPathMock = vi.fn();
const quitAppMock = vi.fn();
const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();
const messageMock = vi.fn();
const destroyWindowMock = vi.fn();
const startDraggingMock = vi.fn();
const onCloseRequestedMock = vi.fn();
const onDragDropEventMock = vi.fn().mockImplementation(() => Promise.resolve(vi.fn()));
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
  openDroppedPath: openDroppedPathMock,
  quitApp: quitAppMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openDialogMock,
  save: saveDialogMock,
  message: messageMock,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: destroyWindowMock,
    startDragging: startDraggingMock,
    onCloseRequested: onCloseRequestedMock,
    onDragDropEvent: onDragDropEventMock,
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

const LINE_WRAPPING_SENTINEL = '__line_wrapping__';

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    extensions,
  }: {
    value: string;
    onChange: (value: string) => void;
    extensions?: unknown[];
  }) => (
    <textarea
      aria-label="Source editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-line-wrap={
        Array.isArray(extensions) && extensions.includes(LINE_WRAPPING_SENTINEL)
          ? 'true'
          : 'false'
      }
    />
  ),
  EditorView: {
    lineWrapping: LINE_WRAPPING_SENTINEL,
    theme: (spec: unknown) => ({ spec }),
    updateListener: {
      of: (listener: unknown) => ({ listener }),
    },
  },
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

async function openAppMenu() {
  const menuButton = await screen.findByRole('button', { name: /^app menu$/i });
  fireEvent.click(menuButton);
  return screen.findByRole('menu', { name: /^app menu$/i });
}

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  });
}

function captureRuntimeErrors() {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const errors: unknown[] = [];
  const handleError = (event: ErrorEvent) => {
    errors.push(event.error ?? event.message);
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    errors.push(event.reason);
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return {
    async expectClean() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(errors).toEqual([]);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    },
    restore() {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      consoleErrorSpy.mockRestore();
    },
  };
}

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
    quitAppMock.mockReset();
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    messageMock.mockReset();
    destroyWindowMock.mockReset();
    startDraggingMock.mockReset();
    onCloseRequestedMock.mockReset();
    listenMock.mockReset();
    hasActiveDocumentExternalChangesMock.mockReset();
    invokeMock.mockReset();
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

  it('exposes empty-state action buttons that open dialogs and create documents', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());
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

    const newFileButton = await screen.findByRole('button', { name: /^new file$/i });
    const openFileButton = screen.getByRole('button', { name: /^open file…$/i });
    const openWorkspaceButton = screen.getByRole('button', { name: /^open workspace…$/i });

    expect(newFileButton).toBeInTheDocument();
    expect(openFileButton).toBeInTheDocument();
    expect(openWorkspaceButton).toBeInTheDocument();

    expect(newFileButton).toHaveAttribute('title', 'New File (Cmd+N)');
    expect(openFileButton).toHaveAttribute('title', 'Open File (Cmd+O)');
    expect(openWorkspaceButton).toHaveAttribute(
      'title',
      'Open Workspace (Cmd+Shift+O)',
    );

    fireEvent.click(newFileButton);

    await waitFor(() => {
      expect(newDocumentMock).toHaveBeenCalled();
    });
  });

  it('exposes aria-keyshortcuts on the EditorArea empty-state action buttons', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const newFileButton = await screen.findByRole('button', { name: /^new file$/i });
    const openFileButton = screen.getByRole('button', { name: /^open file…$/i });
    const openWorkspaceButton = screen.getByRole('button', { name: /^open workspace…$/i });

    expect(newFileButton).toHaveAttribute('aria-keyshortcuts', 'Meta+N Control+N');
    expect(openFileButton).toHaveAttribute('aria-keyshortcuts', 'Meta+O Control+O');
    expect(openWorkspaceButton).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Shift+O Control+Shift+O',
    );
  });

  it('shows header loading feedback while creating a new document', async () => {
    let resolveNewDocument: ((snapshot: AppSnapshot) => void) | undefined;
    newDocumentMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveNewDocument = resolve;
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const newFileButton = await screen.findByRole('button', { name: /^new file$/i });
    fireEvent.click(newFileButton);

    expect(await screen.findByRole('status', { name: /working/i })).toBeInTheDocument();

    resolveNewDocument?.(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        activeDocumentDirty: true,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /working/i })).not.toBeInTheDocument();
    });
  });

  it('exposes the ActivityBar as a named vertical toolbar landmark', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const toolbar = await screen.findByRole('toolbar', { name: /activity bar/i });

    expect(toolbar).toHaveAttribute('aria-orientation', 'vertical');
    expect(
      within(toolbar).getByRole('button', { name: /^explorer \(cmd\+b\)$/i }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /^quick open \(cmd\+p\)$/i }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /^outline$/i }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /^settings \(cmd\+,\)$/i }),
    ).toBeInTheDocument();
  });

  it('smoke-tests empty-state controls without runtime errors', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());
    openDialogMock.mockResolvedValue(null);
    newDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        activeDocumentDirty: true,
      }),
    );
    const runtimeErrors = captureRuntimeErrors();

    try {
      const { default: App } = await import('./App');

      render(<App />);

      const newFileButton = await screen.findByRole('button', { name: /^new file$/i });
      const openFileButton = screen.getByRole('button', { name: /^open file…$/i });
      const openWorkspaceButton = screen.getByRole('button', { name: /^open workspace…$/i });

      fireEvent.click(openFileButton);
      await waitFor(() => expect(openDialogMock).toHaveBeenCalledTimes(1));

      fireEvent.click(openWorkspaceButton);
      await waitFor(() => expect(openDialogMock).toHaveBeenCalledTimes(2));

      fireEvent.click(screen.getByRole('button', { name: /^quick open \(cmd\+p\)$/i }));
      const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });
      const quickOpenInput = within(quickOpenDialog).getByRole('textbox', {
        name: /quick open file search/i,
      });
      fireEvent.change(quickOpenInput, { target: { value: 'missing' } });
      fireEvent.keyDown(quickOpenInput, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /quick open/i })).toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /^settings \(cmd\+,\)$/i }));
      const settingsDialog = await screen.findByRole('dialog', { name: /^settings$/i });
      fireEvent.click(within(settingsDialog).getByRole('button', { name: /^close$/i }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /^settings$/i })).toBeNull();
      });

      fireEvent.click(newFileButton);
      await waitFor(() => expect(newDocumentMock).toHaveBeenCalled());

      await runtimeErrors.expectClean();
    } finally {
      runtimeErrors.restore();
    }
  });

  it('smoke-tests active document menus and commands without runtime errors', async () => {
    const activeSnapshot = baseSnapshot({
      rootDir: '/tmp/project',
      workspaceDocuments: [
        '/tmp/project/README.md',
        '/tmp/project/guides/reference/api.md',
      ],
      recentDocuments: ['/tmp/project/README.md'],
      activeDocumentName: 'meeting-notes.md',
      activeDocumentPath: '/tmp/project/meeting-notes.md',
      activeDocumentSource: ['# Agenda', '', '## Decisions'].join('\n'),
      mode: 'Editor',
    });
    bootstrapMock.mockResolvedValue(activeSnapshot);
    openDialogMock.mockResolvedValue(null);
    saveActiveDocumentMock.mockResolvedValue(activeSnapshot);
    openWorkspaceDocumentMock.mockResolvedValue({
      ...activeSnapshot,
      activeDocumentName: 'api.md',
      activeDocumentPath: '/tmp/project/guides/reference/api.md',
      activeDocumentSource: '# API',
    });
    setModeMock.mockImplementation(async (mode: EditorMode) => ({
      ...activeSnapshot,
      mode,
    }));
    setThemeMock.mockImplementation(async (themeKind: AppSnapshot['theme']['kind']) => ({
      ...activeSnapshot,
      theme: {
        kind: themeKind,
        stylesheet: null,
        stylesheetPath: null,
      },
    }));
    const runtimeErrors = captureRuntimeErrors();

    try {
      const { default: App } = await import('./App');

      render(<App />);

      await screen.findByLabelText(/source editor/i);

      let menu = await openAppMenu();
      fireEvent.click(within(menu).getByRole('menuitem', { name: /^save$/i }));
      await waitFor(() => expect(saveActiveDocumentMock).toHaveBeenCalled());

      menu = await openAppMenu();
      fireEvent.click(within(menu).getByRole('menuitem', { name: /^import css…$/i }));
      await waitFor(() => expect(openDialogMock).toHaveBeenCalled());

      menu = await openAppMenu();
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^split view$/i }));
      await waitFor(() => expect(setModeMock).toHaveBeenCalledWith('SplitView'));

      menu = await openAppMenu();
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^light theme$/i }));
      await waitFor(() => expect(setThemeMock).toHaveBeenCalledWith('BuiltInLight'));

      menu = await openAppMenu();
      fireEvent.click(within(menu).getByRole('menuitem', { name: /^settings$/i }));
      const settingsDialog = await screen.findByRole('dialog', { name: /^settings$/i });
      fireEvent.click(within(settingsDialog).getByRole('button', { name: /^close$/i }));

      fireEvent.click(screen.getByRole('button', { name: /^outline$/i }));
      const agendaHeading = await screen.findByRole('button', { name: /^agenda$/i });
      fireEvent.click(agendaHeading);

      fireEvent.click(screen.getByRole('button', { name: /^quick open \(cmd\+p\)$/i }));
      const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });
      fireEvent.change(
        within(quickOpenDialog).getByRole('textbox', {
          name: /quick open file search/i,
        }),
        { target: { value: 'api' } },
      );
      fireEvent.click(
        await within(quickOpenDialog).findByRole('option', { name: /api\.md/i }),
      );
      await waitFor(() => {
        expect(openWorkspaceDocumentMock).toHaveBeenCalledWith(
          '/tmp/project/guides/reference/api.md',
        );
      });

      fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });
      const commandPaletteDialog = await screen.findByRole('dialog', {
        name: /command palette/i,
      });
      fireEvent.change(
        within(commandPaletteDialog).getByRole('textbox', {
          name: /command palette search/i,
        }),
        { target: { value: 'word wrap' } },
      );
      fireEvent.click(
        await within(commandPaletteDialog).findByRole('option', {
          name: /disable word wrap/i,
        }),
      );
      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith('save_settings', {
          settings: expect.objectContaining({ editorLineWrap: false }),
        });
      });

      await runtimeErrors.expectClean();
    } finally {
      runtimeErrors.restore();
    }
  });

  it('opens an Outline sidebar view with document headings from the active draft', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions', '', '### Follow-up'].join('\n'),
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const outlineButton = await screen.findByRole('button', { name: /^outline$/i });
    expect(outlineButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(outlineButton);

    await waitFor(() => {
      expect(outlineButton).toHaveAttribute('aria-pressed', 'true');
    });

    expect(screen.getByText(/^outline$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^agenda$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decisions$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^follow-up$/i })).toBeInTheDocument();
  });

  it('moves focus to the matching heading when selecting an Outline item in source mode', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions', 'Notes', '', '### Follow-up'].join('\n'),
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    const outlineButton = screen.getByRole('button', { name: /^outline$/i });

    fireEvent.click(outlineButton);
    fireEvent.click(await screen.findByRole('button', { name: /^decisions$/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveFocus();
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(10);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(22);
    });
  });

  it('exposes Split View source and preview panes as named landmark regions', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceRegion = await screen.findByRole('region', { name: /markdown source/i });
    const previewRegion = await screen.findByRole('region', { name: /markdown preview/i });

    expect(sourceRegion).toHaveAttribute('data-testid', 'editor-surface-source');
    expect(previewRegion).toHaveAttribute('data-testid', 'editor-surface-preview');
    expect(sourceRegion).toHaveClass('min-h-0');
    expect(previewRegion).toHaveClass('min-h-0');
  });

  it('syncs Split View source and preview scrolling proportionally', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'),
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceRegion = await screen.findByRole('region', { name: /markdown source/i });
    const previewRegion = await screen.findByRole('region', { name: /markdown preview/i });

    setScrollMetrics(sourceRegion, 1000, 200);
    setScrollMetrics(previewRegion, 600, 100);

    sourceRegion.scrollTop = 400;
    fireEvent.scroll(sourceRegion);
    expect(previewRegion.scrollTop).toBe(250);

    previewRegion.scrollTop = 125;
    fireEvent.scroll(previewRegion);
    expect(sourceRegion.scrollTop).toBe(200);
  });

  it('moves the source cursor to the clicked rendered block in Split View', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: ['# Title', '', 'First paragraph', '', 'Second paragraph'].join('\n'),
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    const secondParagraph = await screen.findByText('Second paragraph');

    fireEvent.click(secondParagraph);

    await waitFor(() => {
      expect(sourceEditor).toHaveFocus();
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(26);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(26);
    });
  });

  it('constrains the desktop shell so editor panes own vertical scrolling', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'),
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceSurface = await screen.findByTestId('editor-surface-source');
    const editorRoot = sourceSurface.closest('main');
    const shellGrid = editorRoot?.parentElement;

    expect(shellGrid).toHaveClass('min-h-0');
    expect(editorRoot).toHaveClass('min-h-0');
    expect(sourceSurface).toHaveClass('overflow-auto');
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

    // 3 from before + 1 from the new tab strip
    expect(await screen.findAllByText('draft.md')).toHaveLength(4);
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

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(screen.queryByText(/^Ln \d+, Col \d+$/)).not.toBeInTheDocument();
    });
  });

  it('shows word, character, and reading time counts in the status bar for an open document', async () => {
    const twoHundredOneWords = Array.from({ length: 201 }, (_, index) => `word${index + 1}`).join(' ');

    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: twoHundredOneWords,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    expect(
      await screen.findByText(/^201 words · 1499 chars · ~2 min read$/),
    ).toBeInTheDocument();
  });

  it('opens the Document Stats dialog with Cmd+Shift+I and shows derived document counts', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: [
          '---',
          'title: Meeting Notes',
          '---',
          '',
          '# Agenda',
          '',
          'Review the [spec](https://example.com/spec).',
          '',
          '![Diagram](./assets/diagram.png)',
          '',
          '| Task | Owner |',
          '| --- | --- |',
          '| Ship | Team |',
        ].join('\n'),
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findAllByText(/^meeting-notes\.md$/);

    fireEvent.keyDown(window, { key: 'I', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /document stats/i });

    expect(within(dialog).getByText(/^meeting-notes\.md$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^26$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^166$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^~1 min$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^1$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^1 table$/)).toBeInTheDocument();
  });

  it('omits document statistics when no document is open', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/Start your next document/);
    expect(screen.queryByText(/words ·/)).not.toBeInTheDocument();
  });

  it('omits the saved/unsaved status bar label when no document is open', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/Start your next document/);
    expect(screen.queryByText(/^Saved$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Unsaved Changes$/)).not.toBeInTheDocument();
  });

  it('shows the saved/unsaved status bar label when a document is open', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: false,
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    expect(await screen.findByText(/^Saved$/)).toBeInTheDocument();
  });

  it('renders friendly theme labels in the status bar instead of the raw enum', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        theme: {
          kind: 'BuiltInDark',
          stylesheet: null,
          stylesheetPath: null,
        },
      }),
    );

    const { default: App } = await import('./App');

    const { container } = render(<App />);

    await screen.findByText(/Start your next document/);
    const statusBar = container.querySelector('footer');
    expect(statusBar).not.toBeNull();
    const themeLabel = within(statusBar as HTMLElement).getByText(/^Dark$/);
    expect(themeLabel).toBeInTheDocument();
    expect(themeLabel.className).not.toMatch(/uppercase/);
    expect(within(statusBar as HTMLElement).queryByText(/BuiltInDark/i)).not.toBeInTheDocument();
  });

  it('exposes descriptive tooltips on the StatusBar mode, theme, and save-status spans', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        mode: 'Editor',
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: false,
        theme: {
          kind: 'BuiltInDark',
          stylesheet: null,
          stylesheetPath: null,
        },
      }),
    );

    const { default: App } = await import('./App');

    const { container } = render(<App />);

    await screen.findByText(/^Saved$/);
    const statusBar = container.querySelector('footer');
    expect(statusBar).not.toBeNull();
    const scope = within(statusBar as HTMLElement);

    expect(scope.getByText(/^Saved$/)).toHaveAttribute('title', 'Save status');
    expect(scope.getByText(/^Editor$/)).toHaveAttribute('title', 'Active editor mode');
    expect(scope.getByText(/^Dark$/)).toHaveAttribute('title', 'Active theme');
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

    await screen.findAllByText(/^meeting-notes\.md/);

    expect(document.title).toBe('● meeting-notes.md — Markdowner');
  });

  it('surfaces the active document name and path in the status bar', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    const { container, unmount } = render(<App />);

    const statusBar = container.querySelector('footer');
    expect(statusBar).not.toBeNull();
    const documentLabel = await within(statusBar as HTMLElement).findByText(
      /^meeting-notes\.md$/,
    );
    await waitFor(() => {
      expect(documentLabel).toHaveAttribute('title', '/tmp/project/meeting-notes.md');
    });

    unmount();
    cleanup();

    bootstrapMock.mockResolvedValue(baseSnapshot());

    render(<App />);

    await screen.findByText(/Start your next document/);
    expect(screen.queryByText(/^meeting-notes\.md$/)).not.toBeInTheDocument();
  });

  it('exposes a System theme toggle that persists themeFollowSystem through settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          themeFollowSystem: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    setThemeMock.mockImplementation(async (kind: 'BuiltInLight' | 'BuiltInDark' | 'CustomCss') =>
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        theme: { kind, stylesheet: null, stylesheetPath: null },
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    let menu = await openAppMenu();
    let lightToggle = within(menu).getByRole('menuitemradio', { name: /light theme/i });
    const darkToggle = within(menu).getByRole('menuitemradio', { name: /dark theme/i });
    const systemToggle = within(menu).getByRole('menuitemradio', {
      name: /follow system theme/i,
    });

    expect(lightToggle).toBeInTheDocument();
    expect(darkToggle).toBeInTheDocument();
    expect(systemToggle).toBeInTheDocument();

    fireEvent.click(systemToggle);

    await waitFor(() => {
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInDark');
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ themeFollowSystem: true }),
      });
    });

    menu = await openAppMenu();
    lightToggle = within(menu).getByRole('menuitemradio', { name: /light theme/i });
    fireEvent.click(lightToggle);

    await waitFor(() => {
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInLight');
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ themeFollowSystem: false }),
      });
    });
  });

  it('applies the current OS theme when Follow System Theme is enabled from Settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          themeFollowSystem: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        theme: { kind: 'BuiltInLight', stylesheet: null, stylesheetPath: null },
      }),
    );
    setThemeMock.mockImplementation(async (kind: 'BuiltInLight' | 'BuiltInDark' | 'CustomCss') =>
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        theme: { kind, stylesheet: null, stylesheetPath: null },
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const systemThemeToggle = within(dialog).getByLabelText(/follow system theme/i);
    fireEvent.click(systemThemeToggle);

    await waitFor(() => {
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInDark');
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ themeFollowSystem: true }),
      });
    });
  });

  it('does not sync the theme to the OS on startup when themeFollowSystem is disabled', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          themeFollowSystem: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        theme: { kind: 'BuiltInLight', stylesheet: null, stylesheetPath: null },
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });
    await waitFor(() => {
      expect(bootstrapMock).toHaveBeenCalled();
    });

    expect(setThemeMock).not.toHaveBeenCalled();
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

    render(<App />);

    const menu = await openAppMenu();
    const saveAsButton = within(menu).getByRole('menuitem', { name: /^save as…$/i });

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

  it('exposes keyboard-shortcut tooltips on app menu file actions', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
    const saveAsButton = within(menu).getByRole('menuitem', { name: /^save as…$/i });
    const importCssButton = within(menu).getByRole('menuitem', {
      name: /^import css…$/i,
    });

    expect(saveButton).toHaveAttribute('title', 'Save (Cmd+S)');
    expect(saveAsButton).toHaveAttribute('title', 'Save As (Cmd+Shift+S)');
    expect(importCssButton).toHaveAttribute('title', 'Import a custom CSS theme');
  });

  it('exposes aria-keyshortcuts on app menu shortcut actions and mode items', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
    const saveAsButton = within(menu).getByRole('menuitem', { name: /^save as…$/i });

    expect(saveButton).toHaveAttribute('aria-keyshortcuts', 'Meta+S Control+S');
    expect(saveAsButton).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Shift+S Control+Shift+S',
    );

    const editorToggle = within(menu).getByRole('menuitemradio', { name: 'Editor' });
    const wysiwygToggle = within(menu).getByRole('menuitemradio', { name: 'WYSIWYG' });
    const splitToggle = within(menu).getByRole('menuitemradio', { name: 'Split View' });

    expect(editorToggle).toHaveAttribute('aria-keyshortcuts', 'Meta+1 Control+1');
    expect(wysiwygToggle).toHaveAttribute('aria-keyshortcuts', 'Meta+2 Control+2');
    expect(splitToggle).toHaveAttribute('aria-keyshortcuts', 'Meta+3 Control+3');
  });

  it('exposes aria-keyshortcuts on the ActivityBar Explorer/Quick Open/Settings buttons', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    const view = render(<App />);

    const explorerButton = await waitFor(() =>
      within(view.container).getByRole('button', { name: /^explorer \(cmd\+b\)$/i }),
    );
    const quickOpenButton = within(view.container).getByRole('button', {
      name: /^quick open \(cmd\+p\)$/i,
    });
    const settingsButton = within(view.container).getByRole('button', {
      name: /^settings \(cmd\+,\)$/i,
    });

    expect(explorerButton).toHaveAttribute('aria-keyshortcuts', 'Meta+B Control+B');
    expect(quickOpenButton).toHaveAttribute('aria-keyshortcuts', 'Meta+P Control+P');
    expect(settingsButton).toHaveAttribute('aria-keyshortcuts', 'Meta+, Control+,');
  });

  it('exposes consistent tooltips on app menu theme items', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    const lightToggle = within(menu).getByRole('menuitemradio', { name: /light theme/i });
    const darkToggle = within(menu).getByRole('menuitemradio', { name: /dark theme/i });
    const systemToggle = within(menu).getByRole('menuitemradio', {
      name: /follow system theme/i,
    });

    expect(lightToggle).toHaveAttribute('title', 'Light theme');
    expect(darkToggle).toHaveAttribute('title', 'Dark theme');
    expect(systemToggle).toHaveAttribute('title', 'Follow system theme');
  });

  it('exposes keyboard-shortcut tooltips on the SideBar workspace action buttons', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const newDocumentButton = await screen.findByRole('button', {
      name: /^new document$/i,
    });
    const openFolderButton = screen.getByRole('button', {
      name: /^open folder…$/i,
    });
    const openMarkdownButton = screen.getByRole('button', {
      name: /^open markdown…$/i,
    });

    expect(newDocumentButton).toHaveAttribute('title', 'New Document (Cmd+N)');
    expect(openFolderButton).toHaveAttribute('title', 'Open Folder (Cmd+Shift+O)');
    expect(openMarkdownButton).toHaveAttribute('title', 'Open Markdown (Cmd+O)');
  });

  it('exposes aria-keyshortcuts on the SideBar workspace action buttons', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const newDocumentButton = await screen.findByRole('button', {
      name: /^new document$/i,
    });
    const openFolderButton = screen.getByRole('button', {
      name: /^open folder…$/i,
    });
    const openMarkdownButton = screen.getByRole('button', {
      name: /^open markdown…$/i,
    });

    expect(newDocumentButton).toHaveAttribute('aria-keyshortcuts', 'Meta+N Control+N');
    expect(openFolderButton).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Shift+O Control+Shift+O',
    );
    expect(openMarkdownButton).toHaveAttribute('aria-keyshortcuts', 'Meta+O Control+O');
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

    await screen.findAllByText(/^Untitled\.md/);

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
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

  it('opens a new untitled tab with Cmd+T', async () => {
    newDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    fireEvent.keyDown(window, { key: 't', metaKey: true });

    await waitFor(() => {
      expect(newDocumentMock).toHaveBeenCalled();
    });
  });

  it('closes the window on Cmd+W when the active tab has no edits', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        // Rust-side dirty flag set, but localDraft will match source so the
        // frontend should not prompt and should close directly.
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findAllByText(/^meeting-notes\.md/);

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(destroyWindowMock).toHaveBeenCalled();
    });
    expect(messageMock).not.toHaveBeenCalled();
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

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
    await screen.findAllByText(/^meeting-notes\.md/);
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

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
    await screen.findAllByText(/^meeting-notes\.md/);
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

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
    await screen.findAllByText(/^meeting-notes\.md/);
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

    const menu = await openAppMenu();
    const saveButton = within(menu).getByRole('menuitem', { name: /^save$/i });
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

    await screen.findAllByText(/^meeting-notes\.md/);

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

  it('switches modes with the Cmd+K chord shortcuts (Cmd+K Cmd+E/W/S)', async () => {
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

    await screen.findAllByText(/^meeting-notes\.md/);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 'e', metaKey: true });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Editor');
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 'w', metaKey: true });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Wysiwyg');
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('SplitView');
    });
  });

  it('renders the selected mode before backend mode persistence resolves', async () => {
    let resolveMode:
      | ((snapshot: AppSnapshot) => void)
      | undefined;

    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Wysiwyg',
      }),
    );
    setModeMock.mockReturnValue(
      new Promise<AppSnapshot>((resolve) => {
        resolveMode = resolve;
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findAllByText(/^meeting-notes\.md/);
    expect(screen.queryByRole('textbox', { name: /source editor/i })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 'e', metaKey: true });

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Editor');
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /source editor/i })).toHaveValue(
        '# Meeting notes',
      );
    });

    resolveMode?.(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
  });

  it('keeps the latest mode selected when earlier mode persistence resolves later', async () => {
    const pendingModeResolutions = new Map<EditorMode, (snapshot: AppSnapshot) => void>();

    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Wysiwyg',
      }),
    );
    setModeMock.mockImplementation(
      (mode: EditorMode) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingModeResolutions.set(mode, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findAllByText(/^meeting-notes\.md/);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 'e', metaKey: true });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Editor');
      expect(setModeMock).toHaveBeenCalledWith('SplitView');
    });
    expect(await screen.findByTestId('editor-surface-preview')).toBeInTheDocument();

    await act(async () => {
      pendingModeResolutions.get('SplitView')?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          mode: 'SplitView',
        }),
      );
    });
    expect(screen.getByTestId('editor-surface-preview')).toBeInTheDocument();

    await act(async () => {
      pendingModeResolutions.get('Editor')?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          mode: 'Editor',
        }),
      );
    });

    expect(screen.getByTestId('editor-surface-preview')).toBeInTheDocument();
  });

  it('keeps the selected mode when an older draft sync resolves later', async () => {
    let resolveBackgroundSync: ((snapshot: AppSnapshot) => void) | undefined;

    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    replaceActiveDocumentSourceMock
      .mockImplementationOnce(
        () =>
          new Promise<AppSnapshot>((resolve) => {
            resolveBackgroundSync = resolve;
          }),
      )
      .mockResolvedValue(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Edited notes',
          mode: 'SplitView',
        }),
      );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Edited notes',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.change(sourceEditor, { target: { value: '# Edited notes' } });

    await waitFor(() => {
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith('# Edited notes');
    });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(await screen.findByTestId('editor-surface-preview')).toBeInTheDocument();

    await act(async () => {
      resolveBackgroundSync?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Edited notes',
          mode: 'Editor',
        }),
      );
    });

    expect(screen.getByTestId('editor-surface-preview')).toBeInTheDocument();
  });

  it('opens the Document Stats dialog from the Command Palette', async () => {
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

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'document stats' } });

    const option = await within(dialog).findByRole('option', {
      name: /open document stats/i,
    });
    fireEvent.click(option);

    expect(await screen.findByRole('dialog', { name: /document stats/i })).toBeInTheDocument();
  });

  it('renders friendly mode labels in the app menu and status bar', async () => {
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

    await screen.findAllByText(/^meeting-notes\.md/);

    const menu = await openAppMenu();
    const editorToggle = within(menu).getByRole('menuitemradio', { name: 'Editor' });
    const wysiwygToggle = within(menu).getByRole('menuitemradio', { name: 'WYSIWYG' });
    const splitToggle = within(menu).getByRole('menuitemradio', { name: 'Split View' });

    expect(editorToggle).toHaveAttribute('title', 'Editor (Cmd+1)');
    expect(wysiwygToggle).toHaveAttribute('title', 'WYSIWYG (Cmd+2)');
    expect(splitToggle).toHaveAttribute('title', 'Split View (Cmd+3)');

    const toggles = within(menu).getAllByRole('menuitemradio');
    expect(toggles[0]).toBe(editorToggle);
    expect(toggles[1]).toBe(wysiwygToggle);
    expect(toggles[2]).toBe(splitToggle);

    expect(splitToggle).toHaveAttribute('aria-checked', 'true');

    const statusBar = document.querySelector('footer');
    expect(statusBar).not.toBeNull();
    expect(within(statusBar as HTMLElement).getByText('Split View')).toBeInTheDocument();
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

  it('resets the sidebar width to the default when the resize separator is double-clicked', async () => {
    window.localStorage.setItem('markdowner.sidebarOpen', 'true');
    window.localStorage.setItem('markdowner.sidebarWidth', '320');

    try {
      const { default: App } = await import('./App');

      render(<App />);

      const separator = await screen.findByRole('separator', { name: /resize sidebar/i });
      expect(separator).toHaveAttribute('aria-valuenow', '320');
      expect(separator).toHaveAttribute(
        'title',
        'Drag to resize sidebar (double-click to reset, arrow keys to adjust)',
      );

      fireEvent.doubleClick(separator);

      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '280');
      });
      expect(window.localStorage.getItem('markdowner.sidebarWidth')).toBe('280');
    } finally {
      window.localStorage.removeItem('markdowner.sidebarOpen');
      window.localStorage.removeItem('markdowner.sidebarWidth');
    }
  });

  it('resizes the sidebar with arrow / page / home / end keys on the separator', async () => {
    window.localStorage.setItem('markdowner.sidebarOpen', 'true');
    window.localStorage.setItem('markdowner.sidebarWidth', '280');

    try {
      const { default: App } = await import('./App');

      render(<App />);

      const separator = await screen.findByRole('separator', { name: /resize sidebar/i });
      expect(separator).toHaveAttribute('tabindex', '0');

      fireEvent.keyDown(separator, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '288');
      });

      fireEvent.keyDown(separator, { key: 'ArrowLeft' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '280');
      });

      fireEvent.keyDown(separator, { key: 'PageDown' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '312');
      });

      fireEvent.keyDown(separator, { key: 'End' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '320');
      });

      // Clamp at max — further increase is a no-op.
      fireEvent.keyDown(separator, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '320');
      });

      fireEvent.keyDown(separator, { key: 'Home' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '220');
      });

      expect(window.localStorage.getItem('markdowner.sidebarWidth')).toBe('220');
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

  it('filters Quick Open with a space-separated query that spans the name and path', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/guides/reference/api.md',
          '/tmp/project/README.md',
        ],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(quickOpenDialog).getByRole('textbox', {
      name: /quick open file search/i,
    });

    await within(quickOpenDialog).findAllByRole('option');

    fireEvent.change(input, { target: { value: 'md guides' } });

    await waitFor(() => {
      expect(within(quickOpenDialog).queryAllByRole('option')).toHaveLength(1);
    });
    const match = within(quickOpenDialog).getByRole('option');
    expect(match).toHaveTextContent(/api\.md/);
    expect(match).toHaveTextContent(/guides\/reference\/api\.md/);
  });

  it('filters Quick Open with multi-token queries regardless of token order', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/guides/reference/api.md',
          '/tmp/project/README.md',
        ],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(quickOpenDialog).getByRole('textbox', {
      name: /quick open file search/i,
    });

    await within(quickOpenDialog).findAllByRole('option');

    fireEvent.change(input, { target: { value: 'guides api' } });

    await waitFor(() => {
      expect(within(quickOpenDialog).queryAllByRole('option')).toHaveLength(1);
    });
    const match = within(quickOpenDialog).getByRole('option');
    expect(match).toHaveTextContent(/api\.md/);
    expect(match).toHaveTextContent(/guides\/reference\/api\.md/);
  });

  it('groups Quick Open entries under Workspace Files and Recent Files section headers', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/guides/draft.md',
        ],
        recentDocuments: [
          '/tmp/project/README.md',
          '/tmp/elsewhere/notes.md',
        ],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });

    const options = await within(quickOpenDialog).findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('data-kind', 'workspace');
    expect(options[1]).toHaveAttribute('data-kind', 'workspace');
    expect(options[2]).toHaveAttribute('data-kind', 'recent');

    const listbox = within(quickOpenDialog).getByRole('listbox');
    const headers = Array.from(
      listbox.querySelectorAll<HTMLElement>('[data-section-header]'),
    );
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveAttribute('data-section-header', 'workspace');
    expect(headers[0]).toHaveTextContent(/workspace files/i);
    expect(headers[1]).toHaveAttribute('data-section-header', 'recent');
    expect(headers[1]).toHaveTextContent(/recent files/i);
  });

  it('opens the Quick Open dialog when the Activity Bar Search button is clicked', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/README.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const searchButton = await screen.findByRole('button', { name: /quick open \(cmd\+p\)/i });
    fireEvent.click(searchButton);

    await screen.findByRole('dialog', { name: /quick open/i });
  });

  it('opens Quick Open without mounting the shared Radix dialog overlay', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/README.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(dialog).getByRole('textbox', {
      name: /quick open file search/i,
    });

    expect(input).toHaveFocus();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  it('marks the Activity Bar Search button as pressed while the Quick Open dialog is open', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const searchButton = await screen.findByRole('button', { name: /quick open \(cmd\+p\)/i });
    const settingsButton = await screen.findByRole('button', { name: /settings \(cmd\+,\)/i });

    expect(searchButton).toHaveAttribute('aria-pressed', 'false');
    expect(settingsButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(searchButton);
    await screen.findByRole('dialog', { name: /quick open/i });

    expect(searchButton).toHaveAttribute('aria-pressed', 'true');
    expect(settingsButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the Activity Bar Settings button as pressed while the Settings dialog is open', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const searchButton = await screen.findByRole('button', { name: /quick open \(cmd\+p\)/i });
    const settingsButton = await screen.findByRole('button', { name: /settings \(cmd\+,\)/i });

    fireEvent.click(settingsButton);
    await screen.findByRole('dialog', { name: /settings/i });

    expect(settingsButton).toHaveAttribute('aria-pressed', 'true');
    expect(searchButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('reserves a draggable top titlebar with a compact app menu', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    const { container } = render(<App />);

    await screen.findByText(/Start your next document/);

    expect(container.querySelector('header')).toBeNull();
    const titlebar = screen.getByTestId('app-titlebar');
    const dragRegion = screen.getByTestId('app-titlebar-drag-region');
    const menuButton = within(titlebar).getByRole('button', { name: /^app menu$/i });

    expect(titlebar).toHaveClass('h-[35px]');
    expect(dragRegion).toHaveAttribute('data-tauri-drag-region');
    expect(dragRegion).toHaveClass('flex-1');
    fireEvent.pointerDown(dragRegion, { button: 0 });
    expect(startDraggingMock).toHaveBeenCalledTimes(1);
    expect(menuButton).toHaveClass('h-7', 'w-7');
    expect(menuButton.className).not.toContain('shadow');
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
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

  it('toggles Word Wrap from the Command Palette and persists it through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
        };
      }
      return undefined;
    });
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

    const sourceEditor = await screen.findByLabelText(/source editor/i);
    await waitFor(() => {
      expect(sourceEditor.getAttribute('data-line-wrap')).toBe('true');
    });

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'wrap' } });

    const wrapOption = await within(dialog).findByRole('option', {
      name: /disable word wrap/i,
    });
    fireEvent.click(wrapOption);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorLineWrap: false }),
      });
    });

    await waitFor(() => {
      expect(sourceEditor.getAttribute('data-line-wrap')).toBe('false');
    });
  });

  it('toggles Auto Save from the Command Palette and persists it through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'auto save' } });

    const enableOption = await within(dialog).findByRole('option', {
      name: /enable auto save/i,
    });
    fireEvent.click(enableOption);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ autoSave: true }),
      });
    });
  });

  it('resets settings to defaults from the Command Palette and persists through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: true,
          editorFontSize: 22,
          editorFontFamily: 'JetBrains Mono',
          editorLineWrap: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'reset' } });

    const resetOption = await within(dialog).findByRole('option', {
      name: /reset settings to defaults/i,
    });
    fireEvent.click(resetOption);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          defaultMode: 'Wysiwyg',
          focusModeEnabled: false,
          typewriterModeEnabled: false,
          assetFolder: 'assets',
          themeFollowSystem: true,
          pdfPaperSize: 'A4',
          diagnosticsEnabled: false,
        },
      });
    });
  });

  it('groups Command Palette entries contiguously in File → View → Preferences → Theme order', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const options = within(dialog).getAllByRole('option');
    const categories = options.map((option) =>
      option.getAttribute('data-category')?.trim() ?? '',
    );

    let lastIndex = -1;
    for (const expected of ['File', 'View', 'Preferences', 'Theme']) {
      const firstIndex = categories.indexOf(expected);
      const lastSeen = categories.lastIndexOf(expected);
      expect(firstIndex).toBeGreaterThan(lastIndex);
      const slice = categories.slice(firstIndex, lastSeen + 1);
      expect(slice.every((category) => category === expected)).toBe(true);
      lastIndex = lastSeen;
    }

    const headers = within(dialog).getAllByText(/^File$|^View$|^Preferences$|^Theme$/);
    const headerCategories = headers
      .filter((node) => node.hasAttribute('data-category-header'))
      .map((node) => node.getAttribute('data-category-header'));
    expect(headerCategories).toEqual(['File', 'View', 'Preferences', 'Theme']);
  });

  it('renders the Command Palette empty-state placeholder with role="presentation" when no commands match', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'zzznotacommand' } });

    await waitFor(() => {
      expect(within(dialog).queryAllByRole('option')).toHaveLength(0);
    });

    const placeholder = dialog.querySelector('[data-empty-state="command-palette"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('role')).toBe('presentation');
    expect(placeholder?.textContent).toMatch(/no matches/i);
  });

  it('renders the Quick Open empty-state placeholder with role="presentation" when no files match', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        workspaceDocuments: ['/tmp/project/api.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(dialog).getByRole('textbox', { name: /quick open file search/i });

    fireEvent.change(input, { target: { value: 'zzznotamatch' } });

    await waitFor(() => {
      expect(within(dialog).queryAllByRole('option')).toHaveLength(0);
    });

    const placeholder = dialog.querySelector('[data-empty-state="quick-open"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('role')).toBe('presentation');
    expect(placeholder?.textContent).toMatch(/no matches/i);
  });

  it('jumps to the last and first Quick Open option with End and Home keys', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/alpha.md',
          '/tmp/project/beta.md',
          '/tmp/project/gamma.md',
        ],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(dialog).getByRole('textbox', { name: /quick open file search/i });

    const options = await within(dialog).findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(input, { key: 'End' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[refreshed.length - 1]).toHaveAttribute('data-active', 'true');
    });

    fireEvent.keyDown(input, { key: 'Home' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[0]).toHaveAttribute('data-active', 'true');
    });
  });

  it('jumps to the last and first Command Palette command with End and Home keys', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    const options = await within(dialog).findAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(input, { key: 'End' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[refreshed.length - 1]).toHaveAttribute('data-active', 'true');
    });

    fireEvent.keyDown(input, { key: 'Home' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[0]).toHaveAttribute('data-active', 'true');
    });
  });

  it('advances and retreats Quick Open selection by a page with PageDown and PageUp', async () => {
    const documents = Array.from(
      { length: 12 },
      (_, index) => `/tmp/project/file-${String(index).padStart(2, '0')}.md`,
    );
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: documents,
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(dialog).getByRole('textbox', { name: /quick open file search/i });

    const options = await within(dialog).findAllByRole('option');
    expect(options).toHaveLength(12);
    expect(options[0]).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(input, { key: 'PageDown' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[10]).toHaveAttribute('data-active', 'true');
    });

    fireEvent.keyDown(input, { key: 'PageDown' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[refreshed.length - 1]).toHaveAttribute('data-active', 'true');
    });

    fireEvent.keyDown(input, { key: 'PageUp' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[1]).toHaveAttribute('data-active', 'true');
    });

    fireEvent.keyDown(input, { key: 'PageUp' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[0]).toHaveAttribute('data-active', 'true');
    });
  });

  it('advances and retreats Command Palette selection by a page with PageDown and PageUp', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    const options = await within(dialog).findAllByRole('option');
    expect(options.length).toBeGreaterThan(10);
    expect(options[0]).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(input, { key: 'PageDown' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[10]).toHaveAttribute('data-active', 'true');
    });

    fireEvent.keyDown(input, { key: 'PageUp' });
    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(refreshed[0]).toHaveAttribute('data-active', 'true');
    });
  });

  it('tracks the highlighted Quick Open option via aria-activedescendant', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/alpha.md',
          '/tmp/project/beta.md',
          '/tmp/project/gamma.md',
        ],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(dialog).getByRole('textbox', { name: /quick open file search/i });
    const listbox = within(dialog).getByRole('listbox', { name: /workspace files/i });

    const listboxId = listbox.getAttribute('id');
    expect(listboxId).toBeTruthy();
    expect(input).toHaveAttribute('aria-controls', listboxId);

    const options = await within(dialog).findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('id');
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      options[0].getAttribute('id') as string,
    );

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(input).toHaveAttribute(
        'aria-activedescendant',
        refreshed[1].getAttribute('id') as string,
      );
    });
  });

  it('tracks the highlighted Command Palette option via aria-activedescendant', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });
    const listbox = within(dialog).getByRole('listbox', { name: /available commands/i });

    const listboxId = listbox.getAttribute('id');
    expect(listboxId).toBeTruthy();
    expect(input).toHaveAttribute('aria-controls', listboxId);

    const options = await within(dialog).findAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      options[0].getAttribute('id') as string,
    );

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      const refreshed = within(dialog).getAllByRole('option');
      expect(input).toHaveAttribute(
        'aria-activedescendant',
        refreshed[1].getAttribute('id') as string,
      );
    });
  });

  it('exposes aria-autocomplete="list" on the Quick Open input', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/alpha.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'p', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /quick open/i });
    const input = within(dialog).getByRole('textbox', {
      name: /quick open file search/i,
    });
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('exposes aria-autocomplete="list" on the Command Palette input', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', {
      name: /command palette search/i,
    });
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
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

  it('keeps the Settings dialog layout usable at compact window widths', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          defaultMode: 'Wysiwyg',
          assetFolder: 'assets',
          pdfPaperSize: 'A4',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const body = within(dialog).getByTestId('settings-dialog-body');
    const aliasSnippet = within(dialog).getByText(/^alias markdowner=/);
    const fontFamilyRow = within(dialog).getByTestId('settings-field-font-family');
    const fontFamilyInput = within(dialog).getByLabelText(/font family/i);
    const defaultModeToggle = within(dialog).getByTestId('settings-default-mode-toggle');
    const pdfPaperSizeToggle = within(dialog).getByTestId('settings-pdf-paper-size-toggle');

    expect(dialog).toHaveClass('max-h-[calc(100dvh-3rem)]', 'overflow-hidden', 'p-0');
    expect(body).toHaveClass('overflow-y-auto');
    expect(aliasSnippet).toHaveClass('whitespace-pre-wrap', 'break-all');
    expect(fontFamilyRow).toHaveClass('grid', 'gap-2');
    expect(fontFamilyInput).toHaveClass('w-full', 'min-w-0');
    expect(defaultModeToggle).toHaveClass('h-auto', 'w-full', 'flex-wrap');
    expect(pdfPaperSizeToggle).toHaveClass('h-auto', 'w-full', 'flex-wrap');
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

  it('persists font family changes from the Settings dialog through save_settings', async () => {
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

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const fontFamilyInput = within(dialog).getByLabelText(/font family/i);

    fireEvent.change(fontFamilyInput, { target: { value: 'Fira Code' } });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorFontFamily: 'Fira Code' }),
      });
    });

    const surface = await screen.findByTestId('editor-surface-source');
    await waitFor(() => {
      expect(surface.style.fontFamily).toContain('Fira Code');
    });
  });

  it('auto-saves the active document after edits when autoSave setting is enabled', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: true,
          editorFontSize: 14,
          editorFontFamily: '',
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
    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) =>
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: source,
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    saveActiveDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes edited',
        activeDocumentDirty: false,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.change(sourceEditor, { target: { value: '# Notes edited' } });

    await waitFor(
      () => {
        expect(saveActiveDocumentMock).toHaveBeenCalled();
      },
      { timeout: 4000 },
    );
  });

  it('does not auto-save when autoSave setting is disabled', async () => {
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
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'Editor',
      }),
    );
    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) =>
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: source,
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.change(sourceEditor, { target: { value: '# Notes edited' } });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
  });

  it('applies line wrapping to the source editor when editorLineWrap is enabled', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
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

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor.getAttribute('data-line-wrap')).toBe('true');
    });
  });

  it('omits line wrapping from the source editor when editorLineWrap is disabled', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: false,
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

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor.getAttribute('data-line-wrap')).toBe('false');
    });
  });

  it('persists Word Wrap toggle changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const wrapToggle = within(dialog).getByLabelText(/word wrap/i);

    fireEvent.click(wrapToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorLineWrap: false }),
      });
    });
  });

  it('persists Default Startup Mode changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          defaultMode: 'Editor',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const splitViewToggle = within(dialog).getByRole('radio', { name: /split view/i });

    fireEvent.click(splitViewToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ defaultMode: 'SplitView' }),
      });
    });
  });

  it('persists Focus Mode changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          focusModeEnabled: false,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const focusModeToggle = within(dialog).getByLabelText(/focus mode/i);

    fireEvent.click(focusModeToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ focusModeEnabled: true }),
      });
    });
  });

  it('applies Focus Mode to the active editor surface when toggled in Settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          focusModeEnabled: false,
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
    expect(surface).toHaveAttribute('data-focus-mode', 'false');

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const focusModeToggle = within(dialog).getByLabelText(/focus mode/i);
    fireEvent.click(focusModeToggle);

    await waitFor(() => {
      expect(surface).toHaveAttribute('data-focus-mode', 'true');
    });
  });

  it('persists Typewriter Mode changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          typewriterModeEnabled: false,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const typewriterModeToggle = within(dialog).getByLabelText(/typewriter mode/i);

    fireEvent.click(typewriterModeToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ typewriterModeEnabled: true }),
      });
    });
  });

  it('applies Typewriter Mode to the active editor surface when toggled in Settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          typewriterModeEnabled: false,
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
    expect(surface).toHaveAttribute('data-typewriter-mode', 'false');

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const typewriterModeToggle = within(dialog).getByLabelText(/typewriter mode/i);
    fireEvent.click(typewriterModeToggle);

    await waitFor(() => {
      expect(surface).toHaveAttribute('data-typewriter-mode', 'true');
    });
  });

  it('persists PDF Paper Size changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          pdfPaperSize: 'A4',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const letterToggle = within(dialog).getByRole('radio', { name: /letter/i });

    fireEvent.click(letterToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ pdfPaperSize: 'Letter' }),
      });
    });
  });

  it('persists Diagnostics logging changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          diagnosticsEnabled: false,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const diagnosticsToggle = within(dialog).getByLabelText(/diagnostics logging/i);

    fireEvent.click(diagnosticsToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ diagnosticsEnabled: true }),
      });
    });
  });

  it('emits local diagnostics after Diagnostics Logging is enabled', async () => {
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          diagnosticsEnabled: false,
        };
      }
      return undefined;
    });

    try {
      const { default: App } = await import('./App');

      render(<App />);

      fireEvent.keyDown(window, { key: ',', metaKey: true });

      const dialog = await screen.findByRole('dialog', { name: /settings/i });
      const diagnosticsToggle = within(dialog).getByLabelText(/diagnostics logging/i);
      fireEvent.click(diagnosticsToggle);

      await waitFor(() => {
        expect(consoleInfoSpy).toHaveBeenCalledWith(
          '[Markdowner diagnostics]',
          'settings.changed',
          expect.objectContaining({
            changedKeys: ['diagnosticsEnabled'],
            diagnosticsEnabled: true,
          }),
        );
      });
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('falls back to the default asset folder when the Settings dialog input is cleared', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          assetFolder: 'media',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const assetFolderInput = within(dialog).getByLabelText(/asset folder/i);

    fireEvent.change(assetFolderInput, { target: { value: '' } });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ assetFolder: 'assets' }),
      });
    });
  });

  it('restores default values when "Reset to Defaults" is clicked in the Settings dialog', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: true,
          editorFontSize: 22,
          editorFontFamily: 'JetBrains Mono',
          editorLineWrap: false,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const resetButton = within(dialog).getByRole('button', { name: /reset to defaults/i });

    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          defaultMode: 'Wysiwyg',
          focusModeEnabled: false,
          typewriterModeEnabled: false,
          assetFolder: 'assets',
          themeFollowSystem: true,
          pdfPaperSize: 'A4',
          diagnosticsEnabled: false,
        },
      });
    });

    expect(within(dialog).getByLabelText(/font size/i)).toHaveValue(14);
    expect(within(dialog).getByLabelText(/font family/i)).toHaveValue('');
  });

  it('exposes a descriptive tooltip on the Settings dialog Reset to Defaults button', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const resetButton = within(dialog).getByRole('button', { name: /reset to defaults/i });

    expect(resetButton).toHaveAttribute(
      'title',
      'Reset all editor preferences to factory defaults',
    );
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
        multiple: true,
        directory: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/from-menu.md');
    });
  });

  it('opens multiple Markdown documents as tabs when the dialog returns an array', async () => {
    openDialogMock.mockResolvedValue([
      '/tmp/project/alpha.md',
      '/tmp/project/beta.md',
      '/tmp/project/gamma.md',
    ]);
    openDocumentMock.mockImplementation(async (path: string) => {
      const name = path.split('/').pop() ?? path;
      return baseSnapshot({
        activeDocumentName: name,
        activeDocumentPath: path,
        activeDocumentSource: `# ${name}`,
      });
    });

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'open-document' });

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledTimes(3);
    });
    expect(openDocumentMock).toHaveBeenNthCalledWith(1, '/tmp/project/alpha.md');
    expect(openDocumentMock).toHaveBeenNthCalledWith(2, '/tmp/project/beta.md');
    expect(openDocumentMock).toHaveBeenNthCalledWith(3, '/tmp/project/gamma.md');

    const tablist = await screen.findByRole('tablist');
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
  });

  it('opens a recent document from the native menu event', async () => {
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'open-recent-document:/tmp/project/meeting-notes.md' });

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/meeting-notes.md');
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

  it('closes the window with Cmd+W when document is clean', async () => {
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

    await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(destroyWindowMock).toHaveBeenCalled();
    });
    expect(messageMock).not.toHaveBeenCalled();
  });

  it('closes a dirty window from Cmd+W without saving when discard is selected', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    messageMock.mockResolvedValue("Don't Save");

    const { default: App } = await import('./App');

    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
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
      expect(destroyWindowMock).toHaveBeenCalled();
    });
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(quitAppMock).not.toHaveBeenCalled();
  });

  it('quits the app from the native quit menu command when document is clean', async () => {
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

    await menuCommandHandler?.({ payload: 'quit-app' });

    await waitFor(() => {
      expect(quitAppMock).toHaveBeenCalled();
    });
    expect(destroyWindowMock).not.toHaveBeenCalled();
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
    await screen.findAllByText(/^meeting-notes\.md$/);

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

  it('closes a dirty window without saving when the close confirmation returns No', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    messageMock.mockResolvedValue('No');

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });
    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });
    await screen.findAllByText(/^meeting-notes\.md$/);

    const preventDefault = vi.fn();
    await closeRequestedHandler?.({ preventDefault });

    await waitFor(() => {
      expect(preventDefault).toHaveBeenCalled();
      expect(messageMock).toHaveBeenCalled();
      expect(destroyWindowMock).toHaveBeenCalled();
    });
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(quitAppMock).not.toHaveBeenCalled();
  });

  it('quits a dirty app without saving when Cmd+Q discard is selected', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    messageMock.mockResolvedValue('No');

    const { default: App } = await import('./App');

    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });

    fireEvent.keyDown(window, { key: 'q', metaKey: true });

    await waitFor(() => {
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
      expect(quitAppMock).toHaveBeenCalled();
    });
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(destroyWindowMock).not.toHaveBeenCalled();
  });

  it('keeps the window open when the active document changed externally and user chose save', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
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

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });
    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });
    await screen.findAllByText(/^meeting-notes\.md$/);

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
        mode: 'Editor',
      }),
    );
    messageMock.mockResolvedValue('Cancel');

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });
    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });
    await screen.findAllByText(/^meeting-notes\.md$/);

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
        mode: 'Editor',
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
    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: 'Some draft content' } });
    await screen.findAllByText(/^Untitled\.md$/);

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
