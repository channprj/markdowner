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

import gfmContractFixture from '../tests/fixtures/gfm-contract.md?raw';
import type { AppSnapshot, EditorMode } from './lib/desktop';

const bootstrapMock = vi.fn();
const activeDocumentDiskSourceMock = vi.fn();
const importThemeMock = vi.fn();
const hasActiveDocumentExternalChangesMock = vi.fn();
const reloadActiveDocumentFromDiskMock = vi.fn();
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
  AI_ACTIVITY_CHANGED_EVENT: 'markdowner://ai-activity-changed',
  AI_HISTORY_CHANGED_EVENT: 'markdowner://ai-history-changed',
  bootstrap: bootstrapMock,
  activeDocumentDiskSource: activeDocumentDiskSourceMock,
  importTheme: importThemeMock,
  hasActiveDocumentExternalChanges: hasActiveDocumentExternalChangesMock,
  reloadActiveDocumentFromDisk: reloadActiveDocumentFromDiskMock,
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
  aiCancel: vi.fn(),
  aiListActive: vi.fn().mockResolvedValue([]),
  aiHistoryPage: vi.fn().mockResolvedValue({
    items: [],
    page: 0,
    pageSize: 20,
    total: 0,
  }),
  aiHistoryDetail: vi.fn().mockResolvedValue(null),
  aiHistoryDelete: vi.fn().mockResolvedValue(false),
  aiHistoryClear: vi.fn().mockResolvedValue(0),
  aiInterviewStart: vi.fn(),
  aiInterviewAnswer: vi.fn(),
  aiInterviewUpdateAnswer: vi.fn(),
  aiInterviewSkip: vi.fn(),
  aiInterviewFinish: vi.fn(),
  aiInterviewResume: vi.fn(),
  aiDeleteKey: vi.fn(),
  aiDiscardResult: vi.fn(),
  aiKeyStatus: vi.fn().mockResolvedValue({
    configured: false,
    maskedLabel: null,
  }),
  aiListModels: vi.fn().mockResolvedValue([]),
  aiModelPricing: vi.fn(),
  aiRenderSelectedOperations: vi.fn(),
  aiRun: vi.fn(),
  aiSaveKey: vi.fn(),
  aiVerifyKey: vi.fn(),
  localAgentStatuses: vi.fn().mockResolvedValue([]),
  localAgentRun: vi.fn(),
  localAgentCancel: vi.fn().mockResolvedValue(true),
  openExternalUrl: vi.fn(),
  openExternalUrlInNewWindow: vi.fn(),
  readTextFiles: vi.fn().mockResolvedValue([]),
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

vi.mock('./lib/sourceSkillCompletion', () => ({
  createSourceSkillCompletionExtension: () => '__skill_completion__',
}));

const TAB_WIDTH = 100;

/**
 * Pins the tab strip geometry a pointer drag reads, which jsdom otherwise
 * reports as zero: equal tabs of `TAB_WIDTH` packed from content x=0.
 */
function layoutTabStrip() {
  const strip = screen.getByRole('tablist', { name: /open documents/i });
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 400,
    width: 400,
  } as DOMRect);
  screen.getAllByRole('tab').forEach((node, index) => {
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
      left: index * TAB_WIDTH,
      right: (index + 1) * TAB_WIDTH,
      width: TAB_WIDTH,
    } as DOMRect);
  });
}

/** Drags the tab at `fromIndex` so its centre lands on `toClientX`. */
function dragTabTo(node: Element, fromIndex: number, toClientX: number) {
  fireEvent.pointerDown(node, {
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: fromIndex * TAB_WIDTH + TAB_WIDTH / 2,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: toClientX });
  fireEvent.pointerUp(document, { pointerId: 1 });
}

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
  activeDocumentVersion: { id: 1, revision: 0 },
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
    reloadActiveDocumentFromDiskMock.mockReset();
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
          pdfPaperOrientation: 'portrait',
          pdfPaperWidthMm: 210,
          pdfPaperHeightMm: 297,
          diagnosticsEnabled: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(baseSnapshot());
    hasActiveDocumentExternalChangesMock.mockResolvedValue(false);
    // A clean open re-reads the document from disk; with no external change the
    // fresh read matches the just-opened source.
    reloadActiveDocumentFromDiskMock.mockImplementation(
      ({ path, expectedSource }: { path: string; expectedSource: string }) =>
        Promise.resolve(
          baseSnapshot({
            activeDocumentName: path.split('/').pop() ?? path,
            activeDocumentPath: path,
            activeDocumentSource: expectedSource,
          }),
        ),
    );
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
      const openedPath = '/tmp/project/gfm-contract.md';
      const openedSource = gfmContractFixture;
      const openedSnapshot = baseSnapshot({
        activeDocumentName: 'gfm-contract.md',
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

        expect(await screen.findByRole('tab', { name: /gfm-contract\.md/i })).toBeInTheDocument();
        await waitFor(() => {
          expect(openDocumentMock).toHaveBeenCalledWith(openedPath);
        });
        const wysiwygSurface = screen.getByTestId('editor-surface-wysiwyg');
        expect(wysiwygSurface).toHaveTextContent('GFM Contract');
        expect(wysiwygSurface.querySelector('table')).toBeInTheDocument();
        expect(wysiwygSurface.querySelector('s')).toHaveTextContent('Retired text');

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 'e', metaKey: true });
        expect(await screen.findByLabelText('Source editor')).toHaveValue(openedSource);

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 'w', metaKey: true });
        await waitFor(() => {
          expect(setModeMock).toHaveBeenCalledWith('Wysiwyg');
        });
        expect(
          screen.getByTestId('editor-surface-wysiwyg').querySelector('table'),
        ).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'k', metaKey: true });
        fireEvent.keyDown(window, { key: 's', metaKey: true });
        await waitFor(() => {
          expect(setModeMock).toHaveBeenCalledWith('SplitView');
        });
        await waitFor(() => {
          const preview = screen.getByTestId('editor-surface-preview');
          expect(preview.querySelector('table')).toBeInTheDocument();
          expect(preview.querySelector('del')).toHaveTextContent('Retired text');
          expect(preview.querySelector('script')).toBeNull();
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
        expect(screen.getAllByText('Dropped file').length).toBeGreaterThan(0);

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
    // The WYSIWYG surface renders the restored content asynchronously after the
    // tab appears, so wait for it rather than asserting synchronously.
    expect((await screen.findAllByText('Restored file')).length).toBeGreaterThan(0);

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

  it('persists a mouse-reordered tab sequence without switching the active document', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    const gammaPath = '/tmp/project/gamma.md';
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath, gammaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) =>
      Promise.resolve(
        baseSnapshot({
          activeDocumentName:
            path === alphaPath
              ? 'alpha.md'
              : path === betaPath
                ? 'beta.md'
                : 'gamma.md',
          activeDocumentPath: path,
          activeDocumentSource:
            path === alphaPath ? '# Alpha' : path === betaPath ? '# Beta' : '# Gamma',
          mode: 'Wysiwyg',
        }),
      ),
    );

    const { default: App } = await import('./App');
    render(<App />);

    const alpha = await screen.findByRole('tab', { name: /alpha\.md/i });
    const beta = await screen.findByRole('tab', { name: /beta\.md/i });
    await screen.findByRole('tab', { name: /gamma\.md/i });
    await waitFor(() => expect(alpha).toHaveAttribute('aria-selected', 'true'));
    saveOpenTabsMock.mockClear();

    layoutTabStrip();
    // Drag beta past gamma's midpoint so it lands in the trailing slot.
    dragTabTo(beta, 1, 400);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      expect.stringContaining('alpha.md'),
      expect.stringContaining('gamma.md'),
      expect.stringContaining('beta.md'),
    ]);
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(beta).toHaveAttribute('aria-selected', 'false');
    await waitFor(() => {
      expect(saveOpenTabsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          openTabs: [alphaPath, gammaPath, betaPath],
          activeTabPath: alphaPath,
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
