import type { EditorMode } from './desktop';

type RequestFrame = (callback: FrameRequestCallback) => number;

type FocusOptions = {
  doc?: Document;
  requestFrame?: RequestFrame;
};

type FocusActiveEditorInput = FocusOptions & {
  currentMode: EditorMode;
  sourceEditorView: { focus: () => void } | null;
  sourceEditorContainer: HTMLElement | null;
};

function getDocument(doc?: Document): Document {
  return doc ?? document;
}

function getRequestFrame(requestFrame?: RequestFrame): RequestFrame {
  return requestFrame ?? requestAnimationFrame;
}

export function focusExplorerTree(
  rememberedElement: HTMLElement | null,
  options: FocusOptions = {},
): boolean {
  const doc = getDocument(options.doc);

  const restoreLast = () => {
    if (
      rememberedElement &&
      rememberedElement.isConnected &&
      rememberedElement.closest('[data-explorer-root]')
    ) {
      rememberedElement.focus({ preventScroll: false });
      return true;
    }
    return false;
  };

  const focusFallback = () => {
    const root = doc.querySelector<HTMLElement>('[data-explorer-root]');
    if (!root) return false;
    const firstTreeButton = root.querySelector<HTMLButtonElement>(
      '[data-testid="explorer-workspace-tree"] button',
    );
    if (firstTreeButton) {
      firstTreeButton.focus();
      return true;
    }
    const firstOpenEditor = root.querySelector<HTMLButtonElement>(
      '[data-testid="explorer-open-editors"] button',
    );
    if (firstOpenEditor) {
      firstOpenEditor.focus();
      return true;
    }
    const filter = root.querySelector<HTMLInputElement>('[data-explorer-filter]');
    if (filter) {
      filter.focus();
      return true;
    }
    return false;
  };

  if (restoreLast() || focusFallback()) return true;
  getRequestFrame(options.requestFrame)(() => {
    if (restoreLast()) return;
    focusFallback();
  });
  return false;
}

export function focusOutlineTree(
  rememberedElement: HTMLElement | null,
  options: FocusOptions = {},
): boolean {
  const doc = getDocument(options.doc);

  const tryFocus = () => {
    const root = doc.querySelector<HTMLElement>('[data-outline-root]');
    if (!root) return false;

    if (
      rememberedElement &&
      rememberedElement.isConnected &&
      rememberedElement.closest('[data-outline-root]')
    ) {
      rememberedElement.focus({ preventScroll: false });
      return true;
    }

    const firstOutlineRow = root.querySelector<HTMLButtonElement>('[data-outline-row]');
    if (firstOutlineRow) {
      firstOutlineRow.focus();
      return true;
    }

    root.focus({ preventScroll: false });
    return true;
  };

  if (tryFocus()) return true;
  getRequestFrame(options.requestFrame)(() => {
    tryFocus();
  });
  return false;
}

export function focusExplorerFilter(options: FocusOptions = {}): void {
  const doc = getDocument(options.doc);

  getRequestFrame(options.requestFrame)(() => {
    const input = doc.querySelector<HTMLInputElement>(
      '[data-explorer-root] [data-explorer-filter]',
    );
    if (input) {
      input.focus();
      input.select();
    }
  });
}

// Retry budget for editors that mount or become visible a few frames after
// the open commits (React startTransition + WKWebView time-sliced commits).
const FOCUS_RETRY_FRAMES = 10;

export function focusActiveEditor(input: FocusActiveEditorInput): boolean {
  const doc = getDocument(input.doc);
  const requestFrame = getRequestFrame(input.requestFrame);

  // Elements that received focus through this helper. Lets the retry loop
  // tell its own still-settling focus apart from focus the user or another
  // component claimed mid-loop.
  const focusedByUs = new Set<Element>();

  const containsActive = (surface: HTMLElement | null): boolean => {
    const active = doc.activeElement;
    return Boolean(surface && active && surface.contains(active));
  };

  // Attempt to focus the editor surface for the current mode. Success means
  // document.activeElement actually landed inside the target surface: real
  // WebKit ignores focus() on a hidden (display:none) element, so calling
  // focus() alone must not count. Never gate on offsetParent for visibility —
  // it is always null in jsdom, where hidden elements do accept focus.
  const tryFocus = (): boolean => {
    if (input.currentMode === 'Wysiwyg') {
      // Re-query each attempt: the surface mounts mid-loop when the open
      // commits inside a React transition.
      const proseMirror = doc.querySelector<HTMLElement>(
        '[data-testid="editor-surface-wysiwyg"] .ProseMirror',
      );
      if (!proseMirror) return false;
      if (containsActive(proseMirror)) return true;
      focusedByUs.add(proseMirror);
      proseMirror.focus();
      return containsActive(proseMirror);
    }

    const container = input.sourceEditorContainer;
    if (containsActive(container)) return true;

    if (input.sourceEditorView) {
      input.sourceEditorView.focus();
      const active = doc.activeElement;
      if (active) focusedByUs.add(active);
      // Without a container we cannot verify placement; trust the view.
      if (!container) return true;
      return containsActive(container);
    }

    const sourceTextarea = container?.querySelector('textarea');
    if (sourceTextarea instanceof HTMLTextAreaElement) {
      focusedByUs.add(sourceTextarea);
      sourceTextarea.focus();
      return containsActive(container);
    }
    return false;
  };

  if (tryFocus()) return true;

  // Focus that existed before/at the first attempt (e.g. the Explorer row the
  // user just clicked) must not abort the loop — only focus gained afterwards.
  const baselineActive = doc.activeElement;

  const isNeutral = (element: Element | null) =>
    !element || element === doc.body || element === doc.documentElement;

  const retry = (framesLeft: number) => {
    requestFrame(() => {
      const active = doc.activeElement;
      const stolen =
        !isNeutral(active) &&
        active !== baselineActive &&
        !(active && focusedByUs.has(active));
      // The user (or another component) focused something else mid-loop;
      // stop retrying instead of fighting them.
      if (stolen) return;
      if (tryFocus()) return;
      if (framesLeft > 1) retry(framesLeft - 1);
    });
  };
  retry(FOCUS_RETRY_FRAMES);
  return false;
}
