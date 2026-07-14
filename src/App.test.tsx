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

// Mirror of DEFAULT_IGNORE_LIST in src/lib/settings.ts. Inlined (not imported)
// so this file's `@tauri-apps/api/core` mock isn't evaluated before its
// hoisted `invokeMock` is initialized. Keep in sync with the source list.
const DEFAULT_IGNORE_LIST = [
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'wheels',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.direnv',
  '.cache',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
];

const bootstrapMock = vi.fn();
const activeDocumentDiskSourceMock = vi.fn();
const importThemeMock = vi.fn();
const hasActiveDocumentExternalChangesMock = vi.fn();
const reloadActiveDocumentFromDiskMock = vi.fn();
const newDocumentMock = vi.fn();
const newWindowMock = vi.fn();
const openDocumentMock = vi.fn();
const openWorkspaceMock = vi.fn();
const openWorkspaceDocumentMock = vi.fn();
const replaceActiveDocumentSourceMock = vi.fn();
const saveActiveDocumentMock = vi.fn();
const saveActiveDocumentAsMock = vi.fn();
const setModeMock = vi.fn();
const setThemeMock = vi.fn();
const openDroppedPathMock = vi.fn();
const importImageAssetMock = vi.fn();
const completeCliWaitMock = vi.fn();
const quitAppMock = vi.fn();
const loadOpenTabsMock = vi.fn();
const saveOpenTabsMock = vi.fn();
const loadDraftBackupsMock = vi.fn();
const saveDraftBackupsMock = vi.fn();
const searchWorkspaceMock = vi.fn();
const resolveMarkdownLinkMock = vi.fn();
const openExternalUrlMock = vi.fn();
const openPathInDefaultAppMock = vi.fn();
const readTextFilesMock = vi.fn();
const readImagesBase64Mock = vi.fn();
const exportPdfFileMock = vi.fn();
const exportPdfFilesMock = vi.fn();
const exportTextFileMock = vi.fn();
const exportTextFilesMock = vi.fn();
const openDialogMock = vi.fn();
const saveDialogMock = vi.fn();
const messageMock = vi.fn();
const destroyWindowMock = vi.fn();
const hideWindowMock = vi.fn();
const startDraggingMock = vi.fn();
const onCloseRequestedMock = vi.fn();
const onDragDropEventMock = vi.fn().mockImplementation(() => Promise.resolve(vi.fn()));
const listenMock = vi.fn();
type DragDropEventPayload = { type: string; paths?: string[] };
let closeRequestedHandler:
  | ((event: { preventDefault: () => void }) => Promise<void>)
  | undefined;
let dragDropHandler:
  | ((event: { payload: DragDropEventPayload }) => void | Promise<void>)
  | undefined;
let menuCommandHandler:
  | ((event: { payload: string }) => void | Promise<void>)
  | undefined;
let updateSnapshotHandler:
  | ((event: { payload: AppSnapshot }) => void | Promise<void>)
  | undefined;

vi.mock('./lib/desktop', () => ({
  bootstrap: bootstrapMock,
  activeDocumentDiskSource: activeDocumentDiskSourceMock,
  importTheme: importThemeMock,
  hasActiveDocumentExternalChanges: hasActiveDocumentExternalChangesMock,
  reloadActiveDocumentFromDisk: reloadActiveDocumentFromDiskMock,
  newDocument: newDocumentMock,
  newWindow: newWindowMock,
  openDocument: openDocumentMock,
  openWorkspace: openWorkspaceMock,
  openWorkspaceDocument: openWorkspaceDocumentMock,
  replaceActiveDocumentSource: replaceActiveDocumentSourceMock,
  saveActiveDocument: saveActiveDocumentMock,
  saveActiveDocumentAs: saveActiveDocumentAsMock,
  setMode: setModeMock,
  setTheme: setThemeMock,
  openDroppedPath: openDroppedPathMock,
  importImageAsset: importImageAssetMock,
  completeCliWait: completeCliWaitMock,
  quitApp: quitAppMock,
  loadOpenTabs: loadOpenTabsMock,
  saveOpenTabs: saveOpenTabsMock,
  loadDraftBackups: loadDraftBackupsMock,
  saveDraftBackups: saveDraftBackupsMock,
  searchWorkspace: searchWorkspaceMock,
  resolveMarkdownLink: resolveMarkdownLinkMock,
  openExternalUrl: openExternalUrlMock,
  openPathInDefaultApp: openPathInDefaultAppMock,
  readTextFiles: readTextFilesMock,
  readImagesBase64: readImagesBase64Mock,
  exportPdfFile: exportPdfFileMock,
  exportPdfFiles: exportPdfFilesMock,
  exportTextFile: exportTextFileMock,
  exportTextFiles: exportTextFilesMock,
}));

vi.mock('@/shell/TerminalPanel', async () => {
  const React = await import('react');
  return {
    TerminalPanel: React.forwardRef(
      (
        {
          height,
          onFocusChange,
          onHeightChange,
          onRequestFocusEditor,
          onResizePointerDown,
          workingDirectory,
        }: {
          height?: number;
          onFocusChange?: (focused: boolean) => void;
          onHeightChange?: (height: number) => void;
          onRequestFocusEditor?: () => void;
          onResizePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
          workingDirectory?: string | null;
        },
        ref: React.ForwardedRef<{ focus: () => void }>,
      ) => {
        React.useImperativeHandle(ref, () => ({
          focus: () => {
            onFocusChange?.(true);
          },
        }));
        return (
          <section
            data-testid="terminal-panel"
            data-working-directory={workingDirectory ?? ''}
            tabIndex={0}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
          >
            <div
              role="separator"
              aria-label="Resize terminal"
              aria-orientation="horizontal"
              aria-valuenow={height}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  onHeightChange?.((height ?? 256) + 8);
                }
              }}
              onPointerDown={onResizePointerDown}
            />
            <button type="button" onClick={onRequestFocusEditor}>
              Focus editor
            </button>
            Terminal panel
          </section>
        );
      },
    ),
  };
});

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openDialogMock,
  save: saveDialogMock,
  message: messageMock,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    destroy: destroyWindowMock,
    hide: hideWindowMock,
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
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
  invoke: invokeMock,
}));

const tiptapMockState = vi.hoisted(() => ({
  editor: null as any,
  lastOptions: null as any,
}));

vi.mock('@tiptap/react', () => ({
  EditorContent: ({ editor }: { editor: any }) => (
    <div
      data-testid="mock-tiptap-editor"
      data-selection-from={editor?.lastSelection?.from ?? ''}
      data-selection-to={editor?.lastSelection?.to ?? ''}
    />
  ),
  useEditor: (options: any) => {
    tiptapMockState.lastOptions = options;
    return tiptapMockState.editor;
  },
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

function workspaceSearchFile(
  path: string,
  heading: string,
  match: { start: number; end: number; absoluteOffset: number } = {
    start: 2,
    end: 2 + heading.length,
    absoluteOffset: 2,
  },
) {
  return {
    path,
    matches: [
      {
        line: 1,
        column: 3,
        preview: `# ${heading}`,
        matchStart: match.start,
        matchEnd: match.end,
        absoluteOffset: match.absoluteOffset,
      },
    ],
  };
}

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

// Simulate following a rendered markdown link in the WYSIWYG surface: append
// an anchor to the editor DOM (where App's capture-phase interceptor listens)
// and dispatch a real click on its inner label. Returns the dispatched event
// so callers can assert `defaultPrevented`.
function clickSurfaceLink(
  surface: HTMLElement,
  href: string,
  init: MouseEventInit = {},
): MouseEvent {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  const label = document.createElement('span');
  label.textContent = 'link';
  anchor.appendChild(label);
  surface.appendChild(anchor);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  label.dispatchEvent(event);
  return event;
}

interface MockTiptapTextSegment {
  text: string;
  from: number;
}

function createMockTiptapEditor(markdown: string, segments: MockTiptapTextSegment[]) {
  const mutableSegments = segments.map((segment) => ({ ...segment }));
  const editor: any = {
    markdown,
    lastSelection: null,
  };
  const mockSelectionAnchor = { parent: { type: { name: 'paragraph' } } };

  const rebuildDoc = () => ({
    content: { size: editor.markdown.length + 2 },
    descendants: (callback: (node: any, position: number) => void) => {
      mutableSegments.forEach((segment) => {
        callback({ isText: true, text: segment.text }, segment.from);
      });
    },
    forEach: (callback: (node: any, offset: number) => void) => {
      callback(
        {
          type: { name: 'paragraph' },
          textContent: editor.markdown,
          nodeSize: editor.markdown.length + 2,
        },
        0,
      );
    },
    cut: (from: number, to: number) => ({
      __markdownSlice: editor.markdown.slice(
        Math.max(0, from),
        Math.max(0, Math.min(to, editor.markdown.length)),
      ),
      descendants: (callback: (node: any, position: number) => void) => {
        mutableSegments.forEach((segment) => {
          callback({ isText: true, text: segment.text }, segment.from);
        });
      },
      forEach: (callback: (node: any, offset: number) => void) => {
        callback(
          {
            type: { name: 'paragraph' },
            textContent: editor.markdown,
            nodeSize: editor.markdown.length + 2,
          },
          0,
        );
      },
    }),
  });

  const replaceRange = (from: number, to: number, text: string) => {
    const startIndex = mutableSegments.findIndex(
      (segment) => from >= segment.from && from <= segment.from + segment.text.length,
    );
    const endIndex = mutableSegments.findIndex(
      (segment) => to >= segment.from && to <= segment.from + segment.text.length,
    );
    if (startIndex < 0 || endIndex < 0 || startIndex !== endIndex) {
      return;
    }

    const segment = mutableSegments[startIndex];
    const startOffset = from - segment.from;
    const endOffset = to - segment.from;
    const nextText = `${segment.text.slice(0, startOffset)}${text}${segment.text.slice(endOffset)}`;
    const delta = nextText.length - segment.text.length;
    segment.text = nextText;
    for (let index = startIndex + 1; index < mutableSegments.length; index += 1) {
      mutableSegments[index].from += delta;
    }
    editor.markdown = mutableSegments.map((item) => item.text).join('\n');
    editor.state.doc = rebuildDoc();
  };

  const transaction = {
    insertText: vi.fn((text: string, from: number, to: number) => {
      replaceRange(from, to, text);
      return transaction;
    }),
    scrollIntoView: vi.fn(() => transaction),
  };

  editor.state = {
    doc: rebuildDoc(),
    selection: {
      from: segments[0]?.from ?? 0,
      to: segments[0]?.from ?? 0,
      head: segments[0]?.from ?? 0,
      $from: mockSelectionAnchor,
    },
    tr: transaction,
  };
  editor.view = {
    state: editor.state,
    dispatch: vi.fn(),
    focus: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
    // The WYSIWYG link interceptor attaches a capture-phase click listener to
    // the editor DOM; tests dispatch real clicks on anchors appended here.
    dom: document.createElement('div'),
  };
  editor.commands = {
    setContent: vi.fn((content: string, _options?: unknown) => {
      editor.markdown = content;
      return true;
    }),
    focus: vi.fn(() => true),
    setTextSelection: vi.fn((selection: number | { from: number; to: number }) => {
      const next =
        typeof selection === 'number'
          ? { from: selection, to: selection }
          : selection;
      const previousSelection = editor.state.selection ?? {};
      const previousSelectionConstructor =
        typeof previousSelection.constructor?.create === 'function'
          ? previousSelection.constructor
          : undefined;
      editor.lastSelection = next;
      editor.state.selection = {
        ...(previousSelectionConstructor
          ? { constructor: previousSelectionConstructor }
          : {}),
        from: next.from,
        to: next.to,
        anchor: next.from,
        head: next.to,
        $from: mockSelectionAnchor,
      };
      return true;
    }),
  };
  editor.chain = vi.fn(() => {
    const chain = {
      focus: vi.fn(() => chain),
      run: vi.fn(() => true),
      scrollIntoView: vi.fn(() => chain),
      setContent: vi.fn((content: string, options?: unknown) => {
        editor.commands.setContent(content, options);
        return chain;
      }),
      setTextSelection: vi.fn((selection: number | { from: number; to: number }) => {
        editor.commands.setTextSelection(selection);
        return chain;
      }),
    };
    return chain;
  });
  editor.storage = {
    markdown: {
      manager: {
        serialize: vi.fn((slice: any) => slice?.__markdownSlice ?? editor.markdown),
      },
    },
  };
  editor.getMarkdown = vi.fn(() => editor.markdown);

  return editor;
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
    newWindowMock.mockReset();
    newWindowMock.mockResolvedValue(undefined);
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
    loadOpenTabsMock.mockResolvedValue({ openTabs: [], activeTabPath: null });
    saveOpenTabsMock.mockReset();
    saveOpenTabsMock.mockResolvedValue(undefined);
    loadDraftBackupsMock.mockReset();
    loadDraftBackupsMock.mockResolvedValue([]);
    saveDraftBackupsMock.mockReset();
    saveDraftBackupsMock.mockResolvedValue(undefined);
    searchWorkspaceMock.mockReset();
    searchWorkspaceMock.mockResolvedValue({ files: [] });
    resolveMarkdownLinkMock.mockReset();
    resolveMarkdownLinkMock.mockResolvedValue({
      kind: 'unresolved',
      reason: 'test default',
    });
    openExternalUrlMock.mockReset();
    openExternalUrlMock.mockResolvedValue(undefined);
    openPathInDefaultAppMock.mockReset();
    openPathInDefaultAppMock.mockResolvedValue(undefined);
    readTextFilesMock.mockReset();
    readTextFilesMock.mockResolvedValue([]);
    readImagesBase64Mock.mockReset();
    readImagesBase64Mock.mockResolvedValue([]);
    exportPdfFileMock.mockReset();
    exportPdfFileMock.mockResolvedValue(undefined);
    exportPdfFilesMock.mockReset();
    exportPdfFilesMock.mockResolvedValue(undefined);
    exportTextFileMock.mockReset();
    exportTextFileMock.mockResolvedValue(undefined);
    exportTextFilesMock.mockReset();
    exportTextFilesMock.mockResolvedValue(undefined);
    openDialogMock.mockReset();
    saveDialogMock.mockReset();
    messageMock.mockReset();
    destroyWindowMock.mockReset();
    hideWindowMock.mockReset();
    startDraggingMock.mockReset();
    onCloseRequestedMock.mockReset();
    onDragDropEventMock.mockReset();
    listenMock.mockReset();
    hasActiveDocumentExternalChangesMock.mockReset();
    reloadActiveDocumentFromDiskMock.mockReset();
    invokeMock.mockReset();
    tiptapMockState.editor = null;
    tiptapMockState.lastOptions = null;
    closeRequestedHandler = undefined;
    dragDropHandler = undefined;
    menuCommandHandler = undefined;
    updateSnapshotHandler = undefined;
    window.localStorage.removeItem('markdowner.sidebarOpen');
    window.localStorage.removeItem('markdowner.sidebarWidth');
    window.localStorage.removeItem('markdowner.exportStyle.v1');
    window.history.replaceState(null, '', '/');
    onCloseRequestedMock.mockImplementation(async (handler) => {
      closeRequestedHandler = handler;
      return vi.fn();
    });
    onDragDropEventMock.mockImplementation(async (handler) => {
      dragDropHandler = handler;
      return vi.fn();
    });
    hasActiveDocumentExternalChangesMock.mockResolvedValue(false);
    activeDocumentDiskSourceMock.mockReset();
    activeDocumentDiskSourceMock.mockRejectedValue(new Error('No active document'));
    listenMock.mockImplementation(async (eventName, handler) => {
      if (eventName === 'markdowner://menu-command') {
        menuCommandHandler = handler;
      }
      if (eventName === 'markdowner://update-snapshot') {
        updateSnapshotHandler = handler;
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

  it('surfaces open failures without leaving an unhandled runtime error', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());
    openDialogMock.mockResolvedValue('/tmp/project/missing.md');
    openDocumentMock.mockRejectedValue(
      new Error("Could not read markdown file '/tmp/project/missing.md'"),
    );
    const runtimeErrors = captureRuntimeErrors();

    try {
      const { default: App } = await import('./App');

      render(<App />);

      const openFileButton = await screen.findByRole('button', { name: /^open file…$/i });
      fireEvent.click(openFileButton);

      expect(
        await screen.findByText(
          /could not read markdown file '\/tmp\/project\/missing\.md'/i,
          undefined,
          { timeout: 4000 },
        ),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByRole('status', { name: /working/i })).not.toBeInTheDocument();
      });
      await runtimeErrors.expectClean();
    } finally {
      runtimeErrors.restore();
    }
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
      within(toolbar).getByRole('button', { name: /^explorer \(cmd\+shift\+e\)$/i }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /^search \(cmd\+shift\+f\)$/i }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i }),
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

      fireEvent.keyDown(window, { key: 'p', metaKey: true });
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
      await screen.findByTestId('settings-panel');
      // Cmd+, toggles the settings tab closed.
      fireEvent.keyDown(window, { key: ',', metaKey: true });
      await waitFor(() => {
        expect(screen.queryByTestId('settings-panel')).toBeNull();
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
    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) => ({
      ...activeSnapshot,
      activeDocumentSource: source,
      activeDocumentDirty: true,
    }));
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
      await screen.findByTestId('settings-panel');
      fireEvent.keyDown(window, { key: ',', metaKey: true });
      await waitFor(() => {
        expect(screen.queryByTestId('settings-panel')).toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i }));
      const agendaHeading = await screen.findByRole('button', { name: /^agenda$/i });
      fireEvent.click(agendaHeading);

      fireEvent.keyDown(window, { key: 'p', metaKey: true });
      const quickOpenDialog = await screen.findByRole('dialog', { name: /quick open/i });
      fireEvent.change(
        within(quickOpenDialog).getByRole('textbox', {
          name: /quick open file search/i,
        }),
        { target: { value: 'api' } },
      );
      fireEvent.click(
        await within(quickOpenDialog).findByRole(
          'option',
          { name: /api\.md/i },
          { timeout: 4000 },
        ),
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
  }, 10000);

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

    const outlineButton = await screen.findByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i });
    expect(outlineButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(outlineButton);

    await waitFor(() => {
      expect(outlineButton).toHaveAttribute('aria-pressed', 'true');
    });

    expect(
      screen.getAllByText(/^outline$/i).some((node) =>
        node.classList.contains('explorer-section-header'),
      ),
    ).toBe(true);
    expect(screen.getByRole('button', { name: /^agenda$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decisions$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^follow-up$/i })).toBeInTheDocument();
  });

  it('renders Search and Outline panels with the Explorer sidebar density', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/README.md'],
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions'].join('\n'),
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i }));
    const searchPanel = await screen.findByTestId('sidebar-search-panel');
    expect(searchPanel.closest('aside')).toHaveClass('explorer-sidebar');
    expect(within(searchPanel).getByText(/^search$/i)).toHaveClass('explorer-section-header');
    expect(within(searchPanel).getByTestId('sidebar-search-input')).toHaveClass('h-7');

    fireEvent.click(screen.getByRole('button', { name: /outline \(cmd\+shift\+d\)/i }));
    const outline = await screen.findByRole('complementary', { name: /outline/i });
    expect(outline).toHaveClass('explorer-sidebar');
    expect(
      within(outline).getAllByText(/^outline$/i).some((node) =>
        node.classList.contains('explorer-section-header'),
      ),
    ).toBe(true);
    expect(within(outline).getByRole('button', { name: /^agenda$/i })).toHaveClass(
      'explorer-tree-row',
    );
  });

  it('renders a terse Outline empty state without marketing copy', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'plain-notes.md',
        activeDocumentPath: '/tmp/project/plain-notes.md',
        activeDocumentSource: 'No headings in this draft yet.',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i }));

    expect(await screen.findByText(/^no headings$/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/add markdown headings to see the document outline/i),
    ).not.toBeInTheDocument();
  });

  it('applies configured Outline density to outline rows', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          outlineFontSize: 11,
          outlineRowSpacing: 1,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions'].join('\n'),
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i }));

    const agenda = await screen.findByRole('button', { name: /^agenda$/i });
    const outlineList = screen.getByTestId('outline-list');

    await waitFor(() => {
      expect(agenda).toHaveStyle({ fontSize: '11px' });
      expect(outlineList).toHaveStyle({ gap: '1px' });
    });
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
    const outlineButton = screen.getByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i });

    fireEvent.click(outlineButton);
    fireEvent.click(await screen.findByRole('button', { name: /^decisions$/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveFocus();
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(13);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(13);
    });
  });

  it('moves focus to the matching heading when selecting an Outline item in WYSIWYG mode', async () => {
    const editor = createMockTiptapEditor('# Agenda\n\n## Decisions\nNotes', [
      { text: 'Agenda', from: 1 },
      { text: 'Decisions', from: 10 },
      { text: 'Notes', from: 21 },
    ]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions', 'Notes'].join('\n'),
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');

    fireEvent.click(await screen.findByRole('button', { name: /^outline \(cmd\+shift\+d\)$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^decisions$/i }));

    await waitFor(() => {
      expect(editor.commands.setTextSelection).toHaveBeenLastCalledWith({ from: 10, to: 10 });
      expect(editor.state.tr.scrollIntoView).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalledWith(editor.state.tr);
      expect(editor.view.focus).toHaveBeenCalled();
    });
  });

  it('focuses and navigates Outline rows with Cmd+0, arrows, and Enter', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions', 'Notes'].join('\n'),
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');

    fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true });
    const outline = await screen.findByRole('complementary', { name: /outline/i });
    const agenda = await within(outline).findByRole('button', { name: /^agenda$/i });
    const decisions = within(outline).getByRole('button', { name: /^decisions$/i });

    sourceEditor.focus();
    fireEvent.keyDown(window, { key: '0', metaKey: true });

    await waitFor(() => {
      expect(agenda).toHaveFocus();
    });

    fireEvent.keyDown(agenda, { key: 'ArrowDown' });
    expect(decisions).toHaveFocus();

    fireEvent.keyDown(decisions, { key: 'Enter' });

    await waitFor(() => {
      expect(sourceEditor).toHaveFocus();
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(13);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(13);
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
    // The source pane is now overflow-hidden so CodeMirror's inner
    // .cm-scroller owns the scroll surface (see FR-EDIT-001).
    expect(sourceSurface).toHaveClass('overflow-hidden');
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

  it('reloads a clean cached recent document from disk before showing it', async () => {
    const documentPath = '/tmp/project/meeting-notes.md';
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Cached version',
        mode: 'Editor',
      }),
    );
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Latest disk version',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /meeting-notes\.md/i,
      }),
    );

    await waitFor(() => {
      expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledWith({
        path: documentPath,
        expectedSource: '# Cached version',
        expectedDirty: false,
      });
      expect(screen.getByLabelText('Source editor')).toHaveValue('# Latest disk version');
    });
  });

  it('preserves a dirty cached recent document and reports the disk conflict', async () => {
    const documentPath = '/tmp/project/meeting-notes.md';
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Local draft',
        activeDocumentSyncedSource: '# Disk baseline',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);

    const { default: App } = await import('./App');
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /meeting-notes\.md/i,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Source editor')).toHaveValue('# Local draft');
      expect(reloadActiveDocumentFromDiskMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
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

  it('renders a VS Code-like Explorer sidebar with open editors and workspace sections', async () => {
    window.localStorage.setItem('markdowner.sidebarOpen', 'true');
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

    const explorer = await screen.findByRole('complementary', { name: /explorer/i });

    expect(within(explorer).getByText('EXPLORER')).toBeInTheDocument();
    expect(within(explorer).getByText('OPEN EDITORS')).toBeInTheDocument();
    expect(await within(explorer).findByText('PROJECT')).toBeInTheDocument();
    expect(within(explorer).getByTestId('explorer-open-editors')).toHaveTextContent('draft.md');
    expect(within(explorer).getByRole('button', { name: /new file/i })).toBeInTheDocument();
    expect(within(explorer).getByRole('button', { name: /open workspace/i })).toBeInTheDocument();
    expect(within(explorer).getByRole('button', { name: /collapse all/i })).toBeInTheDocument();
    const workspaceTree = within(explorer).getByTestId('explorer-workspace-tree');
    expect(within(workspaceTree).getByRole('button', { name: /guides/i })).toHaveClass('explorer-tree-row');
    expect(within(workspaceTree).getByRole('button', { name: /draft\.md/i })).toHaveClass('explorer-tree-row');

    window.localStorage.removeItem('markdowner.sidebarOpen');
  });

  it('moves Explorer row focus with arrows after Cmd+0 and opens the focused file with Cmd+Down', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
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
    openWorkspaceDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'api.md',
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/guides/draft.md',
          '/tmp/project/guides/reference/api.md',
        ],
        activeDocumentPath: '/tmp/project/guides/reference/api.md',
        activeDocumentSource: '# API',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /draft\.md/i });

    fireEvent.keyDown(window, { key: '0', metaKey: true });

    const explorer = await screen.findByRole('complementary', { name: /explorer/i });
    const guides = await within(explorer).findByRole('button', { name: /^guides$/i });

    await waitFor(() => {
      expect(guides).toHaveFocus();
    });

    fireEvent.keyDown(guides, { key: 'ArrowDown' });
    const draft = within(explorer).getByRole('button', { name: /draft\.md/i });
    await waitFor(() => {
      expect(draft).toHaveFocus();
    });

    fireEvent.keyDown(draft, { key: 'ArrowDown' });
    const reference = within(explorer).getByRole('button', { name: /^reference$/i });
    await waitFor(() => {
      expect(reference).toHaveFocus();
    });

    fireEvent.keyDown(reference, { key: 'ArrowDown' });
    const api = within(explorer).getByRole('button', { name: /api\.md/i });
    await waitFor(() => {
      expect(api).toHaveFocus();
    });

    fireEvent.keyDown(api, { key: 'ArrowDown', metaKey: true });

    await waitFor(() => {
      expect(openWorkspaceDocumentMock).toHaveBeenCalledWith(
        '/tmp/project/guides/reference/api.md',
      );
    });
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

    // Sidebar workspace/recent rows, Explorer open editors, and the tab strip.
    expect(await screen.findAllByText('draft.md')).toHaveLength(5);
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

    const dialog = await screen.findByTestId('settings-panel');
    const themeToggleGroup = within(dialog).getByTestId('settings-theme-toggle');
    const systemThemeToggle = within(themeToggleGroup).getByRole('radio', {
      name: /system/i,
    });
    // Wait for the mocked load_settings (themeFollowSystem: false) to settle
    // before clicking, otherwise the toggle group renders with "system" already
    // selected and clicking it is a no-op.
    await waitFor(() => {
      expect(systemThemeToggle).toHaveAttribute('data-state', 'off');
    });
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

  it('syncs the effective code block theme to the active app theme when enabled', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          themeFollowSystem: false,
          codeBlockHighlight: true,
          codeBlockTheme: 'one-dark',
          codeBlockThemeSync: true,
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

    await waitFor(() => {
      expect(document.documentElement.dataset.cbTheme).toBe('one-light');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });
    const dialog = await screen.findByTestId('settings-panel');
    const themeToggleGroup = within(dialog).getByTestId('settings-theme-toggle');
    const darkThemeToggle = within(themeToggleGroup).getByRole('radio', {
      name: /dark/i,
    });

    fireEvent.click(darkThemeToggle);

    await waitFor(() => {
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInDark');
    });
    await waitFor(() => {
      expect(document.documentElement.dataset.cbTheme).toBe('one-dark');
    });
  });

  it('keeps the latest theme when an earlier theme persistence resolves later', async () => {
    const pendingThemeResolutions = new Map<
      AppSnapshot['theme']['kind'],
      (snapshot: AppSnapshot) => void
    >();
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
    setThemeMock.mockImplementation(
      (kind: AppSnapshot['theme']['kind']) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingThemeResolutions.set(kind, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('BuiltInLight');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });
    const dialog = await screen.findByTestId('settings-panel');
    const themeToggleGroup = within(dialog).getByTestId('settings-theme-toggle');
    const systemThemeToggle = within(themeToggleGroup).getByRole('radio', {
      name: /system/i,
    });
    const lightThemeToggle = within(themeToggleGroup).getByRole('radio', {
      name: /light/i,
    });

    await waitFor(() => {
      expect(systemThemeToggle).toHaveAttribute('data-state', 'off');
    });
    fireEvent.click(systemThemeToggle);
    await waitFor(() => {
      expect(systemThemeToggle).toHaveAttribute('data-state', 'on');
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInDark');
    });

    fireEvent.click(lightThemeToggle);
    await waitFor(() => {
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInLight');
    });

    await act(async () => {
      pendingThemeResolutions.get('BuiltInLight')?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          theme: { kind: 'BuiltInLight', stylesheet: null, stylesheetPath: null },
        }),
      );
    });
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('BuiltInLight');
    });

    await act(async () => {
      pendingThemeResolutions.get('BuiltInDark')?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          theme: { kind: 'BuiltInDark', stylesheet: null, stylesheetPath: null },
        }),
      );
    });

    expect(document.documentElement.dataset.theme).toBe('BuiltInLight');
  });

  it('keeps a manual theme selection when an earlier OS theme sync resolves later', async () => {
    const originalMatchMedia = window.matchMedia;
    const osThemeListeners = new Set<(event: MediaQueryListEvent) => void>();
    let osThemeMatchesDark = true;
    const pendingThemeResolutions = new Map<
      AppSnapshot['theme']['kind'],
      (snapshot: AppSnapshot) => void
    >();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        ({
          media: query,
          matches: osThemeMatchesDark,
          onchange: null,
          addEventListener: (
            eventName: string,
            listener: (event: MediaQueryListEvent) => void,
          ) => {
            if (eventName === 'change') {
              osThemeListeners.add(listener);
            }
          },
          removeEventListener: (
            eventName: string,
            listener: (event: MediaQueryListEvent) => void,
          ) => {
            if (eventName === 'change') {
              osThemeListeners.delete(listener);
            }
          },
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    });

    try {
      invokeMock.mockImplementation(async (command: string) => {
        if (command === 'load_settings') {
          return {
            autoSave: false,
            editorFontSize: 14,
            editorFontFamily: '',
            editorLineWrap: true,
            themeFollowSystem: true,
          };
        }
        return undefined;
      });
      bootstrapMock.mockResolvedValue(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          theme: { kind: 'BuiltInDark', stylesheet: null, stylesheetPath: null },
        }),
      );
      setThemeMock.mockImplementation(
        (kind: AppSnapshot['theme']['kind']) =>
          new Promise<AppSnapshot>((resolve) => {
            pendingThemeResolutions.set(kind, resolve);
          }),
      );

      const { default: App } = await import('./App');

      render(<App />);

      await waitFor(() => {
        expect(document.documentElement.dataset.theme).toBe('BuiltInDark');
        expect(osThemeListeners.size).toBeGreaterThan(0);
      });

      fireEvent.keyDown(window, { key: ',', metaKey: true });
      const dialog = await screen.findByTestId('settings-panel');
      const themeToggleGroup = within(dialog).getByTestId('settings-theme-toggle');
      const systemThemeToggle = within(themeToggleGroup).getByRole('radio', {
        name: /system/i,
      });
      const darkThemeToggle = within(themeToggleGroup).getByRole('radio', {
        name: /dark/i,
      });

      await waitFor(() => {
        expect(systemThemeToggle).toHaveAttribute('data-state', 'on');
      });

      osThemeMatchesDark = false;
      act(() => {
        for (const listener of Array.from(osThemeListeners)) {
          listener({ matches: false } as MediaQueryListEvent);
        }
      });

      await waitFor(() => {
        expect(setThemeMock).toHaveBeenCalledWith('BuiltInLight');
      });

      fireEvent.click(darkThemeToggle);
      await waitFor(() => {
        expect(setThemeMock).toHaveBeenCalledWith('BuiltInDark');
      });

      await act(async () => {
        pendingThemeResolutions.get('BuiltInDark')?.(
          baseSnapshot({
            activeDocumentName: 'meeting-notes.md',
            activeDocumentPath: '/tmp/project/meeting-notes.md',
            activeDocumentSource: '# Meeting notes',
            theme: { kind: 'BuiltInDark', stylesheet: null, stylesheetPath: null },
          }),
        );
      });
      await waitFor(() => {
        expect(document.documentElement.dataset.theme).toBe('BuiltInDark');
      });

      await act(async () => {
        pendingThemeResolutions.get('BuiltInLight')?.(
          baseSnapshot({
            activeDocumentName: 'meeting-notes.md',
            activeDocumentPath: '/tmp/project/meeting-notes.md',
            activeDocumentSource: '# Meeting notes',
            theme: { kind: 'BuiltInLight', stylesheet: null, stylesheetPath: null },
          }),
        );
      });

      expect(document.documentElement.dataset.theme).toBe('BuiltInDark');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('keeps a manual theme selection when an earlier imported theme resolves later', async () => {
    let resolveImportTheme: ((snapshot: AppSnapshot) => void) | undefined;
    const pendingThemeResolutions = new Map<
      AppSnapshot['theme']['kind'],
      (snapshot: AppSnapshot) => void
    >();

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
    openDialogMock.mockResolvedValue('/tmp/project/theme.css');
    importThemeMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveImportTheme = resolve;
        }),
    );
    setThemeMock.mockImplementation(
      (kind: AppSnapshot['theme']['kind']) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingThemeResolutions.set(kind, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('BuiltInLight');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });
    const dialog = await screen.findByTestId('settings-panel');
    const themeToggleGroup = within(dialog).getByTestId('settings-theme-toggle');
    const darkThemeToggle = within(themeToggleGroup).getByRole('radio', {
      name: /dark/i,
    });

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^import css…$/i }));
    await waitFor(() => {
      expect(importThemeMock).toHaveBeenCalledWith('/tmp/project/theme.css');
    });

    fireEvent.click(darkThemeToggle);
    await waitFor(() => {
      expect(setThemeMock).toHaveBeenCalledWith('BuiltInDark');
    });

    await act(async () => {
      pendingThemeResolutions.get('BuiltInDark')?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          theme: { kind: 'BuiltInDark', stylesheet: null, stylesheetPath: null },
        }),
      );
    });
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('BuiltInDark');
    });

    await act(async () => {
      resolveImportTheme?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Meeting notes',
          theme: {
            kind: 'CustomCss',
            stylesheet: '.markdowner-content { color: tomato; }',
            stylesheetPath: '/tmp/project/theme.css',
          },
        }),
      );
    });

    expect(document.documentElement.dataset.theme).toBe('BuiltInDark');
  });

  it('persists the code block theme sync toggle from Settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          codeBlockHighlight: true,
          codeBlockTheme: 'one-dark',
          codeBlockThemeSync: false,
        };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });
    const dialog = await screen.findByTestId('settings-panel');
    const syncToggle = within(dialog).getByLabelText(/sync code block theme/i);
    await waitFor(() => {
      expect(syncToggle).toHaveAttribute('aria-checked', 'false');
    });

    fireEvent.click(syncToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ codeBlockThemeSync: true }),
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

  it('previews and styles the active document before exporting to a PDF path', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );
    saveDialogMock.mockResolvedValue('/tmp/project/exports/meeting-notes.pdf');

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^export to pdf…$/i }));

    expect(saveDialogMock).not.toHaveBeenCalled();
    expect(exportPdfFileMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Export Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Preset')).toHaveValue('app');
    expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');
    expect(screen.getByLabelText('Table border color')).toHaveValue('#3f3f46');
    const exportTab = screen.getByRole('tab', { name: /Export Preview/i });
    expect(exportTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByLabelText('Body size'), { target: { value: '13' } });

    fireEvent.click(screen.getByRole('tab', { name: /meeting-notes\.md/i }));
    await waitFor(() => {
      expect(exportTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByTestId('export-preview-surface').parentElement).toHaveClass('hidden');
    });
    fireEvent.click(exportTab);
    expect(await screen.findByLabelText('Body size')).toHaveValue('13');

    const exportButton = await screen.findByRole('button', { name: 'Export PDF' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(saveDialogMock).toHaveBeenCalledWith({
        defaultPath: '/tmp/project/meeting-notes.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      expect(exportPdfFileMock).toHaveBeenCalledWith(
        '/tmp/project/exports/meeting-notes.pdf',
        expect.stringContaining('font-size: 13px'),
        'A4',
        32,
      );
    });
    expect(exportPdfFileMock.mock.calls[0]?.[1]).toContain('Meeting notes');
    expect(exportPdfFileMock.mock.calls[0]?.[1]).toContain('border-color: #3f3f46');
    expect(exportPdfFileMock.mock.calls[0]?.[1]).toContain('background: #27272a');
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /Export Preview/i })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /meeting-notes\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    const reopenedMenu = await openAppMenu();
    fireEvent.click(within(reopenedMenu).getByRole('menuitem', { name: /^export to pdf…$/i }));
    expect(await screen.findByLabelText('Preset')).toHaveValue('custom');
    expect(await screen.findByLabelText('Body size')).toHaveValue('13');
    expect(screen.getByLabelText('Background color')).toHaveValue('#18181b');
  });

  it('keeps the Export Preview tab open when the native save dialog is cancelled', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );
    saveDialogMock.mockResolvedValue(null);

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^export to html…$/i }));
    const exportTab = await screen.findByRole('tab', { name: /Export Preview/i });
    fireEvent.click(await screen.findByRole('button', { name: 'Export HTML' }));

    await waitFor(() => expect(saveDialogMock).toHaveBeenCalled());
    expect(exportTextFileMock).not.toHaveBeenCalled();
    expect(exportTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Export Preview' })).toBeInTheDocument();
  });

  it('closes Export Preview with Cancel and restores the previous document tab', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^export to pdf…$/i }));
    expect(await screen.findByRole('tab', { name: /Export Preview/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /Export Preview/i })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /meeting-notes\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('opens Keyboard Shortcuts from the app menu item above Settings', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    const shortcutsItem = within(menu).getByRole('menuitem', {
      name: 'Show Keyboard Shortcuts',
    });
    const settingsItem = within(menu).getByRole('menuitem', { name: 'Settings' });
    expect(shortcutsItem.compareDocumentPosition(settingsItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(shortcutsItem);

    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
  });

  it('flushes the live WYSIWYG draft before exporting HTML so inserted images are embedded', async () => {
    const editor = createMockTiptapEditor('# Meeting notes', [{ text: '# Meeting notes', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
        mode: 'Wysiwyg',
      }),
    );
    saveDialogMock.mockResolvedValue('/tmp/project/exports/meeting-notes.html');
    readImagesBase64Mock.mockImplementation(async (sources: readonly string[]) =>
      sources.map((source) => ({ source, dataUri: `data:image/png;base64,EMBED(${source})` })),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /meeting-notes\.md/i });
    editor.markdown = '# Meeting notes\n\n![shot](./assets/shot.png)';

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^export to html…$/i }));

    expect(saveDialogMock).not.toHaveBeenCalled();
    expect(exportTextFileMock).not.toHaveBeenCalled();
    const exportButton = await screen.findByRole('button', { name: 'Export HTML' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(readImagesBase64Mock).toHaveBeenCalledWith(['/tmp/project/assets/shot.png']);
      expect(exportTextFileMock).toHaveBeenCalledWith(
        '/tmp/project/exports/meeting-notes.html',
        expect.stringContaining('src="data:image/png;base64,EMBED(/tmp/project/assets/shot.png)"'),
      );
    });
  });

  it('flushes the live WYSIWYG draft before exporting PDF so inserted images are embedded', async () => {
    const editor = createMockTiptapEditor('# Meeting notes', [{ text: '# Meeting notes', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        recentDocuments: ['/tmp/project/meeting-notes.md'],
        mode: 'Wysiwyg',
      }),
    );
    saveDialogMock.mockResolvedValue('/tmp/project/exports/meeting-notes.pdf');
    readImagesBase64Mock.mockImplementation(async (sources: readonly string[]) =>
      sources.map((source) => ({ source, dataUri: `data:image/png;base64,EMBED(${source})` })),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /meeting-notes\.md/i });
    editor.markdown = '# Meeting notes\n\n![shot](./assets/shot.png)';

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^export to pdf…$/i }));

    expect(saveDialogMock).not.toHaveBeenCalled();
    expect(exportPdfFileMock).not.toHaveBeenCalled();
    const exportButton = await screen.findByRole('button', { name: 'Export PDF' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(readImagesBase64Mock).toHaveBeenCalledWith(['/tmp/project/assets/shot.png']);
      expect(exportPdfFileMock).toHaveBeenCalledWith(
        '/tmp/project/exports/meeting-notes.pdf',
        expect.stringContaining('src="data:image/png;base64,EMBED(/tmp/project/assets/shot.png)"'),
        'A4',
        32,
      );
    });
  });

  it('exports every workspace markdown file to PDFs under the project exports folder', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/docs/guide.md',
          '/tmp/project/exports/old.md',
        ],
        activeDocumentName: 'README.md',
        activeDocumentPath: '/tmp/project/README.md',
        activeDocumentSource: '# Readme',
      }),
    );
    readTextFilesMock.mockResolvedValue([
      { path: '/tmp/project/README.md', contents: '# Readme' },
      { path: '/tmp/project/docs/guide.md', contents: '# Guide' },
    ]);

    const { default: App } = await import('./App');

    render(<App />);

    const menu = await openAppMenu();
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: /^export all markdown to pdfs…$/i }),
    );

    expect(exportPdfFilesMock).not.toHaveBeenCalled();
    const exportButton = await screen.findByRole('button', { name: 'Export 2 PDF files' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(readTextFilesMock).toHaveBeenCalledWith([
        '/tmp/project/README.md',
        '/tmp/project/docs/guide.md',
      ]);
      expect(exportPdfFilesMock).toHaveBeenCalledWith([
        {
          path: '/tmp/project/exports/README.pdf',
          html: expect.stringContaining('Readme'),
          paperSize: 'A4',
          pageMargin: 32,
        },
        {
          path: '/tmp/project/exports/docs/guide.pdf',
          html: expect.stringContaining('Guide'),
          paperSize: 'A4',
          pageMargin: 32,
        },
      ]);
    });
  });

  it('exports every workspace Markdown file to HTML under the project exports folder', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: [
          '/tmp/project/README.md',
          '/tmp/project/docs/guide.md',
          '/tmp/project/exports/old.md',
        ],
        activeDocumentName: 'README.md',
        activeDocumentPath: '/tmp/project/README.md',
        activeDocumentSource: '# Readme',
      }),
    );
    readTextFilesMock.mockResolvedValue([
      { path: '/tmp/project/README.md', contents: '# Readme' },
      { path: '/tmp/project/docs/guide.md', contents: '# Guide' },
    ]);

    const { default: App } = await import('./App');
    render(<App />);

    const menu = await openAppMenu();
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: /^export all markdown to html…$/i }),
    );

    expect(exportTextFilesMock).not.toHaveBeenCalled();
    const exportButton = await screen.findByRole('button', { name: 'Export 2 HTML files' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(exportTextFilesMock).toHaveBeenCalledWith([
        {
          path: '/tmp/project/exports/README.html',
          contents: expect.stringContaining('Readme'),
        },
        {
          path: '/tmp/project/exports/docs/guide.html',
          contents: expect.stringContaining('Guide'),
        },
      ]);
    });
  });

  it('keeps a switched tab active when an earlier Save As resolves later', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let resolveSaveAs: ((snapshot: AppSnapshot) => void) | undefined;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta',
          mode: 'Editor',
        }),
      );
    });
    saveDialogMock.mockResolvedValue('/tmp/project/alpha-copy.md');
    saveActiveDocumentAsMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveSaveAs = resolve;
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /alpha\.md/i });
    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
    });

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^save as…$/i }));

    await waitFor(() => {
      expect(saveActiveDocumentAsMock).toHaveBeenCalledWith('/tmp/project/alpha-copy.md');
      expect(resolveSaveAs).toBeTypeOf('function');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await act(async () => {
      resolveSaveAs?.(
        baseSnapshot({
          activeDocumentName: 'alpha-copy.md',
          activeDocumentPath: '/tmp/project/alpha-copy.md',
          activeDocumentSource: '# Alpha saved',
          mode: 'Editor',
        }),
      );
    });

    expect(sourceEditor).toHaveValue('# Beta');
    expect(screen.queryByText('alpha-copy.md')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps a switched tab active when an earlier Save resolves later', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let resolveSave: ((snapshot: AppSnapshot) => void) | undefined;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta',
          mode: 'Editor',
        }),
      );
    });
    saveActiveDocumentMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /alpha\.md/i });
    const sourceEditor = await screen.findByLabelText('Source editor');
    const statusBar = document.querySelector('footer') as HTMLElement;
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
      expect(within(statusBar).getAllByTitle(alphaPath).length).toBeGreaterThan(0);
    });

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^save$/i }));

    await waitFor(() => {
      expect(saveActiveDocumentMock).toHaveBeenCalled();
      expect(resolveSave).toBeTypeOf('function');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
      expect(within(statusBar).getAllByTitle(betaPath).length).toBeGreaterThan(0);
      expect(within(statusBar).queryByTitle(alphaPath)).not.toBeInTheDocument();
    });

    await act(async () => {
      resolveSave?.(
        baseSnapshot({
          activeDocumentName: 'alpha.md',
          activeDocumentPath: alphaPath,
          activeDocumentSource: '# Alpha saved',
          mode: 'Editor',
        }),
      );
    });

    expect(sourceEditor).toHaveValue('# Beta');
    expect(within(statusBar).getAllByTitle(betaPath).length).toBeGreaterThan(0);
    expect(within(statusBar).queryByTitle(alphaPath)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('does not show a stale external-change warning after switching tabs during Save', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let resolveExternalCheck: ((changed: boolean) => void) | undefined;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta',
          mode: 'Editor',
        }),
      );
    });
    hasActiveDocumentExternalChangesMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveExternalCheck = resolve;
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /alpha\.md/i });
    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
    });

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^save$/i }));

    await waitFor(() => {
      expect(hasActiveDocumentExternalChangesMock).toHaveBeenCalled();
      expect(resolveExternalCheck).toBeTypeOf('function');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await act(async () => {
      resolveExternalCheck?.(true);
    });

    expect(sourceEditor).toHaveValue('# Beta');
    expect(
      screen.queryByText(/Could not save 'alpha\.md' because it changed on disk\./i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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

    expect(editorToggle).toHaveAttribute('aria-keyshortcuts', 'Alt+Digit2');
    expect(wysiwygToggle).toHaveAttribute('aria-keyshortcuts', 'Alt+Digit1');
    expect(splitToggle).toHaveAttribute('aria-keyshortcuts', 'Alt+Digit3');
  });

  it('exposes aria-keyshortcuts on the ActivityBar Explorer/Search/Settings buttons', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    const view = render(<App />);

    const explorerButton = await waitFor(() =>
      within(view.container).getByRole('button', { name: /^explorer \(cmd\+shift\+e\)$/i }),
    );
    const searchButton = within(view.container).getByRole('button', {
      name: /^search \(cmd\+shift\+f\)$/i,
    });
    const settingsButton = within(view.container).getByRole('button', {
      name: /^settings \(cmd\+,\)$/i,
    });

    expect(explorerButton).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+E Control+Shift+E');
    expect(searchButton).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+F Control+Shift+F');
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

    await screen.findByText(/Start your next document/);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });

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

  it('opens a fresh window from Cmd+Shift+N without creating a tab in the current window', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/Start your next document/);
    fireEvent.keyDown(window, { key: 'N', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(newWindowMock).toHaveBeenCalled();
    });
    expect(newDocumentMock).not.toHaveBeenCalled();
  });

  it('opens a fresh window from the native new-window menu command', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'new-window' });

    await waitFor(() => {
      expect(newWindowMock).toHaveBeenCalled();
    });
    expect(newDocumentMock).not.toHaveBeenCalled();
  });

  it('starts a fresh window URL with an untitled tab instead of restoring previous tabs', async () => {
    window.history.replaceState(null, '', '/?markdownerNewWindow=1');
    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: ['/tmp/project/meeting-notes.md'],
      activeTabPath: '/tmp/project/meeting-notes.md',
      cursorPositions: {},
    });
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

    await screen.findAllByText(/^Untitled\.md/);
    expect(newDocumentMock).toHaveBeenCalled();
    expect(openDocumentMock).not.toHaveBeenCalledWith('/tmp/project/meeting-notes.md');
  });

  it('stacks a new Untitled tab on every Cmd+N instead of reusing one', async () => {
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

    await screen.findByRole('tab', { name: /meeting-notes\.md/i });

    fireEvent.keyDown(window, { key: 'n', metaKey: true });

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: /untitled\.md/i })).toHaveLength(1);
    });

    fireEvent.keyDown(window, { key: 'n', metaKey: true });

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: /untitled\.md/i })).toHaveLength(2);
    });
    expect(newDocumentMock).toHaveBeenCalledTimes(2);

    // The freshly created (second) untitled tab becomes the active one.
    const untitledTabs = screen.getAllByRole('tab', { name: /untitled\.md/i });
    expect(untitledTabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes the only tab on Cmd+W without prompting when the active tab has no local edits', async () => {
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

    await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(screen.queryByRole('tablist', { name: /open documents/i })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^new file$/i })).toBeInTheDocument();
    expect(destroyWindowMock).not.toHaveBeenCalled();
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
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
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
      expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledTimes(1);
      expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledWith({
        path: '/tmp/project/meeting-notes.md',
        expectedSource: '# Meeting notes',
        expectedDirty: false,
      });
      expect(openDocumentMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Source editor')).toHaveValue(
        '# Meeting notes\n\nUpdated from disk',
      );
      expect(
        screen.queryByText(
          /Could not save 'meeting-notes\.md' because it changed on disk\./i,
        ),
      ).not.toBeInTheDocument();
    });

    hasActiveDocumentExternalChangesMock.mockResolvedValue(false);
    saveActiveDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes\n\nUpdated from disk\n\nLocal follow-up',
      }),
    );
    fireEvent.change(screen.getByLabelText('Source editor'), {
      target: { value: '# Meeting notes\n\nUpdated from disk\n\nLocal follow-up' },
    });
    const secondMenu = await openAppMenu();
    fireEvent.click(within(secondMenu).getByRole('menuitem', { name: /^save$/i }));

    await waitFor(() => {
      expect(saveActiveDocumentMock).toHaveBeenCalledTimes(1);
    });
  });

  it('reloads a clean active document after the app regains focus and disk content changed', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Previous version',
      }),
    );
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Latest version',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Previous version');
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledTimes(1);
      expect(sourceEditor).toHaveValue('# Latest version');
      expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument();
    });
  });

  it('polls a clean document for disk changes while the window stays focused', async () => {
    const intervalCallbacks: Array<{ handler: TimerHandler; timeout: number | undefined }> = [];
    const setIntervalSpy = vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout) => {
      intervalCallbacks.push({ handler, timeout: Number(timeout) });
      return 1 as unknown as number;
    });
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Previous version',
      }),
    );
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Latest version',
      }),
    );

    try {
      const { default: App } = await import('./App');
      render(<App />);

      const sourceEditor = await screen.findByLabelText('Source editor');
      await waitFor(() => {
        expect(intervalCallbacks.some(({ timeout }) => timeout === 1000)).toBe(true);
      });
      const refresh = intervalCallbacks.find(({ timeout }) => timeout === 1000)?.handler;
      expect(typeof refresh).toBe('function');

      await act(async () => {
        if (typeof refresh === 'function') {
          refresh();
        }
      });

      await waitFor(() => {
        expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledTimes(1);
        expect(sourceEditor).toHaveValue('# Latest version');
      });
    } finally {
      hasFocusSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
  });

  it('keeps local edits and shows a conflict instead of auto-reloading after focus', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Previous version',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.change(sourceEditor, { target: { value: '# Local edits' } });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Local edits');
      expect(reloadActiveDocumentFromDiskMock).not.toHaveBeenCalled();
      expect(screen.getByText(/changed on disk/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
    });
  });

  it('does not auto-reload while a WYSIWYG edit is waiting for its draft flush', async () => {
    const editor = createMockTiptapEditor('# Previous version', [
      { text: '# Previous version', from: 1 },
    ]);
    tiptapMockState.editor = editor;
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Previous version',
        mode: 'Wysiwyg',
      }),
    );
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Latest disk version',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');
    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    editor.getMarkdown.mockReturnValue('# Local edit waiting to flush');
    act(() => {
      tiptapMockState.lastOptions.onUpdate({ editor });
    });
    hasActiveDocumentExternalChangesMock.mockClear();
    reloadActiveDocumentFromDiskMock.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(hasActiveDocumentExternalChangesMock).not.toHaveBeenCalled();
    expect(reloadActiveDocumentFromDiskMock).not.toHaveBeenCalled();
  });

  it('reloads a clean inactive tab from disk before showing it', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha cached' : '# Beta cached',
          mode: 'Editor',
        }),
      );
    });
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'beta.md',
        activeDocumentPath: betaPath,
        activeDocumentSource: '# Beta latest on disk',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha cached');
      expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledTimes(1);
      expect(sourceEditor).toHaveValue('# Beta latest on disk');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('keeps a dirty inactive tab local and reports the disk conflict when switching back', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let backendActivePath = alphaPath;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      backendActivePath = path;
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha cached' : '# Beta cached',
          mode: 'Editor',
        }),
      );
    });
    reloadActiveDocumentFromDiskMock.mockImplementation(() => {
      const isAlpha = backendActivePath === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: backendActivePath,
          activeDocumentSource: isAlpha ? '# Alpha latest' : '# Beta latest',
          mode: 'Editor',
        }),
      );
    });

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.click(await screen.findByRole('tab', { name: /beta\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta latest');
    });

    fireEvent.change(sourceEditor, { target: { value: '# Beta local edits' } });
    fireEvent.click(screen.getByRole('tab', { name: /alpha\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha latest');
    });

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    reloadActiveDocumentFromDiskMock.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta local edits');
      expect(reloadActiveDocumentFromDiskMock).not.toHaveBeenCalled();
      expect(screen.getByText(/changed on disk/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
    });
  });

  it('does not mistake the backend cache for a clean tab after switching back', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    const diskSources: Record<string, string> = {
      [alphaPath]: '# Alpha disk',
      [betaPath]: '# Beta disk',
    };
    const backendSources: Record<string, string> = { ...diskSources };
    const backendDirty: Record<string, boolean> = {
      [alphaPath]: false,
      [betaPath]: false,
    };
    let backendActivePath = alphaPath;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      backendActivePath = path;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: path === alphaPath ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: backendSources[path],
          activeDocumentDirty: backendDirty[path],
          mode: 'Editor',
        }),
      );
    });
    reloadActiveDocumentFromDiskMock.mockImplementation(
      ({ path }: { path: string }) => {
        backendActivePath = path;
        backendSources[path] = diskSources[path];
        backendDirty[path] = false;
        return Promise.resolve(
          baseSnapshot({
            activeDocumentName: path === alphaPath ? 'alpha.md' : 'beta.md',
            activeDocumentPath: path,
            activeDocumentSource: diskSources[path],
            activeDocumentDirty: false,
            mode: 'Editor',
          }),
        );
      },
    );
    replaceActiveDocumentSourceMock.mockImplementation((source: string) => {
      backendSources[backendActivePath] = source;
      backendDirty[backendActivePath] = true;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: backendActivePath === alphaPath ? 'alpha.md' : 'beta.md',
          activeDocumentPath: backendActivePath,
          activeDocumentSource: source,
          activeDocumentDirty: true,
          mode: 'Editor',
        }),
      );
    });

    const { default: App } = await import('./App');
    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.click(await screen.findByRole('tab', { name: /beta\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta disk');
    });

    fireEvent.change(sourceEditor, { target: { value: '# Beta local edits' } });
    await waitFor(() => {
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith('# Beta local edits');
    });

    fireEvent.click(screen.getByRole('tab', { name: /alpha\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha disk');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta local edits');
    });

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    reloadActiveDocumentFromDiskMock.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta local edits');
      expect(reloadActiveDocumentFromDiskMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
    });
  });

  it('preserves a dirty switched tab when external-change verification fails', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let backendActivePath = alphaPath;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      backendActivePath = path;
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta cached',
          mode: 'Editor',
        }),
      );
    });
    reloadActiveDocumentFromDiskMock.mockImplementation(
      ({ path }: { path: string }) =>
        Promise.resolve(
          baseSnapshot({
            activeDocumentName: path === alphaPath ? 'alpha.md' : 'beta.md',
            activeDocumentPath: path,
            activeDocumentSource: path === alphaPath ? '# Alpha disk' : '# Beta disk',
            mode: 'Editor',
          }),
        ),
    );

    const { default: App } = await import('./App');
    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.click(await screen.findByRole('tab', { name: /beta\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta disk');
    });

    fireEvent.change(sourceEditor, { target: { value: '# Beta local edits' } });
    fireEvent.click(screen.getByRole('tab', { name: /alpha\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha disk');
    });

    hasActiveDocumentExternalChangesMock.mockRejectedValueOnce(new Error('permission denied'));
    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta local edits');
      expect(screen.getByText(/Could not verify external changes.*permission denied/i)).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('ignores a deferred focus refresh after the user switches tabs', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let resolveExternalCheck: ((changed: boolean) => void) | undefined;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) =>
      Promise.resolve(
        baseSnapshot({
          activeDocumentName: path === alphaPath ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: path === alphaPath ? '# Alpha cached' : '# Beta cached',
          mode: 'Editor',
        }),
      ),
    );
    reloadActiveDocumentFromDiskMock.mockImplementation(
      ({ path }: { path: string }) =>
        Promise.resolve(
          baseSnapshot({
            activeDocumentName: path === alphaPath ? 'alpha.md' : 'beta.md',
            activeDocumentPath: path,
            activeDocumentSource: path === alphaPath ? '# Alpha latest' : '# Beta latest',
            mode: 'Editor',
          }),
        ),
    );
    hasActiveDocumentExternalChangesMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveExternalCheck = resolve;
        }),
    );

    const { default: App } = await import('./App');
    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(resolveExternalCheck).toBeTypeOf('function');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta latest');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await act(async () => {
      resolveExternalCheck?.(true);
    });

    expect(sourceEditor).toHaveValue('# Beta latest');
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      reloadActiveDocumentFromDiskMock.mock.calls.some(
        ([request]) => request.path === alphaPath,
      ),
    ).toBe(false);
  });

  it('keeps an edit made while a focus reload is in flight', async () => {
    let resolveReload: ((snapshot: AppSnapshot) => void) | undefined;

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Previous version',
        mode: 'Editor',
      }),
    );
    reloadActiveDocumentFromDiskMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveReload = resolve;
        }),
    );

    const { default: App } = await import('./App');
    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(resolveReload).toBeTypeOf('function');
    });

    fireEvent.change(sourceEditor, { target: { value: '# Local edits' } });
    await act(async () => {
      resolveReload?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Latest disk version',
          mode: 'Editor',
        }),
      );
    });

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Local edits');
      expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith('# Local edits');
    });
  });

  it('keeps a WYSIWYG keystroke typed while a focus reload is in flight', async () => {
    const editor = createMockTiptapEditor('# Previous version', [
      { text: '# Previous version', from: 1 },
    ]);
    tiptapMockState.editor = editor;
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Previous version',
        mode: 'Wysiwyg',
      }),
    );
    let resolveReload: ((snapshot: AppSnapshot) => void) | undefined;
    reloadActiveDocumentFromDiskMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveReload = resolve;
        }),
    );

    const { default: App } = await import('./App');
    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    editor.commands.setContent.mockClear();

    // Focus fires the refresh; the external change is detected and the reload
    // begins.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(resolveReload).toBeTypeOf('function');
    });

    // The user types in WYSIWYG DURING the reload await. onUpdate only schedules
    // a debounced flush, so localDraftRef is NOT updated yet — only the pending
    // flush timer marks the buffer dirty.
    editor.getMarkdown.mockReturnValue('# Previous version edited');
    act(() => {
      tiptapMockState.lastOptions.onUpdate({ editor });
    });

    // The reload resolves before the debounce fires.
    await act(async () => {
      resolveReload?.(
        baseSnapshot({
          activeDocumentName: 'meeting-notes.md',
          activeDocumentPath: '/tmp/project/meeting-notes.md',
          activeDocumentSource: '# Latest disk version',
          mode: 'Wysiwyg',
        }),
      );
    });

    // The in-flight keystroke must not be clobbered by disk content; a conflict
    // banner is shown instead.
    expect(editor.commands.setContent).not.toHaveBeenCalledWith(
      '# Latest disk version',
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
  });

  it('keeps a switched tab active when an earlier disk reload resolves later', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let deferAlphaReload = false;
    let resolveAlphaReload: ((snapshot: AppSnapshot) => void) | undefined;
    let backendActivePath = alphaPath;

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      backendActivePath = path;
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta',
          mode: 'Editor',
        }),
      );
    });
    reloadActiveDocumentFromDiskMock.mockImplementation(() => {
      if (backendActivePath === alphaPath && deferAlphaReload) {
        return new Promise<AppSnapshot>((resolve) => {
          resolveAlphaReload = resolve;
        });
      }
      const isAlpha = backendActivePath === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: backendActivePath,
          activeDocumentSource: isAlpha ? '# Alpha reloaded' : '# Beta',
          mode: 'Editor',
        }),
      );
    });

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /alpha\.md/i });
    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
      expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^save$/i }));

    const reloadButton = await screen.findByRole('button', { name: /reload from disk/i });
    deferAlphaReload = true;
    fireEvent.click(reloadButton);

    await waitFor(() => {
      expect(resolveAlphaReload).toBeTypeOf('function');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await act(async () => {
      resolveAlphaReload?.(
        baseSnapshot({
          activeDocumentName: 'alpha.md',
          activeDocumentPath: alphaPath,
          activeDocumentSource: '# Alpha reloaded',
          mode: 'Editor',
        }),
      );
    });

    expect(sourceEditor).toHaveValue('# Beta');
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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

  it('continues blocking Save after Keep local until the conflict is resolved', async () => {
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

    const firstMenu = await openAppMenu();
    fireEvent.click(within(firstMenu).getByRole('menuitem', { name: /^save$/i }));

    fireEvent.click(await screen.findByRole('button', { name: /keep local/i }));
    expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument();

    const secondMenu = await openAppMenu();
    fireEvent.click(within(secondMenu).getByRole('menuitem', { name: /^save$/i }));

    await waitFor(() => {
      expect(saveActiveDocumentMock).not.toHaveBeenCalled();
      expect(screen.getByText(/changed on disk/i)).toBeInTheDocument();
    });
  });

  it('lets Save proceed after Keep local once the disk conflict is reverted', async () => {
    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    saveActiveDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const firstMenu = await openAppMenu();
    fireEvent.click(within(firstMenu).getByRole('menuitem', { name: /^save$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep local/i }));

    // The external process reverts its change: disk == buffer baseline again.
    // A sticky conflict flag would keep Save blocked forever; clearing it on
    // Keep local lets the next Save re-verify and go through.
    hasActiveDocumentExternalChangesMock.mockResolvedValue(false);

    const secondMenu = await openAppMenu();
    fireEvent.click(within(secondMenu).getByRole('menuitem', { name: /^save$/i }));

    await waitFor(() => {
      expect(saveActiveDocumentMock).toHaveBeenCalled();
    });
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

  it('does not show a stale disk comparison after switching tabs during Compare', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    let resolveDiskSource: ((source: string) => void) | undefined;

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    activeDocumentDiskSourceMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveDiskSource = resolve;
        }),
    );
    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha local' : '# Beta local',
          mode: 'Editor',
        }),
      );
    });

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha local');
    });

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^save$/i }));

    const compareButton = await screen.findByRole('button', { name: /compare/i });
    fireEvent.click(compareButton);

    await waitFor(() => {
      expect(activeDocumentDiskSourceMock).toHaveBeenCalled();
      expect(resolveDiskSource).toBeTypeOf('function');
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta local');
      expect(screen.queryByText(/External change detected/i)).not.toBeInTheDocument();
    });

    await act(async () => {
      resolveDiskSource?.('# Alpha from disk');
    });

    expect(sourceEditor).toHaveValue('# Beta local');
    expect(screen.queryByText('Disk vs local')).not.toBeInTheDocument();
    expect(screen.queryByText('# Alpha from disk')).not.toBeInTheDocument();
  });

  it('keeps the latest disk comparison when an earlier Compare resolves later', async () => {
    const pendingComparisons: Array<(source: string) => void> = [];

    hasActiveDocumentExternalChangesMock.mockResolvedValue(true);
    activeDocumentDiskSourceMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          pendingComparisons.push(resolve);
        }),
    );
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

    const menu = await openAppMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^save$/i }));

    const compareButton = await screen.findByRole('button', { name: /compare/i });
    fireEvent.click(compareButton);
    fireEvent.click(compareButton);

    await waitFor(() => {
      expect(activeDocumentDiskSourceMock).toHaveBeenCalledTimes(2);
      expect(pendingComparisons).toHaveLength(2);
    });

    await act(async () => {
      pendingComparisons[1]?.('# Latest disk version');
    });

    await waitFor(() => {
      expect(screen.getByText('Disk vs local')).toBeInTheDocument();
      expect(screen.getByText('# Latest disk version')).toBeInTheDocument();
    });

    await act(async () => {
      pendingComparisons[0]?.('# Older disk version');
    });

    expect(screen.getByText('# Latest disk version')).toBeInTheDocument();
    expect(screen.queryByText('# Older disk version')).not.toBeInTheDocument();
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

    fireEvent.keyDown(window, { key: 'n', metaKey: true });

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

    fireEvent.keyDown(window, { key: 'o', metaKey: true, shiftKey: true });

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

  it('clears the tab dirty indicator when localDraft only differs from tab.source by a trailing newline', async () => {
    // Reproduces the user-reported bug: after Cmd+S, the WYSIWYG TrailingNode
    // (or any path where the editor's serialized markdown drops the final \n)
    // leaves localDraft as "# Hello" while tab.source becomes "# Hello\n" on
    // disk. The close/quit prompt already normalizes both sides via
    // normalizeFinalNewline, so it correctly treats the doc as clean — but the
    // tab/sidebar dot indicator used to use raw strict equality, leaving the
    // dirty circle painted even though the file was successfully saved. The
    // fix routes both indicators through tabIsDirty so the comparison is
    // consistently normalized.
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        // Source as loaded from disk ends in a trailing newline.
        activeDocumentSource: '# Meeting notes\n',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');
    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });

    // Simulate the editor surfacing a value WITHOUT the trailing newline — the
    // WYSIWYG serialization shape that the save path's normalizeFinalNewline
    // would round-trip to "# Meeting notes\n" on disk.
    fireEvent.change(editor, { target: { value: '# Meeting notes' } });

    // The tab strip has one tab; if the indicator (•) were painted, the
    // accessible label "Unsaved changes" would be in the document. The fix
    // keeps the comparison normalized, so neither the tab strip nor the
    // sidebar's Open Editors list should announce the dirty state.
    expect(screen.queryByLabelText('Unsaved changes')).toBeNull();
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

  it('starts the Cmd+O file dialog in the most recent document directory', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        activeDocumentName: 'recent.md',
        activeDocumentPath: '/tmp/project/docs/recent.md',
        activeDocumentSource: '# Recent',
        recentDocuments: ['/tmp/project/docs/recent.md'],
      }),
    );
    openDialogMock.mockResolvedValue(null);

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /recent\.md/i });

    fireEvent.keyDown(window, { key: 'o', metaKey: true });

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        multiple: true,
        directory: false,
        defaultPath: '/tmp/project/docs',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      });
    });
  });

  it('starts the Cmd+Shift+O workspace dialog in the current workspace directory', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        activeDocumentName: 'recent.md',
        activeDocumentPath: '/tmp/project/docs/recent.md',
        activeDocumentSource: '# Recent',
        recentDocuments: ['/tmp/project/docs/recent.md'],
      }),
    );
    openDialogMock.mockResolvedValue(null);

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /recent\.md/i });

    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        multiple: false,
        directory: true,
        defaultPath: '/tmp/project',
      });
    });
  });

  it('keeps the latest workspace when an earlier open resolves later', async () => {
    const pendingWorkspaces = new Map<string, (snapshot: AppSnapshot) => void>();
    openDialogMock
      .mockResolvedValueOnce('/tmp/project-a')
      .mockResolvedValueOnce('/tmp/project-b');
    openWorkspaceMock.mockImplementation(
      (path: string) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingWorkspaces.set(path, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenCalledWith('/tmp/project-b');
    });

    await act(async () => {
      pendingWorkspaces.get('/tmp/project-b')?.(
        baseSnapshot({
          rootDir: '/tmp/project-b',
          workspaceDocuments: ['/tmp/project-b/README.md'],
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle('Workspace: project-b')).toBeInTheDocument();
    });

    await act(async () => {
      pendingWorkspaces.get('/tmp/project-a')?.(
        baseSnapshot({
          rootDir: '/tmp/project-a',
          workspaceDocuments: ['/tmp/project-a/README.md'],
        }),
      );
    });

    expect(screen.getByTitle('Workspace: project-b')).toBeInTheDocument();
    expect(screen.queryByTitle('Workspace: project-a')).not.toBeInTheDocument();
  });

  it('keeps the latest dropped document when an earlier drop resolves later', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    const pendingDrops = new Map<string, (snapshot: AppSnapshot) => void>();

    bootstrapMock.mockResolvedValue(baseSnapshot({ mode: 'Editor' }));
    openDroppedPathMock.mockImplementation(
      (path: string) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingDrops.set(path, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(dragDropHandler).toBeTypeOf('function');
    });

    const emitDrop = dragDropHandler as NonNullable<typeof dragDropHandler>;
    const alphaDrop = emitDrop({ payload: { type: 'drop', paths: [alphaPath] } });

    await waitFor(() => {
      expect(openDroppedPathMock).toHaveBeenCalledWith(alphaPath);
    });

    const betaDrop = emitDrop({ payload: { type: 'drop', paths: [betaPath] } });

    await waitFor(() => {
      expect(openDroppedPathMock).toHaveBeenCalledWith(betaPath);
    });

    await act(async () => {
      pendingDrops.get(betaPath)?.(
        baseSnapshot({
          activeDocumentName: 'beta.md',
          activeDocumentPath: betaPath,
          activeDocumentSource: '# Beta',
          mode: 'Editor',
        }),
      );
      await betaDrop;
    });

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await act(async () => {
      pendingDrops.get(alphaPath)?.(
        baseSnapshot({
          activeDocumentName: 'alpha.md',
          activeDocumentPath: alphaPath,
          activeDocumentSource: '# Alpha',
          mode: 'Editor',
        }),
      );
      await alphaDrop;
    });

    expect(sourceEditor).toHaveValue('# Beta');
    expect(screen.queryByRole('tab', { name: /alpha\.md/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps switched tab metadata when an older draft sync resolves later', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';
    const pendingSyncs: Array<(snapshot: AppSnapshot) => void> = [];

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta',
          mode: 'Editor',
        }),
      );
    });
    replaceActiveDocumentSourceMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          pendingSyncs.push(resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    const statusBar = document.querySelector('footer') as HTMLElement;
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
      expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(within(statusBar).getAllByTitle(alphaPath).length).toBeGreaterThan(0);
    });

    fireEvent.change(sourceEditor, { target: { value: '# Alpha edited' } });
    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(pendingSyncs).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));

    await waitFor(() => {
      expect(pendingSyncs).toHaveLength(2);
    });

    await act(async () => {
      pendingSyncs[1]?.(
        baseSnapshot({
          activeDocumentName: 'alpha.md',
          activeDocumentPath: alphaPath,
          activeDocumentSource: '# Alpha edited',
          mode: 'Editor',
        }),
      );
    });

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(within(statusBar).getAllByTitle(betaPath).length).toBeGreaterThan(0);
      expect(within(statusBar).queryByTitle(alphaPath)).not.toBeInTheDocument();
    });

    await act(async () => {
      pendingSyncs[0]?.(
        baseSnapshot({
          activeDocumentName: 'alpha.md',
          activeDocumentPath: alphaPath,
          activeDocumentSource: '# Alpha stale',
          mode: 'Editor',
        }),
      );
    });

    expect(sourceEditor).toHaveValue('# Beta');
    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(statusBar).getAllByTitle(betaPath).length).toBeGreaterThan(0);
    expect(within(statusBar).queryByTitle(alphaPath)).not.toBeInTheDocument();
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

  it('keeps the keyboard cursor at the WYSIWYG selection head when switching to Editor with Option+2', async () => {
    const editor = createMockTiptapEditor('# Alpha', [{ text: 'Alpha', from: 2 }]);
    editor.state.selection = {
      from: 2,
      to: 7,
      head: 7,
      $from: { parent: { type: { name: 'paragraph' } } },
    };
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Alpha',
        mode: 'Wysiwyg',
      }),
    );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Alpha',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /meeting-notes\.md/i });
    editor.state.selection = {
      from: 2,
      to: 7,
      head: 7,
      $from: { parent: { type: { name: 'paragraph' } } },
    };
    act(() => {
      tiptapMockState.lastOptions?.onSelectionUpdate?.({ editor });
    });

    fireEvent.keyDown(window, { key: '™', code: 'Digit2', altKey: true });

    const sourceEditor = await screen.findByRole('textbox', { name: /source editor/i });
    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Editor');
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(7);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(7);
    });
  });

  it('keeps the keyboard cursor at the source caret when switching to WYSIWYG with Option+1', async () => {
    const editor = createMockTiptapEditor('# Alpha', [{ text: '# Alpha', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Alpha',
        mode: 'Editor',
      }),
    );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Alpha',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByRole('textbox', { name: /source editor/i });
    (sourceEditor as HTMLTextAreaElement).setSelectionRange(7, 7);

    fireEvent.keyDown(window, { key: '¡', code: 'Digit1', altKey: true });

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Wysiwyg');
      expect(editor.commands.setTextSelection).toHaveBeenCalledWith(8);
    });
  });

  it('flips the optimistic mode before awaiting set_mode and skips replaceActiveDocumentSource on a clean draft', async () => {
    // FR-PERF-001 / FR-PERF-002 contract:
    //   1. Mode UI must update before set_mode resolves (optimistic-first).
    //   2. When the live draft already equals the snapshot source, the
    //      mode-switch hot path must NOT call replaceActiveDocumentSource —
    //      that round-trip is reserved for dirty drafts only.
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Wysiwyg',
      }),
    );
    let resolveMode: ((snapshot: AppSnapshot) => void) | undefined;
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

    // Optimistic flip is visible while set_mode is still pending.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /source editor/i })).toBeInTheDocument();
    });
    expect(setModeMock).toHaveResolvedTimes(0);

    // Clean draft → no replaceActiveDocumentSource on the mode-switch hot path.
    expect(replaceActiveDocumentSourceMock).not.toHaveBeenCalled();

    resolveMode?.(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    await waitFor(() => {
      expect(setModeMock).toHaveResolvedTimes(1);
    });
    expect(replaceActiveDocumentSourceMock).not.toHaveBeenCalled();
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

  it('switches modes even when dirty draft sync fails', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    replaceActiveDocumentSourceMock.mockRejectedValueOnce(new Error('draft sync failed'));
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

    const sourceEditor = await screen.findByLabelText('Source editor');
    fireEvent.change(sourceEditor, { target: { value: '# Edited notes' } });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('SplitView');
    });
    expect(await screen.findByTestId('editor-surface-preview')).toBeInTheDocument();
    expect(screen.getByLabelText('Source editor')).toHaveValue('# Edited notes');
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

  it('opens in-document Find with Cmd+F and selects the first source match', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Alpha\n\nBeta alpha\nAlpha',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { key: 'f', metaKey: true });

    const search = await screen.findByRole('search', { name: /find and replace/i });
    const findInput = within(search).getByRole('textbox', { name: /find text/i });

    fireEvent.change(findInput, { target: { value: 'alpha' } });
    expect(within(search).getByText(/press enter to search/i)).toBeInTheDocument();
    fireEvent.keyDown(findInput, { key: 'Enter' });

    await waitFor(() => {
      expect(within(search).getByText('1 of 3')).toBeInTheDocument();
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(2);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(7);
    });

    fireEvent.click(within(search).getByRole('button', { name: /next match/i }));

    await waitFor(() => {
      expect(within(search).getByText('2 of 3')).toBeInTheDocument();
      expect((sourceEditor as HTMLTextAreaElement).selectionStart).toBe(14);
      expect((sourceEditor as HTMLTextAreaElement).selectionEnd).toBe(19);
    });
  });

  it('replaces all regex source matches from the replace bar', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'tasks.md',
        activeDocumentPath: '/tmp/project/tasks.md',
        activeDocumentSource: 'todo 123\ntodo 456\nTODO 789',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { key: 'f', metaKey: true, altKey: true });

    const search = await screen.findByRole('search', { name: /find and replace/i });
    const findInput = within(search).getByRole('textbox', { name: /find text/i });
    const replaceInput = within(search).getByRole('textbox', { name: /replace text/i });

    fireEvent.click(within(search).getByRole('button', { name: /use regular expression/i }));
    fireEvent.change(findInput, { target: { value: 'todo (\\d+)' } });
    fireEvent.keyDown(findInput, { key: 'Enter' });
    fireEvent.change(replaceInput, { target: { value: 'done $1' } });

    await waitFor(() => {
      expect(within(search).getByText('1 of 3')).toBeInTheDocument();
    });

    fireEvent.click(within(search).getByRole('button', { name: /^replace all$/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('done 123\ndone 456\ndone 789');
      expect(within(search).getByText('No matches')).toBeInTheDocument();
    });
  });

  it('selects WYSIWYG find matches through Tiptap text positions', async () => {
    const editor = createMockTiptapEditor('# Alpha\n\nBeta alpha\nAlpha', [
      { text: 'Alpha', from: 1 },
      { text: 'Beta alpha', from: 8 },
      { text: 'Alpha', from: 20 },
    ]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Alpha\n\nAlpha',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /notes\.md/i });

    fireEvent.keyDown(window, { key: 'f', metaKey: true });

    const search = await screen.findByRole('search', { name: /find and replace/i });
    const findInput = within(search).getByRole('textbox', { name: /find text/i });

    fireEvent.change(findInput, { target: { value: 'alpha' } });
    fireEvent.keyDown(findInput, { key: 'Enter' });

    await waitFor(() => {
      expect(within(search).getByText('1 of 3')).toBeInTheDocument();
      expect(editor.commands.setTextSelection).toHaveBeenLastCalledWith({ from: 1, to: 6 });
    });

    fireEvent.click(within(search).getByRole('button', { name: /next match/i }));

    await waitFor(() => {
      expect(within(search).getByText('2 of 3')).toBeInTheDocument();
      expect(editor.commands.setTextSelection).toHaveBeenLastCalledWith({ from: 13, to: 18 });
    });
  });

  it('does not push editor-authored WYSIWYG updates back into Tiptap during IME composition', async () => {
    const editor = createMockTiptapEditor('# 안녕하세요', [{ text: '안녕하세요', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'korean.md',
        activeDocumentPath: '/tmp/project/korean.md',
        activeDocumentSource: '# 안녕하세요',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    await waitFor(() => {
      expect(editor.commands.setContent).toHaveBeenCalledWith('# 안녕하세요', {
        contentType: 'markdown',
        emitUpdate: false,
      });
    });

    editor.commands.setContent.mockClear();
    editor.getMarkdown
      .mockReturnValueOnce('# 안')
      .mockReturnValue('# 안\n안녕하세요!');

    act(() => {
      tiptapMockState.lastOptions.onUpdate({ editor });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('defers WYSIWYG CJK draft sync until IME composition ends', async () => {
    const editor = createMockTiptapEditor('# ', [{ text: '', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'korean.md',
        activeDocumentPath: '/tmp/project/korean.md',
        activeDocumentSource: '# ',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    await waitFor(() => {
      expect(editor.commands.setContent).toHaveBeenCalledWith('# ', {
        contentType: 'markdown',
        emitUpdate: false,
      });
    });
    replaceActiveDocumentSourceMock.mockClear();

    editor.view.composing = true;
    editor.getMarkdown.mockReturnValue('# ㅇ');

    act(() => {
      tiptapMockState.lastOptions.onUpdate({ editor });
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 240));
    });

    expect(replaceActiveDocumentSourceMock).not.toHaveBeenCalled();

    editor.view.composing = false;
    editor.getMarkdown.mockReturnValue('# 안녕하세요');

    act(() => {
      const handler = tiptapMockState.lastOptions.editorProps.handleDOMEvents.compositionend;
      expect(handler(editor.view, new Event('compositionend'))).toBe(false);
    });

    await waitFor(() => {
      expect(replaceActiveDocumentSourceMock).toHaveBeenCalledWith('# 안녕하세요');
    });
    expect(replaceActiveDocumentSourceMock).not.toHaveBeenCalledWith('# ㅇ');
  });

  it('does not setContent when a fresh composition kicks off right after compositionend', async () => {
    // Regression test for a CJK IME race where compositionend publishes the
    // committed markdown via setLocalDraft, then a brand-new compositionstart
    // for the next syllable fires onUpdate with an intermediate-jamo markdown.
    // If onUpdate updated lastEditorMarkdownRef during composition, the
    // queued setLocalDraft would later mismatch and trigger setContent,
    // tearing down the in-flight IME and splitting the next character onto
    // its own line in headings / lists.
    const editor = createMockTiptapEditor('# ', [{ text: '', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'korean.md',
        activeDocumentPath: '/tmp/project/korean.md',
        activeDocumentSource: '# ',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    await waitFor(() => {
      expect(editor.commands.setContent).toHaveBeenCalledWith('# ', {
        contentType: 'markdown',
        emitUpdate: false,
      });
    });
    editor.commands.setContent.mockClear();

    // 1) compositionend for "안" — publishes committed markdown via flush.
    editor.view.composing = false;
    editor.getMarkdown.mockReturnValue('# 안');
    act(() => {
      const handler = tiptapMockState.lastOptions.editorProps.handleDOMEvents.compositionend;
      handler(editor.view, new Event('compositionend'));
    });

    // 2) Immediately after, the IME starts the next syllable. ProseMirror
    //    fires onUpdate with an intermediate decomposed-jamo markdown while
    //    view.composing flips back to true.
    editor.view.composing = true;
    editor.getMarkdown.mockReturnValue('# 안ㄴ');
    act(() => {
      tiptapMockState.lastOptions.onUpdate({ editor });
    });

    // 3) Let React flush the queued setLocalDraft and run its effects.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // setContent must NOT be called — doing so would tear down the IME and
    // produce the reported "line break after one Korean character" symptom.
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it('preserves WYSIWYG content when paste arrives while activeDocumentSource is still null', async () => {
    // Regression test for the "paste loses content" bug. When the user pastes
    // into a freshly opened WYSIWYG editor whose backing snapshot has not yet
    // mirrored the draft into activeDocumentSource (the typical state during
    // the 180ms debounce after onUpdate), the localDraft -> editor sync effect
    // must not call setContent with stale content.
    const editor = createMockTiptapEditor('Existing', [{ text: 'Existing', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'doc.md',
        activeDocumentPath: '/tmp/project/doc.md',
        activeDocumentSource: 'Existing',
        mode: 'Wysiwyg',
      }),
    );
    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) =>
      baseSnapshot({
        activeDocumentName: 'doc.md',
        activeDocumentPath: '/tmp/project/doc.md',
        activeDocumentSource: source,
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    await waitFor(() => {
      expect(editor.commands.setContent).toHaveBeenCalledWith('Existing', {
        contentType: 'markdown',
        emitUpdate: false,
      });
    });

    editor.commands.setContent.mockClear();

    // Simulate paste: ProseMirror inserts "PASTED" and fires onUpdate. The
    // mocked editor reports the new markdown via getMarkdown().
    editor.getMarkdown.mockReturnValue('Existing\n\nPASTED');

    act(() => {
      tiptapMockState.lastOptions.onUpdate({ editor });
    });

    // Wait past the 120ms WYSIWYG flush debounce + 180ms draft mirror sync.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    });

    // setContent must NOT have been called with the stale pre-paste content.
    const staleCalls = editor.commands.setContent.mock.calls.filter(
      ([content]: [string]) => content === 'Existing',
    );
    expect(staleCalls).toEqual([]);
  });

  it('wires a handlePaste editorProp on the WYSIWYG editor to force plain-text pasting', async () => {
    // Smoke test that the bug-fix wiring stays in place. Behavior is unit
    // tested in src/lib/wysiwygPaste.test.ts; this just confirms the prop is
    // attached so it can't silently fall off the editor configuration.
    const editor = createMockTiptapEditor('Existing', [{ text: 'Existing', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'doc.md',
        activeDocumentPath: '/tmp/project/doc.md',
        activeDocumentSource: 'Existing',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');

    expect(typeof tiptapMockState.lastOptions.editorProps.handlePaste).toBe(
      'function',
    );
  });

  it('opens a clicked WYSIWYG markdown link in the current tab', async () => {
    const editor = createMockTiptapEditor('[Next](./next.md)', [{ text: 'Next', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '[Next](./next.md)',
        mode: 'Wysiwyg',
      }),
    );
    resolveMarkdownLinkMock.mockResolvedValue({
      kind: 'markdown',
      absolutePath: '/tmp/project/next.md',
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'next.md',
        activeDocumentPath: '/tmp/project/next.md',
        activeDocumentSource: '# Next',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });
    const event = clickSurfaceLink(editor.view.dom, './next.md');

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(resolveMarkdownLinkMock).toHaveBeenCalledWith(
        './next.md',
        '/tmp/project/current.md',
      );
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/next.md');
    });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(screen.queryByRole('tab', { name: /current\.md/i })).not.toBeInTheDocument();
  });

  it('opens a Cmd-clicked WYSIWYG markdown link in a new tab', async () => {
    const editor = createMockTiptapEditor('[Next](./next.md)', [{ text: 'Next', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '[Next](./next.md)',
        mode: 'Wysiwyg',
      }),
    );
    resolveMarkdownLinkMock.mockResolvedValue({
      kind: 'markdown',
      absolutePath: '/tmp/project/next.md',
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'next.md',
        activeDocumentPath: '/tmp/project/next.md',
        activeDocumentSource: '# Next',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });
    clickSurfaceLink(editor.view.dom, './next.md', { metaKey: true });

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/next.md');
      expect(screen.getByRole('tab', { name: /current\.md/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('opens a WYSIWYG HTTP link in the default browser instead of a document tab', async () => {
    const editor = createMockTiptapEditor('[Web](https://example.com)', [
      { text: 'Web', from: 1 },
    ]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '[Web](https://example.com)',
        mode: 'Wysiwyg',
      }),
    );
    resolveMarkdownLinkMock.mockResolvedValue({
      kind: 'external',
      href: 'https://example.com',
    });

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });
    clickSurfaceLink(editor.view.dom, 'https://example.com');

    await waitFor(() => {
      expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com');
    });
    expect(openDocumentMock).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /current\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('follows a Split-view preview markdown link, Cmd-click opening a new tab', async () => {
    const editor = createMockTiptapEditor('[Next](./next.md)', [{ text: 'Next', from: 1 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '[Next](./next.md)',
        mode: 'SplitView',
      }),
    );
    resolveMarkdownLinkMock.mockResolvedValue({
      kind: 'markdown',
      absolutePath: '/tmp/project/next.md',
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'next.md',
        activeDocumentPath: '/tmp/project/next.md',
        activeDocumentSource: '# Next',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });
    const preview = await screen.findByTestId('editor-surface-preview');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', './next.md');
    preview.appendChild(anchor);

    fireEvent.click(anchor, { metaKey: true });

    await waitFor(() => {
      expect(resolveMarkdownLinkMock).toHaveBeenCalledWith(
        './next.md',
        '/tmp/project/current.md',
      );
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/next.md');
      expect(screen.getByRole('tab', { name: /current\.md/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('navigates Back (⌘[) and Forward (⌘]) through the document visit trail', async () => {
    const editor = createMockTiptapEditor('[Next](./next.md)', [{ text: 'Next', from: 1 }]);
    tiptapMockState.editor = editor;
    const currentSnapshot = baseSnapshot({
      activeDocumentName: 'current.md',
      activeDocumentPath: '/tmp/project/current.md',
      activeDocumentSource: '[Next](./next.md)',
      mode: 'Wysiwyg',
    });
    const nextSnapshot = baseSnapshot({
      activeDocumentName: 'next.md',
      activeDocumentPath: '/tmp/project/next.md',
      activeDocumentSource: '# Next',
      mode: 'Wysiwyg',
    });
    bootstrapMock.mockResolvedValue(currentSnapshot);
    resolveMarkdownLinkMock.mockResolvedValue({
      kind: 'markdown',
      absolutePath: '/tmp/project/next.md',
    });
    openDocumentMock.mockImplementation(async (path: string) =>
      path === '/tmp/project/next.md' ? nextSnapshot : currentSnapshot,
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });

    // Follow the link → next.md
    clickSurfaceLink(editor.view.dom, './next.md');
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    // ⌘[ → back to current.md
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/current.md');
      expect(screen.getByRole('tab', { name: /current\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    // ⌘] → forward to next.md
    fireEvent.keyDown(window, { key: ']', metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });

  it('swallows the WebKit Korean IME duplicate-syllable handleTextInput call', async () => {
    // Regression test for the bug where typing `# 안녕하세요` rendered as
    // `# 안안녕하세요`. WebKit's Korean IME fires an extra `handleTextInput`
    // call mid-composition: after `text="안" from=A to=A+1` (the legitimate
    // composition update that replaces the in-progress jamo with the final
    // form), it ALSO dispatches `text="안" from=A+1 to=A+1` — a pure
    // insertion of the same syllable at the cursor that ends up doubling
    // the first syllable in the editor. Our handleTextInput must recognise
    // this insertion-equal-to-preceding-text shape (during composition or
    // within 200 ms of compositionend) and return true to swallow it.
    const editor = createMockTiptapEditor('# 안', [{ text: '안', from: 3 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'korean.md',
        activeDocumentPath: '/tmp/project/korean.md',
        activeDocumentSource: '# 안',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    await waitFor(() => {
      expect(editor.commands.setContent).toHaveBeenCalled();
    });

    const handleTextInput =
      tiptapMockState.lastOptions.editorProps.handleTextInput as (
        view: unknown,
        from: number,
        to: number,
        text: string,
      ) => boolean;
    const compositionstart = tiptapMockState.lastOptions.editorProps.handleDOMEvents
      .compositionstart as (view: unknown, event: Event) => boolean;
    const compositionend = tiptapMockState.lastOptions.editorProps.handleDOMEvents
      .compositionend as (view: unknown, event: Event) => boolean;

    // Stub a doc shape just rich enough for the handler's textBetween call.
    // Position 3 sits right after the '안' character in '# 안'.
    const docStub = {
      textBetween: vi.fn((start: number, end: number) => {
        // Pretend the doc text from positions 2..3 is '안' (matching the
        // committed syllable that WebKit is about to duplicate).
        if (start === 2 && end === 3) return '안';
        return '';
      }),
    };
    const viewStub = { state: { doc: docStub }, dispatch: vi.fn() };

    // Open a composition so the guard's "is composing" precondition is met.
    act(() => {
      compositionstart(viewStub, new Event('compositionstart'));
    });

    // Simulate the legitimate composition-replace first (from !== to). The
    // handler must allow it through so the IME's in-progress update reaches
    // the editor.
    expect(handleTextInput(viewStub, 2, 3, '안')).toBe(false);

    // Now the duplicate insertion (from === to, text matches the character
    // immediately before the cursor) arrives mid-composition. It must be
    // swallowed (return true) — that is how the bug stops repeating.
    expect(handleTextInput(viewStub, 3, 3, '안')).toBe(true);

    // After compositionend, the same insert-equal-to-preceding-text shape
    // still gets swallowed inside the 200 ms grace window.
    act(() => {
      const evt = new Event('compositionend') as CompositionEvent & {
        data?: string;
      };
      (evt as any).data = '안';
      compositionend(viewStub, evt);
    });
    expect(handleTextInput(viewStub, 3, 3, '안')).toBe(true);
  });

  it('does not swallow insertions whose text does not match the preceding doc text', async () => {
    // Counter-test for the duplicate-syllable guard: legitimate user input —
    // including pure insertions during composition where the inserted text
    // does NOT match the character before the cursor — must still go through
    // so the IME can actually type new syllables.
    const editor = createMockTiptapEditor('# 안', [{ text: '안', from: 3 }]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'korean.md',
        activeDocumentPath: '/tmp/project/korean.md',
        activeDocumentSource: '# 안',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');
    await waitFor(() => {
      expect(editor.commands.setContent).toHaveBeenCalled();
    });

    const handleTextInput =
      tiptapMockState.lastOptions.editorProps.handleTextInput as (
        view: unknown,
        from: number,
        to: number,
        text: string,
      ) => boolean;
    const compositionstart = tiptapMockState.lastOptions.editorProps.handleDOMEvents
      .compositionstart as (view: unknown, event: Event) => boolean;

    const docStub = {
      textBetween: vi.fn((start: number, end: number) => {
        if (start === 2 && end === 3) return '안';
        return '';
      }),
    };
    const viewStub = { state: { doc: docStub }, dispatch: vi.fn() };

    act(() => {
      compositionstart(viewStub, new Event('compositionstart'));
    });

    // Inserting a different syllable than what precedes the cursor is the
    // legitimate next-syllable case (e.g. typing 녕 after 안). Must pass.
    expect(handleTextInput(viewStub, 3, 3, '녕')).toBe(false);
  });

  it('enables Tiptap TrailingNode so the caret can leave codeblock/blockquote-tailed docs', async () => {
    const editor = createMockTiptapEditor('', []);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');

    const starterKit = tiptapMockState.lastOptions.extensions.find(
      (extension: any) => extension?.name === 'starterKit',
    );
    // `trailingNode: false` would skip registering the extension, so we
    // verify the option is not explicitly disabled. Defaults (undefined)
    // keep the upstream "append empty paragraph after non-paragraph blocks"
    // behavior, which is exactly what we want for codeblock/blockquote
    // escape.
    expect(starterKit?.options?.trailingNode).not.toBe(false);
  });

  it('moves WYSIWYG PageDown two line-heights above the page target', async () => {
    const editor = createMockTiptapEditor('Line 1\nLine 2\nLine 3', [
      { text: 'Line 1', from: 1 },
      { text: 'Line 2', from: 8 },
      { text: 'Line 3', from: 15 },
    ]);
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'clientHeight', {
      configurable: true,
      value: 500,
    });
    const dom = document.createElement('div');
    dom.style.lineHeight = '20px';
    parent.appendChild(dom);
    const createSelection = vi.fn((_doc, anchor: number, head: number) => ({ anchor, head }));
    const transaction = {
      setSelection: vi.fn(() => transaction),
      scrollIntoView: vi.fn(() => transaction),
    };
    editor.view.dom = dom;
    editor.view.coordsAtPos = vi.fn(() => ({ top: 100, bottom: 120, left: 44, right: 64 }));
    editor.view.posAtCoords = vi.fn(({ top }: { left: number; top: number }) => ({
      pos: Math.round(top),
    }));
    editor.state = {
      doc: { content: { size: 1000 } },
      selection: {
        anchor: 25,
        head: 25,
        constructor: { create: createSelection },
      },
      tr: transaction,
    };
    editor.view.state = editor.state;
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'paging.md',
        activeDocumentPath: '/tmp/project/paging.md',
        activeDocumentSource: 'Line 1\nLine 2\nLine 3',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');

    const event = {
      key: 'PageDown',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const handled = tiptapMockState.lastOptions.editorProps.handleKeyDown(editor.view, event);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(editor.view.posAtCoords).toHaveBeenCalledWith({ left: 44, top: 510 });
    expect(createSelection).toHaveBeenCalledWith(editor.state.doc, 510, 510);
    expect(transaction.setSelection).toHaveBeenCalledWith({ anchor: 510, head: 510 });
    expect(editor.view.dispatch).toHaveBeenCalledWith(transaction);
  });

  it('moves WYSIWYG Home and End to the current visual line boundaries', async () => {
    const editor = createMockTiptapEditor('Alpha beta gamma', [
      { text: 'Alpha beta gamma', from: 1 },
    ]);
    const dom = document.createElement('div');
    dom.getBoundingClientRect = vi.fn(() => ({
      x: 10,
      y: 80,
      width: 300,
      height: 80,
      top: 80,
      right: 310,
      bottom: 160,
      left: 10,
      toJSON: () => ({}),
    }));
    const createSelection = vi.fn((_doc, anchor: number, head: number) => ({ anchor, head }));
    const transaction = {
      setSelection: vi.fn(() => transaction),
      scrollIntoView: vi.fn(() => transaction),
    };
    editor.view.dom = dom;
    editor.view.coordsAtPos = vi.fn(() => ({ top: 100, bottom: 120, left: 140, right: 150 }));
    editor.view.posAtCoords = vi.fn(({ left }: { left: number; top: number }) => ({
      pos: left < 100 ? 3 : 33,
    }));
    editor.state = {
      doc: { content: { size: 100 } },
      selection: {
        anchor: 18,
        head: 18,
        constructor: { create: createSelection },
      },
      tr: transaction,
    };
    editor.view.state = editor.state;
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'line.md',
        activeDocumentPath: '/tmp/project/line.md',
        activeDocumentSource: 'Alpha beta gamma',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByTestId('mock-tiptap-editor');

    const homeEvent = {
      key: 'Home',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    const endEvent = {
      key: 'End',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    expect(tiptapMockState.lastOptions.editorProps.handleKeyDown(editor.view, homeEvent)).toBe(
      true,
    );
    expect(editor.view.posAtCoords).toHaveBeenLastCalledWith({ left: 11, top: 110 });
    expect(createSelection).toHaveBeenLastCalledWith(editor.state.doc, 3, 3);

    expect(tiptapMockState.lastOptions.editorProps.handleKeyDown(editor.view, endEvent)).toBe(true);
    expect(editor.view.posAtCoords).toHaveBeenLastCalledWith({ left: 309, top: 110 });
    expect(createSelection).toHaveBeenLastCalledWith(editor.state.doc, 33, 33);
  });

  it('replaces all WYSIWYG RTL matches through a ProseMirror text transaction', async () => {
    const editor = createMockTiptapEditor('مرحبا beta مرحبا', [
      { text: 'مرحبا beta مرحبا', from: 1 },
    ]);
    tiptapMockState.editor = editor;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'rtl.md',
        activeDocumentPath: '/tmp/project/rtl.md',
        activeDocumentSource: 'مرحبا beta مرحبا',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /rtl\.md/i });

    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });

    const search = await screen.findByRole('search', { name: /find and replace/i });
    const findInput = within(search).getByRole('textbox', { name: /find text/i });
    const replaceInput = within(search).getByRole('textbox', { name: /replace text/i });

    fireEvent.change(findInput, { target: { value: 'مرحبا' } });
    fireEvent.keyDown(findInput, { key: 'Enter' });
    fireEvent.change(replaceInput, { target: { value: 'أهلا' } });

    await waitFor(() => {
      expect(within(search).getByText('1 of 2')).toBeInTheDocument();
    });

    fireEvent.click(within(search).getByRole('button', { name: /^replace all$/i }));

    await waitFor(() => {
      expect(editor.state.tr.insertText).toHaveBeenCalledWith('أهلا', 12, 17);
      expect(editor.state.tr.insertText).toHaveBeenCalledWith('أهلا', 1, 6);
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(screen.getByTestId('mock-tiptap-editor')).toHaveAttribute('data-selection-from', '1');
      expect(within(search).getByText('No matches')).toBeInTheDocument();
    });
  });

  it('defers source find search until Enter is pressed', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Alpha\n\nBeta alpha\nAlpha',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByRole('textbox', { name: /source editor/i });
    const sourceTextarea = sourceEditor as HTMLTextAreaElement;
    sourceTextarea.setSelectionRange(0, 0);
    const initialSelectionStart = sourceTextarea.selectionStart;

    fireEvent.keyDown(window, { key: 'f', metaKey: true });

    const search = await screen.findByRole('search', { name: /find and replace/i });
    const findInput = within(search).getByRole('textbox', { name: /find text/i });

    fireEvent.change(findInput, { target: { value: 'alpha' } });

    // Typing alone does not run the search: the prompt asks for Enter and the
    // editor selection has not moved to a match.
    expect(within(search).getByText(/press enter to search/i)).toBeInTheDocument();
    expect(within(search).queryByText(/of /i)).toBeNull();
    expect(sourceTextarea.selectionStart).toBe(initialSelectionStart);

    fireEvent.keyDown(findInput, { key: 'Enter' });

    await waitFor(() => {
      expect(within(search).getByText('1 of 3')).toBeInTheDocument();
      expect(sourceTextarea.selectionStart).toBe(2);
    });
  });

  it('does not open Find from an IME-composing command shortcut', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'ime.md',
        activeDocumentPath: '/tmp/project/ime.md',
        activeDocumentSource: 'IME composing text',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /ime\.md/i });

    fireEvent.keyDown(window, { key: 'f', metaKey: true, isComposing: true });

    expect(screen.queryByRole('search', { name: /find and replace/i })).not.toBeInTheDocument();
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

    expect(editorToggle).toHaveAttribute('title', 'Editor (Opt+2)');
    expect(wysiwygToggle).toHaveAttribute('title', 'WYSIWYG (Opt+1)');
    expect(splitToggle).toHaveAttribute('title', 'Split View (Opt+3)');

    const toggles = within(menu).getAllByRole('menuitemradio');
    expect(toggles[0]).toBe(wysiwygToggle);
    expect(toggles[1]).toBe(editorToggle);
    expect(toggles[2]).toBe(splitToggle);

    expect(splitToggle).toHaveAttribute('aria-checked', 'true');

    const statusBar = document.querySelector('footer');
    expect(statusBar).not.toBeNull();
    expect(within(statusBar as HTMLElement).getByText('Split View')).toBeInTheDocument();
  });

  it('restores the persisted sidebar width on startup and clamps it to 220-720px', async () => {
    window.localStorage.setItem('markdowner.sidebarOpen', 'true');
    window.localStorage.setItem('markdowner.sidebarWidth', '9999');

    try {
      const { default: App } = await import('./App');

      render(<App />);

      const separator = await screen.findByRole('separator', { name: /resize sidebar/i });
      expect(separator).toHaveAttribute('aria-valuemin', '220');
      expect(separator).toHaveAttribute('aria-valuemax', '720');
      expect(separator).toHaveAttribute('aria-valuenow', '720');
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
        expect(separator).toHaveAttribute('aria-valuenow', '720');
      });

      // Clamp at max — further increase is a no-op.
      fireEvent.keyDown(separator, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '720');
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

  it('filters Quick Open fuzzily across name and path with a space-separated query', async () => {
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

    fireEvent.change(input, { target: { value: 'api md' } });

    await waitFor(() => {
      expect(within(quickOpenDialog).queryAllByRole('option')).toHaveLength(1);
    });
    const match = within(quickOpenDialog).getByRole('option');
    expect(match).toHaveTextContent(/api\.md/);
    expect(match).toHaveTextContent(/guides\/reference\/api\.md/);
  });

  it('filters Quick Open fuzzily by character subsequence in the path', async () => {
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

  it('opens the Search sidebar panel when the Activity Bar Search button is clicked', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/README.md'],
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const searchButton = await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i });
    fireEvent.click(searchButton);

    await screen.findByTestId('sidebar-search-panel');
    expect(searchButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the latest clicked search result active when an earlier open resolves later', async () => {
    const pendingOpens = new Map<string, (snapshot: AppSnapshot) => void>();
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '# Current',
        mode: 'Editor',
      }),
    );
    searchWorkspaceMock.mockResolvedValue({
      files: [
        workspaceSearchFile('/tmp/project/alpha.md', 'Alpha', {
          start: 0,
          end: 1,
          absoluteOffset: 0,
        }),
        workspaceSearchFile('/tmp/project/beta.md', 'Beta'),
      ],
    });
    openWorkspaceDocumentMock.mockImplementation(
      (path: string) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingOpens.set(path, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i }));
    const searchPanel = await screen.findByTestId('sidebar-search-panel');
    fireEvent.change(within(searchPanel).getByTestId('sidebar-search-input'), {
      target: { value: 'heading' },
    });

    const matches = await within(searchPanel).findAllByTestId('sidebar-search-match');
    fireEvent.click(matches[0]);
    await waitFor(() => {
      expect(openWorkspaceDocumentMock).toHaveBeenCalledWith('/tmp/project/alpha.md');
    });

    fireEvent.click(matches[1]);
    await waitFor(() => {
      expect(openWorkspaceDocumentMock).toHaveBeenCalledWith('/tmp/project/beta.md');
    });

    await act(async () => {
      pendingOpens.get('/tmp/project/beta.md')?.(
        baseSnapshot({
          rootDir: '/tmp/project',
          workspaceDocuments: ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
          activeDocumentName: 'beta.md',
          activeDocumentPath: '/tmp/project/beta.md',
          activeDocumentSource: '# Beta',
          mode: 'Editor',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    await act(async () => {
      pendingOpens.get('/tmp/project/alpha.md')?.(
        baseSnapshot({
          rootDir: '/tmp/project',
          workspaceDocuments: ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
          activeDocumentName: 'alpha.md',
          activeDocumentPath: '/tmp/project/alpha.md',
          activeDocumentSource: '# Alpha',
          mode: 'Editor',
        }),
      );
    });

    expect(screen.getByRole('tab', { name: /beta\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps search results empty when a pending search resolves after clearing the query', async () => {
    let resolveSearch:
      | ((result: { files: ReturnType<typeof workspaceSearchFile>[] }) => void)
      | undefined;
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/alpha.md'],
      }),
    );
    searchWorkspaceMock.mockImplementation(
      () =>
        new Promise<{ files: ReturnType<typeof workspaceSearchFile>[] }>((resolve) => {
          resolveSearch = resolve;
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i }));
    const searchPanel = await screen.findByTestId('sidebar-search-panel');
    const searchInput = within(searchPanel).getByTestId('sidebar-search-input');

    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    await waitFor(() => {
      expect(searchWorkspaceMock).toHaveBeenCalledWith(
        'alpha',
        expect.any(Object),
        ['/tmp/project/alpha.md'],
      );
      expect(resolveSearch).toBeTypeOf('function');
    });

    fireEvent.change(searchInput, { target: { value: '' } });

    await waitFor(() => {
      expect(within(searchPanel).queryByText('Searching…')).not.toBeInTheDocument();
      expect(within(searchPanel).getByText(/type to search workspace/i)).toBeInTheDocument();
    });

    await act(async () => {
      resolveSearch?.({
        files: [workspaceSearchFile('/tmp/project/alpha.md', 'Alpha')],
      });
    });

    expect(within(searchPanel).queryByText(/1 result in 1 file/i)).not.toBeInTheDocument();
    expect(within(searchPanel).queryByText('alpha.md')).not.toBeInTheDocument();
    expect(within(searchPanel).getByText(/type to search workspace/i)).toBeInTheDocument();
  });

  it('keeps the shell busy while any overlapping document open is still pending', async () => {
    const pendingOpens = new Map<string, (snapshot: AppSnapshot) => void>();
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        workspaceDocuments: ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '# Current',
        mode: 'Editor',
      }),
    );
    searchWorkspaceMock.mockResolvedValue({
      files: [
        workspaceSearchFile('/tmp/project/alpha.md', 'Alpha'),
        workspaceSearchFile('/tmp/project/beta.md', 'Beta'),
      ],
    });
    openWorkspaceDocumentMock.mockImplementation(
      (path: string) =>
        new Promise<AppSnapshot>((resolve) => {
          pendingOpens.set(path, resolve);
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i }));
    const searchPanel = await screen.findByTestId('sidebar-search-panel');
    fireEvent.change(within(searchPanel).getByTestId('sidebar-search-input'), {
      target: { value: 'heading' },
    });

    const matches = await within(searchPanel).findAllByTestId('sidebar-search-match');
    fireEvent.click(matches[0]);
    await screen.findByRole('status', { name: /working/i });
    fireEvent.click(matches[1]);
    await waitFor(() => {
      expect(openWorkspaceDocumentMock).toHaveBeenCalledWith('/tmp/project/beta.md');
    });

    await act(async () => {
      pendingOpens.get('/tmp/project/alpha.md')?.(
        baseSnapshot({
          rootDir: '/tmp/project',
          workspaceDocuments: ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
          activeDocumentName: 'alpha.md',
          activeDocumentPath: '/tmp/project/alpha.md',
          activeDocumentSource: '# Alpha',
          mode: 'Editor',
        }),
      );
    });

    expect(screen.getByRole('status', { name: /working/i })).toBeInTheDocument();

    await act(async () => {
      pendingOpens.get('/tmp/project/beta.md')?.(
        baseSnapshot({
          rootDir: '/tmp/project',
          workspaceDocuments: ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
          activeDocumentName: 'beta.md',
          activeDocumentPath: '/tmp/project/beta.md',
          activeDocumentSource: '# Beta',
          mode: 'Editor',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /working/i })).not.toBeInTheDocument();
    });
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

  it('marks the Activity Bar Search button as pressed while the Search sidebar panel is open', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const searchButton = await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i });
    const settingsButton = await screen.findByRole('button', { name: /settings \(cmd\+,\)/i });

    expect(searchButton).toHaveAttribute('aria-pressed', 'false');
    expect(settingsButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(searchButton);
    await screen.findByTestId('sidebar-search-panel');

    expect(searchButton).toHaveAttribute('aria-pressed', 'true');
    expect(settingsButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles the sidebar with Cmd+Shift+B', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByText(/Start your next document/);

    fireEvent.keyDown(window, { key: 'B', metaKey: true, shiftKey: true });

    const explorer = await screen.findByRole('complementary', { name: /explorer/i });
    await waitFor(() => {
      expect(explorer).not.toHaveClass('invisible');
      expect(window.localStorage.getItem('markdowner.sidebarOpen')).toBe('true');
    });

    fireEvent.keyDown(window, { key: 'B', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(explorer).toHaveClass('invisible');
      expect(window.localStorage.getItem('markdowner.sidebarOpen')).toBe('false');
    });
  });

  it('toggles the Outline panel with Cmd+Shift+D', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: ['# Agenda', '', '## Decisions'].join('\n'),
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /notes\.md/i });

    fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true });

    const outline = await screen.findByRole('complementary', { name: /outline/i });
    await waitFor(() => {
      expect(outline).not.toHaveClass('invisible');
      expect(within(outline).getByRole('button', { name: /^agenda$/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(outline).toHaveClass('invisible');
      expect(window.localStorage.getItem('markdowner.sidebarOpen')).toBe('false');
    });
  });

  it('marks the Activity Bar Settings button as pressed while the Settings dialog is open', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const searchButton = await screen.findByRole('button', { name: /search \(cmd\+shift\+f\)/i });
    const settingsButton = await screen.findByRole('button', { name: /settings \(cmd\+,\)/i });

    fireEvent.click(settingsButton);
    await screen.findByTestId('settings-panel');

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

  it('runs Toggle Sidebar from the Command Palette', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'toggle sidebar' } });

    const option = await within(dialog).findByRole('option', {
      name: /toggle sidebar/i,
    });
    fireEvent.click(option);

    const explorer = await screen.findByRole('complementary', { name: /explorer/i });
    await waitFor(() => {
      expect(explorer).not.toHaveClass('invisible');
      expect(window.localStorage.getItem('markdowner.sidebarOpen')).toBe('true');
    });
  });

  it('lists the sidebar and outline toggles in keyboard shortcuts help', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: '/', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: /keyboard shortcuts/i });

    expect(within(dialog).getByText('Toggle Sidebar')).toBeInTheDocument();
    expect(within(dialog).getByText('Toggle Outline')).toBeInTheDocument();
    expect(within(dialog).getByText('⌘⇧B')).toBeInTheDocument();
    expect(within(dialog).getByText('⌘⇧D')).toBeInTheDocument();
  });

  it('announces mode changes through a hidden polite live region', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'Editor',
      }),
    );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'SplitView',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('textbox', { name: /source editor/i });

    const liveRegion = screen.getByTestId('shell-live-region');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveAttribute('dir', 'auto');
    expect(liveRegion).toHaveClass('sr-only');

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Mode: Split View');
    });
  });

  it('announces sidebar panel visibility changes without visible UI text', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('button', { name: /^new file$/i });
    const liveRegion = screen.getByTestId('shell-live-region');
    const explorerButton = screen.getByRole('button', { name: /^explorer/i });

    fireEvent.click(explorerButton);

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Files sidebar shown');
    });

    fireEvent.click(explorerButton);

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Sidebar hidden');
    });
  });

  it('leaves Cmd+B available for bold instead of toggling the sidebar', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const explorerButton = await screen.findByRole('button', { name: /^explorer/i });

    expect(explorerButton).toHaveAttribute('title', 'Explorer (Cmd+Shift+E)');
    expect(explorerButton).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+E Control+Shift+E');

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(explorerButton).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('markdowner.sidebarOpen')).toBeNull();
  });

  it('opens the Explorer sidebar with Cmd+Shift+E', async () => {
    window.localStorage.removeItem('markdowner.sidebarOpen');
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    const explorerButton = await screen.findByRole('button', { name: /^explorer/i });
    const event = new KeyboardEvent('keydown', {
      key: 'e',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(explorerButton).toHaveAttribute('aria-pressed', 'true');
      expect(window.localStorage.getItem('markdowner.sidebarOpen')).toBe('true');
    });
  });

  it('announces tab changes with RTL-capable text direction', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'alpha.md',
        activeDocumentPath: '/tmp/project/alpha.md',
        activeDocumentSource: '# Alpha',
        mode: 'Editor',
      }),
    );
    openDialogMock.mockResolvedValue('/tmp/project/ملاحظات.md');
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'ملاحظات.md',
        activeDocumentPath: '/tmp/project/ملاحظات.md',
        activeDocumentSource: '# Notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /alpha\.md/i });
    const liveRegion = screen.getByTestId('shell-live-region');

    fireEvent.keyDown(window, { key: 'o', metaKey: true });

    await screen.findByRole('tab', { name: /ملاحظات\.md/i });
    await waitFor(() => {
      expect(liveRegion).toHaveAttribute('dir', 'auto');
      expect(liveRegion).toHaveTextContent('Active tab: ملاحظات.md');
    });
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

  it('toggles WYSIWYG Code Block Wrap from the Command Palette and persists it through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return { wysiwygCodeBlockWrap: false };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'code.md',
        activeDocumentPath: '/tmp/project/code.md',
        activeDocumentSource: '```text\nlong-line\n```',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const wysiwygSurface = await screen.findByTestId('editor-surface-wysiwyg');
    expect(wysiwygSurface).toHaveAttribute('data-code-block-wrap', 'off');

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'code block wrap' } });

    const wrapOption = await within(dialog).findByRole('option', {
      name: /enable WYSIWYG code block wrap/i,
    });
    fireEvent.click(wrapOption);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ wysiwygCodeBlockWrap: true }),
      });
      expect(wysiwygSurface).toHaveAttribute('data-code-block-wrap', 'on');
    });
  });

  it('toggles Word Break Keep All from the Command Palette and persists it through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          editorWordBreakKeepAll: true,
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

    const sourceSurface = await screen.findByTestId('editor-surface-source');
    await waitFor(() => {
      expect(sourceSurface).toHaveAttribute('data-word-break', 'keep-all');
    });

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });

    fireEvent.change(input, { target: { value: 'word break' } });

    const keepAllOption = await within(dialog).findByRole('option', {
      name: /disable word break keep all/i,
    });
    fireEvent.click(keepAllOption);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorWordBreakKeepAll: false }),
      });
    });

    await waitFor(() => {
      expect(sourceSurface).toHaveAttribute('data-word-break', 'normal');
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
          wysiwygCodeBlockWrap: true,
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
          editorLineHeight: 1.6,
          editorFontFamily: '',
          editorLineWrap: true,
          editorWrapColumn: 120,
          editorShowWrapLine: true,
          editorWordBreakKeepAll: true,
          wysiwygCodeBlockWrap: false,
          outlineFontSize: 12,
          outlineRowSpacing: 0,
          defaultMode: 'Wysiwyg',
          focusModeEnabled: false,
          typewriterModeEnabled: false,
          assetFolder: 'assets',
          themeFollowSystem: true,
          pdfPaperSize: 'A4',
          diagnosticsEnabled: true,
          analyticsEnabled: true,
          showMinimap: true,
          tableDensity: 'compact',
          tableViewMode: 'normal',
          codeBlockHighlight: true,
          codeBlockTheme: 'one-dark',
          codeBlockThemeSync: true,
          terminalFontFamily: '',
          terminalFontSize: 13,
          terminalDefaultPath: '',
          terminalStartLocation: 'document',
          updateCheckEnabled: true,
          lastUpdateCheckAt: null,
          dismissedUpdateVersion: null,
          defaultAppPromptSeen: false,
          keybindingOverrides: {},
          ignoreList: [...DEFAULT_IGNORE_LIST],
        },
      });
    });
  });

  it('groups Command Palette entries contiguously in File → View → Terminal → Preferences → Theme order', async () => {
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
    for (const expected of ['File', 'View', 'Terminal', 'Preferences', 'Theme']) {
      const firstIndex = categories.indexOf(expected);
      const lastSeen = categories.lastIndexOf(expected);
      expect(firstIndex).toBeGreaterThan(lastIndex);
      const slice = categories.slice(firstIndex, lastSeen + 1);
      expect(slice.every((category) => category === expected)).toBe(true);
      lastIndex = lastSeen;
    }

    const headers = within(dialog).getAllByText(/^File$|^View$|^Terminal$|^Preferences$|^Theme$/);
    const headerCategories = headers
      .filter((node) => node.hasAttribute('data-category-header'))
      .map((node) => node.getAttribute('data-category-header'));
    expect(headerCategories).toEqual(['File', 'View', 'Terminal', 'Preferences', 'Theme']);
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

  it('suppresses native text suggestion popovers on the Command Palette input', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', {
      name: /command palette search/i,
    });

    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
    expect(input).toHaveAttribute('writingsuggestions', 'false');
  });

  it('opens the Settings dialog with the Cmd+, keyboard shortcut', async () => {
    invokeMock.mockResolvedValue({
      autoSave: false,
      editorFontSize: 14,
      editorFontFamily: '',
    });

    const { default: App } = await import('./App');

    render(<App />);

    expect(screen.queryByTestId('settings-panel')).toBeNull();

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    await screen.findByTestId('settings-panel');
  });

  it('keeps the Settings panel layout usable at compact window widths', async () => {
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

    const panel = await screen.findByTestId('settings-panel');
    const body = within(panel).getByTestId('settings-panel-body');
    const fontFamilyRow = within(panel).getByTestId('settings-field-font-family');
    const fontFamilyInput = within(panel).getByLabelText(/^font family$/i);
    const defaultModeToggle = within(panel).getByTestId('settings-default-mode-toggle');
    const pdfPaperSizeToggle = within(panel).getByTestId('settings-pdf-paper-size-toggle');

    expect(panel).toHaveClass('flex', 'min-h-0', 'overflow-hidden');
    // The scroll container is full-width so its scrollbar sits at the window's
    // right edge (not mid-window); the content is centered in an inner
    // max-w-2xl wrapper.
    expect(body).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto');
    expect(body.firstElementChild).toHaveClass('mx-auto', 'w-full', 'max-w-2xl');
    expect(fontFamilyRow).toHaveClass('grid', 'gap-2');
    expect(fontFamilyInput).toHaveClass('w-full', 'min-w-0');
    expect(defaultModeToggle).toHaveClass('h-auto', 'w-full', 'flex-wrap');
    expect(pdfPaperSizeToggle).toHaveClass('h-auto', 'w-full', 'flex-wrap');
  });

  it('renders the Settings reset action inline at the bottom of the scrollable body', async () => {
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

    const panel = await screen.findByTestId('settings-panel');
    const body = within(panel).getByTestId('settings-panel-body');
    // The reset action lives INSIDE the scrollable body (no sticky footer),
    // as the last section of the page.
    const resetSection = within(body).getByTestId('settings-reset-section');
    const resetButton = within(resetSection).getByRole('button', {
      name: /reset to defaults/i,
    });

    expect(body).toHaveClass('flex-1', 'overflow-y-auto');
    expect(resetButton).toBeInTheDocument();
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

  it('applies the configured default startup mode after bootstrap', async () => {
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
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'Wysiwyg',
      }),
    );
    setModeMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'notes.md',
        activeDocumentPath: '/tmp/project/notes.md',
        activeDocumentSource: '# Notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(setModeMock).toHaveBeenCalledWith('Editor');
    });
    expect(screen.getByRole('textbox', { name: /source editor/i })).toHaveValue('# Notes');
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

    const dialog = await screen.findByTestId('settings-panel');
    const fontSizeInput = within(dialog).getByLabelText(/^font size$/i);

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

    const dialog = await screen.findByTestId('settings-panel');
    const fontFamilyInput = within(dialog).getByLabelText(/^font family$/i);

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

    const dialog = await screen.findByTestId('settings-panel');
    const wrapToggle = within(dialog).getByLabelText(/word wrap/i);

    fireEvent.click(wrapToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorLineWrap: false }),
      });
    });
  });

  it('persists WYSIWYG Code Block Wrap changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return { wysiwygCodeBlockWrap: false };
      }
      return undefined;
    });
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'code.md',
        activeDocumentPath: '/tmp/project/code.md',
        activeDocumentSource: '```text\nlong-line\n```',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const wysiwygSurface = await screen.findByTestId('editor-surface-wysiwyg');
    expect(wysiwygSurface).toHaveAttribute('data-code-block-wrap', 'off');

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const wrapToggle = within(dialog).getByLabelText(/WYSIWYG Code Block Wrap/i);

    fireEvent.click(wrapToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ wysiwygCodeBlockWrap: true }),
      });
      expect(wysiwygSurface).toHaveAttribute('data-code-block-wrap', 'on');
    });
  });

  it('persists Word Break Keep All changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          editorWordBreakKeepAll: true,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const wordBreakToggle = within(dialog).getByLabelText(/word break keep all/i);

    fireEvent.click(wordBreakToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorWordBreakKeepAll: false }),
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

    const dialog = await screen.findByTestId('settings-panel');
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

    const dialog = await screen.findByTestId('settings-panel');
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

    const dialog = await screen.findByTestId('settings-panel');
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

    const dialog = await screen.findByTestId('settings-panel');
    const typewriterModeToggle = within(dialog).getByLabelText(/typewriter mode/i);

    fireEvent.click(typewriterModeToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ typewriterModeEnabled: true }),
      });
    });
  });

  it('persists Outline density changes from the Settings dialog through save_settings', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          outlineFontSize: 13,
          outlineRowSpacing: 2,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const fontSizeInput = within(dialog).getByLabelText(/outline font size/i);
    const rowSpacingInput = within(dialog).getByLabelText(/outline row spacing/i);

    await waitFor(() => {
      expect(fontSizeInput).toHaveValue(13);
      expect(rowSpacingInput).toHaveValue(2);
    });

    fireEvent.change(fontSizeInput, { target: { value: '12' } });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ outlineFontSize: 12 }),
      });
    });

    fireEvent.change(rowSpacingInput, { target: { value: '1' } });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ outlineRowSpacing: 1 }),
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

    const dialog = await screen.findByTestId('settings-panel');
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

    const dialog = await screen.findByTestId('settings-panel');
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
          diagnosticsEnabled: true,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const diagnosticsToggle = within(dialog).getByLabelText(/diagnostics logging/i);
    await waitFor(() => {
      expect(diagnosticsToggle).toHaveAttribute('data-state', 'checked');
    });

    fireEvent.click(diagnosticsToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ diagnosticsEnabled: false }),
      });
    });
  });

  it('persists Usage analytics opt-out from the Settings dialog through save_settings', async () => {
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

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const analyticsToggle = within(dialog).getByLabelText(/share anonymous usage data/i);
    await waitFor(() => {
      expect(analyticsToggle).toHaveAttribute('data-state', 'checked');
    });

    fireEvent.click(analyticsToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ analyticsEnabled: false }),
      });
    });
  });

  it('records local diagnostics after Diagnostics Logging is enabled', async () => {
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

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const diagnosticsToggle = within(dialog).getByLabelText(/diagnostics logging/i);
    await waitFor(() => {
      expect(diagnosticsToggle).toHaveAttribute('data-state', 'unchecked');
    });
    fireEvent.click(diagnosticsToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('record_diagnostics_event', {
        eventName: 'settings.changed',
        payload: expect.objectContaining({
          changedKeys: ['diagnosticsEnabled'],
          diagnosticsEnabled: true,
        }),
      });
    });
  });

  it('does not record diagnostics events while Diagnostics Logging is disabled', async () => {
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

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('load_settings');
    });

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const diagnosticsToggle = within(dialog).getByLabelText(/diagnostics logging/i);
    await waitFor(() => {
      expect(diagnosticsToggle).toHaveAttribute('data-state', 'unchecked');
    });
    const wordWrapToggle = within(dialog).getByLabelText(/word wrap/i);
    fireEvent.click(wordWrapToggle);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: expect.objectContaining({ editorLineWrap: false }),
      });
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      'record_diagnostics_event',
      expect.anything(),
    );
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

    const dialog = await screen.findByTestId('settings-panel');
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
          wysiwygCodeBlockWrap: true,
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const dialog = await screen.findByTestId('settings-panel');
    const resetButton = within(dialog).getByRole('button', { name: /reset to defaults/i });

    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_settings', {
        settings: {
          autoSave: false,
          editorFontSize: 14,
          editorLineHeight: 1.6,
          editorFontFamily: '',
          editorLineWrap: true,
          editorWrapColumn: 120,
          editorShowWrapLine: true,
          editorWordBreakKeepAll: true,
          wysiwygCodeBlockWrap: false,
          outlineFontSize: 12,
          outlineRowSpacing: 0,
          defaultMode: 'Wysiwyg',
          focusModeEnabled: false,
          typewriterModeEnabled: false,
          assetFolder: 'assets',
          themeFollowSystem: true,
          pdfPaperSize: 'A4',
          diagnosticsEnabled: true,
          analyticsEnabled: true,
          showMinimap: true,
          tableDensity: 'compact',
          tableViewMode: 'normal',
          codeBlockHighlight: true,
          codeBlockTheme: 'one-dark',
          codeBlockThemeSync: true,
          terminalFontFamily: '',
          terminalFontSize: 13,
          terminalDefaultPath: '',
          terminalStartLocation: 'document',
          updateCheckEnabled: true,
          lastUpdateCheckAt: null,
          dismissedUpdateVersion: null,
          defaultAppPromptSeen: false,
          keybindingOverrides: {},
          ignoreList: [...DEFAULT_IGNORE_LIST],
        },
      });
    });

    expect(within(dialog).getByLabelText(/^font size$/i)).toHaveValue(14);
    expect(within(dialog).getByLabelText(/^font family$/i)).toHaveValue('');
  });

  it('shows the update banner when a manual update check is already on the latest version', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          updateCheckEnabled: true,
          lastUpdateCheckAt: null,
          dismissedUpdateVersion: null,
        };
      }
      if (command === 'check_for_update') {
        return {
          available: false,
          currentVersion: '0.260606.2',
          latestVersion: '0.260606.2',
          dmgUrl: null,
          releaseUrl: 'https://example.com/release',
          notes: '',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: ',', metaKey: true });

    const panel = await screen.findByTestId('settings-panel');
    fireEvent.click(within(panel).getByTestId('settings-update-check'));

    const banner = await screen.findByTestId('update-banner');
    expect(within(banner).getByText(/already on the latest version/i)).toBeInTheDocument();
  });

  it('runs a manual update check from the Command Palette', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          updateCheckEnabled: true,
          lastUpdateCheckAt: null,
          dismissedUpdateVersion: null,
        };
      }
      if (command === 'check_for_update') {
        return {
          available: false,
          currentVersion: '0.260708.2',
          latestVersion: '0.260708.2',
          dmgUrl: null,
          releaseUrl: 'https://example.com/release',
          notes: '',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    const input = within(dialog).getByRole('textbox', { name: /command palette search/i });
    fireEvent.change(input, { target: { value: 'check updates' } });
    fireEvent.click(within(dialog).getByRole('option', { name: /check for updates/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('check_for_update');
    });
    const banner = await screen.findByTestId('update-banner');
    expect(within(banner).getByText(/already on the latest version/i)).toBeInTheDocument();
  });

  it('downloads and installs the latest update from the Command Palette', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_settings') {
        return {
          autoSave: false,
          editorFontSize: 14,
          editorFontFamily: '',
          editorLineWrap: true,
          updateCheckEnabled: true,
          lastUpdateCheckAt: null,
          dismissedUpdateVersion: null,
        };
      }
      if (command === 'check_for_update') {
        return {
          available: true,
          currentVersion: '0.260708.2',
          latestVersion: '0.260709.0',
          dmgUrl: 'https://example.com/Markdowner_0.260709.0_universal.dmg',
          releaseUrl: 'https://example.com/release',
          notes: '',
        };
      }
      return undefined;
    });

    const { default: App } = await import('./App');

    render(<App />);

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const checkDialog = await screen.findByRole('dialog', { name: /command palette/i });
    const checkInput = within(checkDialog).getByRole('textbox', { name: /command palette search/i });
    fireEvent.change(checkInput, { target: { value: 'check updates' } });
    fireEvent.click(within(checkDialog).getByRole('option', { name: /check for updates/i }));

    await screen.findByTestId('update-banner');

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    const installDialog = await screen.findByRole('dialog', { name: /command palette/i });
    const installInput = within(installDialog).getByRole('textbox', { name: /command palette search/i });
    fireEvent.change(installInput, { target: { value: 'latest version' } });
    fireEvent.click(
      within(installDialog).getByRole('option', {
        name: /update to latest version \(v0\.260709\.0\)/i,
      }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('download_and_install_update', {
        dmgUrl: 'https://example.com/Markdowner_0.260709.0_universal.dmg',
      });
    });
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

    const dialog = await screen.findByTestId('settings-panel');
    const resetButton = within(dialog).getByRole('button', { name: /reset to defaults/i });

    expect(resetButton).toHaveAttribute(
      'title',
      'Reset all editor preferences to factory defaults',
    );
  });

  it('opens a Markdown document from the native menu event', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'recent.md',
        activeDocumentPath: '/tmp/project/recent.md',
        activeDocumentSource: '# Recent',
        mode: 'Editor',
      }),
    );
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

    await screen.findByRole('textbox', { name: /source editor/i });
    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'open-document' });

    await waitFor(() => {
      expect(openDialogMock).toHaveBeenCalledWith({
        multiple: true,
        directory: false,
        defaultPath: '/tmp/project',
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

  it('collapses a carried source selection when opening a new document', async () => {
    openDialogMock.mockResolvedValue('/tmp/project/next.md');
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '0123456789',
        mode: 'Editor',
      }),
    );
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'next.md',
        activeDocumentPath: '/tmp/project/next.md',
        activeDocumentSource: 'abcdefghij',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByRole('textbox', { name: /source editor/i });
    const sourceTextarea = sourceEditor as HTMLTextAreaElement;
    sourceTextarea.setSelectionRange(0, sourceTextarea.value.length);

    fireEvent.keyDown(window, { key: 'o', metaKey: true });

    await waitFor(() => {
      expect(sourceTextarea).toHaveValue('abcdefghij');
      expect(sourceTextarea.selectionStart).toBe(sourceTextarea.selectionEnd);
      expect(`${sourceTextarea.selectionStart}:${sourceTextarea.selectionEnd}`).not.toBe(
        `0:${sourceTextarea.value.length}`,
      );
    });
  });

  it('collapses WYSIWYG editor state selection when opening a different document', async () => {
    const editor = createMockTiptapEditor('0123456789', [{ text: '0123456789', from: 1 }]);
    editor.state.selection = { from: 0, to: 10, head: 10 };
    tiptapMockState.editor = editor;
    openDialogMock.mockResolvedValue('/tmp/project/next.md');
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '0123456789',
        mode: 'Wysiwyg',
      }),
    );
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'next.md',
        activeDocumentPath: '/tmp/project/next.md',
        activeDocumentSource: 'abcdefghij',
        mode: 'Wysiwyg',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });

    fireEvent.keyDown(window, { key: 'o', metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(editor.commands.setContent).toHaveBeenCalledWith('abcdefghij', {
        contentType: 'markdown',
        emitUpdate: false,
      });
      expect(editor.commands.setTextSelection).toHaveBeenCalledWith({ from: 0, to: 0 });
    });
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

  it('activates a document opened while the Settings tab is active', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'current.md',
        activeDocumentPath: '/tmp/project/current.md',
        activeDocumentSource: '# Current',
        recentDocuments: ['/tmp/project/next.md'],
        mode: 'Editor',
      }),
    );
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'next.md',
        activeDocumentPath: '/tmp/project/next.md',
        activeDocumentSource: '# Next',
        recentDocuments: ['/tmp/project/next.md'],
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('tab', { name: /current\.md/i });
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(await screen.findByTestId('settings-panel')).toBeInTheDocument();

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'open-recent-document:/tmp/project/next.md' });

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/next.md');
      expect(screen.getByRole('tab', { name: /next\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
    });
  });

  it('applies native update-snapshot events from external file opens', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(updateSnapshotHandler).toBeTypeOf('function');
    });

    await act(async () => {
      await updateSnapshotHandler?.({
        payload: baseSnapshot({
          activeDocumentName: 'launched.md',
          activeDocumentPath: '/tmp/project/launched.md',
          activeDocumentSource: '# Launched from Finder',
          mode: 'Editor',
        }),
      });
    });

    expect(await screen.findByLabelText('Source editor')).toHaveValue(
      '# Launched from Finder',
    );
    expect(screen.getByRole('tab', { name: /launched\.md/i })).toBeInTheDocument();
  });

  it('reloads a clean externally-opened document from disk before showing it', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());
    // Rust re-opens a cached buffer, so the pushed snapshot can carry stale
    // bytes; the disk read returns the file's current content.
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'launched.md',
        activeDocumentPath: '/tmp/project/launched.md',
        activeDocumentSource: '# Fresh from disk',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(updateSnapshotHandler).toBeTypeOf('function');
    });

    await act(async () => {
      await updateSnapshotHandler?.({
        payload: baseSnapshot({
          activeDocumentName: 'launched.md',
          activeDocumentPath: '/tmp/project/launched.md',
          activeDocumentSource: '# Stale cached bytes',
          mode: 'Editor',
        }),
      });
    });

    expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledWith({
      path: '/tmp/project/launched.md',
      expectedSource: '# Stale cached bytes',
      expectedDirty: false,
    });
    expect(await screen.findByLabelText('Source editor')).toHaveValue('# Fresh from disk');
    expect(screen.getByRole('tab', { name: /launched\.md/i })).toBeInTheDocument();
  });

  it('keeps a native update-snapshot active when an earlier open resolves later', async () => {
    let resolveOpen: ((snapshot: AppSnapshot) => void) | undefined;

    bootstrapMock.mockResolvedValue(baseSnapshot());
    openDialogMock.mockResolvedValue('/tmp/project/alpha.md');
    openDocumentMock.mockImplementation(
      () =>
        new Promise<AppSnapshot>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(updateSnapshotHandler).toBeTypeOf('function');
    });

    fireEvent.keyDown(window, { key: 'o', metaKey: true });

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith('/tmp/project/alpha.md');
      expect(resolveOpen).toBeTypeOf('function');
    });

    await act(async () => {
      await updateSnapshotHandler?.({
        payload: baseSnapshot({
          activeDocumentName: 'launched.md',
          activeDocumentPath: '/tmp/project/launched.md',
          activeDocumentSource: '# Launched from Finder',
          mode: 'Editor',
        }),
      });
    });

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Launched from Finder');
      expect(screen.getByRole('tab', { name: /launched\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await act(async () => {
      resolveOpen?.(
        baseSnapshot({
          activeDocumentName: 'alpha.md',
          activeDocumentPath: '/tmp/project/alpha.md',
          activeDocumentSource: '# Alpha',
          mode: 'Editor',
        }),
      );
    });

    expect(sourceEditor).toHaveValue('# Launched from Finder');
    expect(screen.getByRole('tab', { name: /launched\.md/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: /alpha\.md/i })).not.toBeInTheDocument();
  });

  it('keeps a CLI-launched Markdown file active instead of replacing it with restored tabs', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'launched.md',
        activeDocumentPath: '/tmp/project/launched.md',
        activeDocumentSource: '# Launched from Finder',
        mode: 'Editor',
      }),
    );
    loadOpenTabsMock.mockResolvedValue({
      openTabs: ['/tmp/project/previous.md'],
      activeTabPath: '/tmp/project/previous.md',
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'previous.md',
        activeDocumentPath: '/tmp/project/previous.md',
        activeDocumentSource: '# Previous session',
        mode: 'Editor',
      }),
    );
    const runtimeErrors = captureRuntimeErrors();

    try {
      const { default: App } = await import('./App');

      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );

      const sourceEditor = await screen.findByLabelText('Source editor');
      await waitFor(() => {
        expect(sourceEditor).toHaveValue('# Launched from Finder');
      });
      expect(screen.getByRole('tab', { name: /launched\.md/i })).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /previous\.md/i })).not.toBeInTheDocument();
      expect(openDocumentMock).not.toHaveBeenCalledWith('/tmp/project/previous.md');
      await runtimeErrors.expectClean();
    } finally {
      runtimeErrors.restore();
    }
  });

  it('closes the only clean tab from the native close menu command without closing the window', async () => {
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

    await waitFor(() => {
      expect(menuCommandHandler).toBeTypeOf('function');
    });

    await menuCommandHandler?.({ payload: 'close-window' });

    await waitFor(() => {
      expect(screen.queryByRole('tablist', { name: /open documents/i })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^new file$/i })).toBeInTheDocument();
    expect(destroyWindowMock).not.toHaveBeenCalled();
  });

  it('closes the only clean tab with Cmd+W without closing the window', async () => {
    const documentPath = '/tmp/project/meeting-notes.md';
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(screen.queryByRole('tablist', { name: /open documents/i })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^new file$/i })).toBeInTheDocument();
    expect(destroyWindowMock).not.toHaveBeenCalled();
    expect(messageMock).not.toHaveBeenCalled();
  });

  it('toggles the bottom terminal panel with Ctrl+Backquote', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('button', { name: /^new file$/i });

    fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });

    expect(await screen.findByTestId('terminal-panel')).toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId('terminal-panel')).toBeNull();
    });
  });

  it('starts the terminal from the active document folder before the workspace root', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        rootDir: '/tmp/project',
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/docs/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });

    expect(await screen.findByTestId('terminal-panel')).toHaveAttribute(
      'data-working-directory',
      '/tmp/project/docs',
    );
  });

  it('closes the terminal panel with Cmd+W while terminal focus is active', async () => {
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

    fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });
    const terminalPanel = await screen.findByTestId('terminal-panel');
    fireEvent.focus(terminalPanel);

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId('terminal-panel')).toBeNull();
    });
    expect(screen.getByRole('tab', { name: /meeting-notes\.md/i })).toBeInTheDocument();
    expect(destroyWindowMock).not.toHaveBeenCalled();
  });

  it('restores and persists terminal height through the terminal resize handle', async () => {
    window.localStorage.setItem('markdowner.terminalHeight', '360');
    bootstrapMock.mockResolvedValue(baseSnapshot());

    try {
      const { default: App } = await import('./App');

      render(<App />);

      await screen.findByRole('button', { name: /^new file$/i });
      fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });

      const separator = await screen.findByRole('separator', { name: /resize terminal/i });
      expect(separator).toHaveAttribute('aria-valuenow', '360');

      fireEvent.keyDown(separator, { key: 'ArrowUp' });

      await waitFor(() => {
        expect(separator).toHaveAttribute('aria-valuenow', '368');
      });
      expect(window.localStorage.getItem('markdowner.terminalHeight')).toBe('368');
    } finally {
      window.localStorage.removeItem('markdowner.terminalHeight');
    }
  });

  it('stops terminal drag resizing when the panel closes before pointerup', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());

    try {
      const { default: App } = await import('./App');

      render(<App />);

      await screen.findByRole('button', { name: /^new file$/i });
      fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });

      const separator = await screen.findByRole('separator', { name: /resize terminal/i });
      fireEvent.pointerDown(separator, { clientY: window.innerHeight - 300 });
      expect(window.localStorage.getItem('markdowner.terminalHeight')).toBe('300');

      fireEvent.keyDown(window, { code: 'Backquote', key: '`', ctrlKey: true });
      await waitFor(() => {
        expect(screen.queryByTestId('terminal-panel')).toBeNull();
      });

      fireEvent.pointerMove(window, { clientY: window.innerHeight - 600 });
      expect(window.localStorage.getItem('markdowner.terminalHeight')).toBe('300');
    } finally {
      window.localStorage.removeItem('markdowner.terminalHeight');
    }
  });

  it('reopens the most recently closed tab with Cmd+Shift+T', async () => {
    const documentPath = '/tmp/project/meeting-notes.md';
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Meeting notes',
        mode: 'Editor',
      }),
    );
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Cached version',
        mode: 'Editor',
      }),
    );
    reloadActiveDocumentFromDiskMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: documentPath,
        activeDocumentSource: '# Latest disk version',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('textbox', { name: /source editor/i });

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(screen.queryByRole('tablist', { name: /open documents/i })).toBeNull();
    });

    fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(openDocumentMock).toHaveBeenCalledWith(documentPath);
      expect(reloadActiveDocumentFromDiskMock).toHaveBeenCalledWith({
        path: documentPath,
        expectedSource: '# Cached version',
        expectedDirty: false,
      });
      expect(screen.getByRole('tab', { name: /meeting-notes\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(screen.getByRole('textbox', { name: /source editor/i })).toHaveValue(
      '# Latest disk version',
    );
  });

  it('closes the only clean tab from the tab close button without closing the window', async () => {
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

    const tab = await screen.findByRole('tab', { name: /meeting-notes\.md/i });
    fireEvent.click(within(tab).getByRole('button', { name: /close tab/i }));

    await waitFor(() => {
      expect(screen.queryByRole('tablist', { name: /open documents/i })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^new file$/i })).toBeInTheDocument();
    expect(destroyWindowMock).not.toHaveBeenCalled();
    expect(messageMock).not.toHaveBeenCalled();
  });

  it('hides the app (keeps it in the dock) with Cmd+W when no tabs are open', async () => {
    // Empty-state bootstrap (no active document, no persisted tabs) means the
    // tab list is empty. Cmd+W must hide the *application* like ⌘H — returning
    // focus to the previously active app on macOS — without quitting. This goes
    // through the Rust `hide_app_or_window` command; the app stays in the dock.
    // There is nothing dirty to prompt about. Regression for FR-TABS-003.
    bootstrapMock.mockResolvedValue(baseSnapshot());

    const { default: App } = await import('./App');

    render(<App />);

    await screen.findByRole('button', { name: /^new file$/i });

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('hide_app_or_window');
    });
    expect(destroyWindowMock).not.toHaveBeenCalled();
    expect(messageMock).not.toHaveBeenCalled();
  });

  it('closes the only dirty tab from Cmd+W without saving when discard is selected', async () => {
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
      expect(screen.queryByRole('tablist', { name: /open documents/i })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^new file$/i })).toBeInTheDocument();
    expect(destroyWindowMock).not.toHaveBeenCalled();
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

  it('hot exit: closing a dirty window persists the draft backup without prompting', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );

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
      expect(saveDraftBackupsMock).toHaveBeenCalledWith([
        {
          path: '/tmp/project/meeting-notes.md',
          untitledId: null,
          name: 'meeting-notes.md',
          draft: '# Meeting notes\n\nUnsaved edit',
        },
      ]);
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(messageMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
  });

  it('hot exit: Cmd+Q quits a dirty app without prompting and backs up the draft', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });

    fireEvent.keyDown(window, { key: 'q', metaKey: true });

    await waitFor(() => {
      expect(quitAppMock).toHaveBeenCalled();
    });
    expect(messageMock).not.toHaveBeenCalled();
    expect(saveDraftBackupsMock).toHaveBeenCalledWith([
      {
        path: '/tmp/project/meeting-notes.md',
        untitledId: null,
        name: 'meeting-notes.md',
        draft: '# Meeting notes\n\nUnsaved edit',
      },
    ]);
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(destroyWindowMock).not.toHaveBeenCalled();
  });

  it('hot exit: quitting backs up an inactive dirty tab from its stashed draft', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    const betaPath = '/tmp/project/beta.md';

    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath, betaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockImplementation((path: string) => {
      const isAlpha = path === alphaPath;
      return Promise.resolve(
        baseSnapshot({
          activeDocumentName: isAlpha ? 'alpha.md' : 'beta.md',
          activeDocumentPath: path,
          activeDocumentSource: isAlpha ? '# Alpha' : '# Beta',
          mode: 'Editor',
        }),
      );
    });
    replaceActiveDocumentSourceMock.mockImplementation(async (source: string) =>
      baseSnapshot({
        activeDocumentName: 'beta.md',
        activeDocumentPath: betaPath,
        activeDocumentSource: source,
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
      expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: /beta\.md/i }));
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Beta');
    });
    fireEvent.change(sourceEditor, { target: { value: '# Beta edited' } });
    fireEvent.click(screen.getByRole('tab', { name: /alpha\.md/i }));

    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
      expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        within(screen.getByRole('tab', { name: /beta\.md/i })).getByLabelText(
          'Unsaved changes',
        ),
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'q', metaKey: true });

    await waitFor(() => {
      expect(quitAppMock).toHaveBeenCalled();
    });
    // Hot exit: the inactive dirty tab's stashed draft is backed up as-is —
    // no prompt, no tab switch.
    expect(messageMock).not.toHaveBeenCalled();
    expect(saveDraftBackupsMock).toHaveBeenCalledWith([
      {
        path: betaPath,
        untitledId: null,
        name: 'beta.md',
        draft: '# Beta edited',
      },
    ]);
    expect(
      screen.getByRole('tab', { name: /alpha\.md/i }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('hot exit: prevents closing while an operation is mid-flight', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'meeting-notes.md',
        activeDocumentPath: '/tmp/project/meeting-notes.md',
        activeDocumentSource: '# Meeting notes',
        activeDocumentDirty: true,
        mode: 'Editor',
      }),
    );
    // A save that never resolves keeps the app busy for the rest of the test.
    saveActiveDocumentMock.mockImplementation(() => new Promise(() => {}));

    const { default: App } = await import('./App');

    render(<App />);

    await waitFor(() => {
      expect(onCloseRequestedMock).toHaveBeenCalled();
      expect(closeRequestedHandler).toBeTypeOf('function');
    });
    const editor = await screen.findByRole('textbox', { name: /source editor/i });
    fireEvent.change(editor, { target: { value: '# Meeting notes\n\nUnsaved edit' } });
    await screen.findAllByText(/^meeting-notes\.md$/);

    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => {
      expect(saveActiveDocumentMock).toHaveBeenCalled();
    });

    const preventDefault = vi.fn();
    await closeRequestedHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(messageMock).not.toHaveBeenCalled();
  });

  it('hot exit: an untitled dirty draft is backed up on close instead of prompting Save As', async () => {
    bootstrapMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        activeDocumentDirty: true,
        mode: 'Editor',
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
      expect(saveDraftBackupsMock).toHaveBeenCalledWith([
        expect.objectContaining({
          path: null,
          untitledId: expect.any(String),
          draft: 'Some draft content',
        }),
      ]);
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(saveDialogMock).not.toHaveBeenCalled();
    expect(saveActiveDocumentAsMock).not.toHaveBeenCalled();
    expect(messageMock).not.toHaveBeenCalled();
  });

  it("removes the draft backup when the user discards via Don't Save on Cmd+W", async () => {
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
    await screen.findAllByText(/^meeting-notes\.md$/);

    fireEvent.keyDown(window, { key: 'w', metaKey: true });

    // The per-tab close confirmation still exists — only window/app close
    // skips it — and choosing "Don't Save" must purge the backup so the
    // discarded draft can never come back after a restart.
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
    });
    await waitFor(() => {
      expect(saveDraftBackupsMock).toHaveBeenCalled();
      expect(saveDraftBackupsMock.mock.lastCall?.[0]).toEqual([]);
    });
    expect(saveActiveDocumentMock).not.toHaveBeenCalled();
  });

  it('restores a backed-up dirty draft for a reopened tab on startup', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'alpha.md',
        activeDocumentPath: alphaPath,
        activeDocumentSource: '# Alpha',
        mode: 'Editor',
      }),
    );
    loadDraftBackupsMock.mockResolvedValue([
      {
        path: alphaPath,
        untitledId: null,
        name: 'alpha.md',
        draft: '# Alpha\n\nRestored unsaved edit',
      },
    ]);

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha\n\nRestored unsaved edit');
      expect(
        within(screen.getByRole('tab', { name: /alpha\.md/i })).getByLabelText(
          'Unsaved changes',
        ),
      ).toBeInTheDocument();
    });
  });

  it('restores an untitled backup as a dirty untitled tab on startup', async () => {
    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [],
      activeTabPath: null,
      cursorPositions: {},
    });
    loadDraftBackupsMock.mockResolvedValue([
      {
        path: null,
        untitledId: 'previous-session-tab',
        name: 'Untitled',
        draft: 'scratch ideas that must survive',
      },
    ]);
    newDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'Untitled.md',
        activeDocumentPath: null,
        activeDocumentSource: '',
        mode: 'Editor',
      }),
    );

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(newDocumentMock).toHaveBeenCalled();
      expect(sourceEditor).toHaveValue('scratch ideas that must survive');
      expect(
        within(screen.getByRole('tab', { name: /untitled/i })).getByLabelText(
          'Unsaved changes',
        ),
      ).toBeInTheDocument();
    });
  });

  it('drops a startup backup whose draft matches the disk content', async () => {
    const alphaPath = '/tmp/project/alpha.md';
    bootstrapMock.mockResolvedValue(baseSnapshot());
    loadOpenTabsMock.mockResolvedValue({
      openTabs: [alphaPath],
      activeTabPath: alphaPath,
      cursorPositions: {},
    });
    openDocumentMock.mockResolvedValue(
      baseSnapshot({
        activeDocumentName: 'alpha.md',
        activeDocumentPath: alphaPath,
        activeDocumentSource: '# Alpha',
        mode: 'Editor',
      }),
    );
    loadDraftBackupsMock.mockResolvedValue([
      { path: alphaPath, untitledId: null, name: 'alpha.md', draft: '# Alpha\n' },
    ]);

    const { default: App } = await import('./App');

    render(<App />);

    const sourceEditor = await screen.findByLabelText('Source editor');
    await waitFor(() => {
      expect(sourceEditor).toHaveValue('# Alpha');
    });
    expect(
      within(screen.getByRole('tab', { name: /alpha\.md/i })).queryByLabelText(
        'Unsaved changes',
      ),
    ).not.toBeInTheDocument();
  });
});
