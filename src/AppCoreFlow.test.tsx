import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
const loadOpenTabsMock = vi.fn();
const saveOpenTabsMock = vi.fn();
const loadDraftBackupsMock = vi.fn();
const saveDraftBackupsMock = vi.fn();
const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();
const messageMock = vi.fn();
const destroyWindowMock = vi.fn();
const startDraggingMock = vi.fn();
const onCloseRequestedMock = vi.fn();
const onDragDropEventMock = vi.fn().mockImplementation(() => Promise.resolve(vi.fn()));
const listenMock = vi.fn();
const invokeMock = vi.fn();
let dragDropHandler:
  | ((event: { payload: { type: string; paths?: string[] } }) => void | Promise<void>)
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
  importImageAsset: vi.fn(),
  completeCliWait: vi.fn(),
  quitApp: quitAppMock,
  loadOpenTabs: loadOpenTabsMock,
  saveOpenTabs: saveOpenTabsMock,
  loadDraftBackups: loadDraftBackupsMock,
  saveDraftBackups: saveDraftBackupsMock,
}));

vi.mock('@/shell/TerminalPanel', () => ({
  TerminalPanel: () => <section data-testid="terminal-panel">Terminal panel</section>,
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

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
  invoke: invokeMock,
}));

const LINE_WRAPPING_SENTINEL = '__line_wrapping__';
const CORE_FLOW_TIMEOUT_MS = 15_000;

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
    domEventHandlers: (handlers: unknown) => ({ domEventHandlers: handlers }),
    decorations: { from: () => 'decorations-from' },
  },
  // Precedence wrapper used by the source-editor theme; identity passthrough.
  Prec: { highest: (ext: unknown) => ext },
  // Stubs for the find-highlight field defined at sourceEditorExtensions
  // module load; behavior is covered by sourceFindHighlight.test.ts.
  StateEffect: { define: () => ({ of: (value: unknown) => ({ value }), is: () => false }) },
  StateField: { define: () => 'find-highlight-field' },
  Decoration: {
    mark: () => ({ range: () => null }),
    none: 'decoration-none',
    set: () => 'decoration-set',
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

function captureRuntimeErrors() {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    },
    restore() {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    },
  };
}

describe('App core Markdown editing flow', () => {
  beforeEach(() => {
    bootstrapMock.mockReset();
    activeDocumentDiskSourceMock.mockReset();
    importThemeMock.mockReset();
    hasActiveDocumentExternalChangesMock.mockReset();
    newDocumentMock.mockReset();
    openDocumentMock.mockReset();
    openWorkspaceMock.mockReset();
    openWorkspaceDocumentMock.mockReset();
    replaceActiveDocumentSourceMock.mockReset();
    saveActiveDocumentMock.mockReset();
    saveActiveDocumentAsMock.mockReset();
    setModeMock.mockReset();
    setThemeMock.mockReset();
    openDroppedPathMock.mockReset();
    quitAppMock.mockReset();
    loadOpenTabsMock.mockReset();
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [],
      activeTabPath: null,
      cursorPositions: {},
    });
    saveOpenTabsMock.mockReset();
    saveOpenTabsMock.mockResolvedValue(undefined);
    loadDraftBackupsMock.mockReset();
    loadDraftBackupsMock.mockResolvedValue([]);
    saveDraftBackupsMock.mockReset();
    saveDraftBackupsMock.mockResolvedValue(undefined);
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    messageMock.mockReset();
    destroyWindowMock.mockReset();
    startDraggingMock.mockReset();
    onCloseRequestedMock.mockReset();
    onCloseRequestedMock.mockImplementation(() => Promise.resolve(vi.fn()));
    onDragDropEventMock.mockReset();
    dragDropHandler = undefined;
    onDragDropEventMock.mockImplementation((handler) => {
      dragDropHandler = handler;
      return Promise.resolve(vi.fn());
    });
    listenMock.mockReset();
    listenMock.mockResolvedValue(vi.fn());
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          defaultMode: 'Wysiwyg',
          focusModeEnabled: false,
          typewriterModeEnabled: false,
          assetFolder: 'assets',
          themeFollowSystem: false,
          pdfPaperSize: 'A4',
          diagnosticsEnabled: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(baseSnapshot());
    hasActiveDocumentExternalChangesMock.mockResolvedValue(false);
    activeDocumentDiskSourceMock.mockRejectedValue(new Error('No active document'));
    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) =>
      baseSnapshot({
        activeDocumentName: 'active.md',
        activeDocumentPath: '/tmp/project/active.md',
        activeDocumentSource: source,
        activeDocumentDirty: true,
      }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it(
    'opens a Markdown file and switches WYSIWYG, source, and split modes without runtime errors',
    async () => {
      const openedPath = '/tmp/project/core-flow.md';
      const openedSource = ['# Core flow', '', 'A **bold** paragraph.'].join('\n');
      const openedSnapshot = baseSnapshot({
        activeDocumentName: 'core-flow.md',
        activeDocumentPath: openedPath,
        activeDocumentSource: openedSource,
        mode: 'Wysiwyg',
      });
      openDialogMock.mockResolvedValue(openedPath);
      openDocumentMock.mockResolvedValue(openedSnapshot);
      setModeMock.mockImplementation(async (mode: EditorMode) => ({
        ...openedSnapshot,
        mode,
      }));
      const runtimeErrors = captureRuntimeErrors();

      try {
        const { default: App } = await import('./App');

        render(
          <StrictMode>
            <App />
          </StrictMode>,
        );

        const openFileButton = await screen.findByRole('button', { name: /^open file…$/i });
        fireEvent.click(openFileButton);

        expect(await screen.findByRole('tab', { name: /core-flow\.md/i })).toBeInTheDocument();
        await waitFor(() => {
          expect(openDocumentMock).toHaveBeenCalledWith(openedPath);
        });
        expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveTextContent('Core flow');

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 'e', metaKey: true });
        expect(await screen.findByLabelText('Source editor')).toHaveValue(openedSource);

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 'w', metaKey: true });
        await waitFor(() => {
          expect(setModeMock).toHaveBeenCalledWith('Wysiwyg');
        });
        expect(screen.getByTestId('editor-surface-wysiwyg')).toHaveTextContent('Core flow');

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 's', metaKey: true });
        await waitFor(() => {
          expect(setModeMock).toHaveBeenCalledWith('SplitView');
        });
        await waitFor(() => {
          expect(screen.getByTestId('editor-surface-preview')).toHaveTextContent('Core flow');
        });

        await runtimeErrors.expectClean();
      } finally {
        runtimeErrors.restore();
      }
    },
    CORE_FLOW_TIMEOUT_MS,
  );

  it(
    'opens a Markdown file from the command palette dialog without a render loop',
    async () => {
      const openedPath = '/tmp/project/palette-open.md';
      const openedSource = ['# Palette open', '', 'Dialog-driven open flow.'].join('\n');
      const openedSnapshot = baseSnapshot({
        activeDocumentName: 'palette-open.md',
        activeDocumentPath: openedPath,
        activeDocumentSource: openedSource,
        mode: 'Wysiwyg',
      });
      openDialogMock.mockResolvedValue(openedPath);
      openDocumentMock.mockResolvedValue(openedSnapshot);
      setModeMock.mockImplementation(async (mode: EditorMode) => ({
        ...openedSnapshot,
        mode,
      }));
      const runtimeErrors = captureRuntimeErrors();

      try {
        const { default: App } = await import('./App');

        render(
          <StrictMode>
            <App />
          </StrictMode>,
        );

        fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });
        const dialog = await screen.findByRole('dialog', { name: /command palette/i });
        const input = screen.getByRole('textbox', { name: /command palette search/i });
        fireEvent.change(input, { target: { value: 'open file' } });
        fireEvent.click(await screen.findByRole('option', { name: /^open file/i }));

        await waitFor(() => {
          expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull();
        });
        expect(await screen.findByRole('tab', { name: /palette-open\.md/i })).toBeInTheDocument();
        expect(screen.getByText('Palette open')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 'e', metaKey: true });
        expect(await screen.findByLabelText('Source editor')).toHaveValue(openedSource);

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 's', metaKey: true });
        await waitFor(() => {
          expect(screen.getByTestId('editor-surface-preview')).toHaveTextContent('Palette open');
        });

        await runtimeErrors.expectClean();
      } finally {
        runtimeErrors.restore();
      }
    },
    CORE_FLOW_TIMEOUT_MS,
  );

  it(
    'opens a dropped Markdown file as the active tab and keeps all modes usable',
    async () => {
      const droppedPath = '/tmp/project/dropped.md';
      const droppedSource = ['# Dropped file', '', 'Opened by drag and drop.'].join('\n');
      const droppedSnapshot = baseSnapshot({
        activeDocumentName: 'dropped.md',
        activeDocumentPath: droppedPath,
        activeDocumentSource: droppedSource,
        mode: 'Wysiwyg',
      });
      openDroppedPathMock.mockResolvedValue(droppedSnapshot);
      setModeMock.mockImplementation(async (mode: EditorMode) => ({
        ...droppedSnapshot,
        mode,
      }));
      const runtimeErrors = captureRuntimeErrors();

      try {
        const { default: App } = await import('./App');

        render(
          <StrictMode>
            <App />
          </StrictMode>,
        );

        await waitFor(() => {
          expect(dragDropHandler).toBeTypeOf('function');
        });

        await act(async () => {
          await dragDropHandler?.({
            payload: {
              type: 'drop',
              paths: [droppedPath],
            },
          });
        });

        expect(await screen.findByRole('tab', { name: /dropped\.md/i })).toBeInTheDocument();
        expect(screen.getByText('Dropped file')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 'e', metaKey: true });
        expect(await screen.findByLabelText('Source editor')).toHaveValue(droppedSource);

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 's', metaKey: true });
        await waitFor(() => {
          expect(screen.getByTestId('editor-surface-preview')).toHaveTextContent('Dropped file');
        });

        await runtimeErrors.expectClean();
      } finally {
        runtimeErrors.restore();
      }
    },
    CORE_FLOW_TIMEOUT_MS,
  );

  it('restores persisted Markdown tabs before saving the open-tab session', async () => {
    const restoredPath = '/tmp/project/restored.md';
    const restoredSource = ['# Restored file', '', 'Loaded from the previous session.'].join('\n');
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [restoredPath],
      activeTabPath: restoredPath,
      cursorPositions: {},
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'restored.md',
        activeDocumentPath: restoredPath,
        activeDocumentSource: restoredSource,
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    expect(await screen.findByRole('tab', { name: /restored\.md/i })).toBeInTheDocument();
    expect(screen.getByText('Restored file')).toBeInTheDocument();

    expect(saveOpenTabsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ openTabs: [], activeTabPath: null }),
    );
    await waitFor(() => {
      expect(saveOpenTabsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          openTabs: [restoredPath],
          activeTabPath: restoredPath,
        }),
      );
    });
  });

  it('retries startup tab restore when the native launch session appears late', async () => {
    const restoredPath = '/tmp/project/late-startup.md';
    const restoredSource = ['# Late startup', '', 'Loaded after setup finishes.'].join('\n');
    loadOpenTabsMock
      .mockResolvedValueOnce({ openTabs: [], activeTabPath: null, cursorPositions: {} })
      .mockResolvedValueOnce({
        openTabs: [restoredPath],
        activeTabPath: restoredPath,
        cursorPositions: {},
      });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'late-startup.md',
        activeDocumentPath: restoredPath,
        activeDocumentSource: restoredSource,
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(loadOpenTabsMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByRole('tab', { name: /late-startup\.md/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith(restoredPath);
    });
    expect(saveOpenTabsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openTabs: [restoredPath],
        activeTabPath: restoredPath,
      }),
    );
  });

  it('keeps Settings visible when opened while persisted Markdown tabs are restoring', async () => {
    const restoredPath = '/tmp/project/restored-while-settings.md';
    let resolveOpenTabs:
      | ((payload: {
          openTabs: string[];
          activeTabPath: string | null;
          cursorPositions: Record<string, { line: number; column: number }>;
        }) => void)
      | undefined;
    loadOpenTabsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveOpenTabs = resolve;
      }),
    );
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'restored-while-settings.md',
        activeDocumentPath: restoredPath,
        activeDocumentSource: '# Restored while settings',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const settingsButton = await screen.findByRole('button', { name: /^settings \(cmd\+,\)$/i });
    fireEvent.click(settingsButton);
    expect(await screen.findByTestId('settings-panel')).toBeInTheDocument();

    await act(async () => {
      resolveOpenTabs?.({
        openTabs: [restoredPath],
        activeTabPath: restoredPath,
        cursorPositions: {},
      });
    });

    expect(await screen.findByRole('tab', { name: /^settings$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /restored-while-settings\.md/i })).toBeInTheDocument();
  });
});
