import {
  openDocument,
  openExternalUrl,
  openPathInDefaultApp,
  resolveMarkdownLink,
  type ResolvedLink,
} from './desktop';

/**
 * Routes a markdown link href through the right desktop action:
 * - markdown file → open it as a new editor tab
 * - other local file → ask the OS to handle (Finder / Preview / …)
 * - external URL → open in the default browser
 * - anchor (#heading) → caller handles in-document scroll
 *
 * `basePath` should be the active document's absolute path so relative
 * targets like `../other.md` resolve correctly. Pass `null` when no document
 * is open (relative paths will then resolve to "unresolved").
 *
 * Returns the classification so callers can react (e.g. show a toast on
 * "unresolved" or scroll to the anchor themselves).
 */
export async function openMarkdownLink(
  href: string,
  basePath: string | null,
  options: { onMarkdownOpened?: () => void } = {},
): Promise<ResolvedLink> {
  const resolved = await resolveMarkdownLink(href, basePath);

  switch (resolved.kind) {
    case 'markdown':
      await openDocument(resolved.absolutePath);
      options.onMarkdownOpened?.();
      return resolved;
    case 'file':
      await openPathInDefaultApp(resolved.absolutePath);
      return resolved;
    case 'external':
      await openExternalUrl(resolved.href);
      return resolved;
    case 'anchor':
    case 'unresolved':
      return resolved;
  }
}

/**
 * Match against the user's intent to open a link from inside the editor —
 * Cmd+Click on macOS, Ctrl+Click on Windows/Linux. Matches the VS Code / Zed
 * convention so the click target lands its caret normally without the
 * modifier, but jumps to the linked resource with it.
 */
export function isOpenLinkClick(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  if (typeof navigator === 'undefined') return event.metaKey || event.ctrlKey;
  return navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey;
}

export function findClickedAnchorHref(
  target: EventTarget | null,
  container: Element | null = null,
): string | null {
  const element =
    typeof Element !== 'undefined' && target instanceof Element
      ? target
      : typeof Node !== 'undefined' && target instanceof Node
        ? target.parentElement
        : null;
  const anchor = element?.closest('a');
  if (!anchor) return null;
  if (container && !container.contains(anchor)) return null;
  return anchor.getAttribute('href') || null;
}

/**
 * Capture-phase click interceptor for a rendered markdown surface (the WYSIWYG
 * contenteditable or the split-view preview pane). When a rendered anchor is
 * clicked it cancels the default action and routes the href to `onOpen`.
 *
 * Why capture phase + preventDefault here instead of ProseMirror's
 * `editorProps.handleClick` or React's bubble-phase `onClick`: inside a Tauri
 * WKWebView, clicking an `<a>` triggers a native webview navigation that those
 * handlers don't reliably cancel (ProseMirror derives its click from `mouseup`,
 * whose `preventDefault` does not stop the subsequent click's navigation). A
 * capture listener on the surface runs before the browser's default link
 * activation, so `preventDefault()` reliably wins.
 *
 * `openInNewTab` follows the browser/editor convention: Cmd-click on macOS,
 * Ctrl-click elsewhere. Returns a cleanup function that detaches the listener.
 */
export function attachMarkdownLinkClickInterceptor(
  surface: HTMLElement,
  onOpen: (href: string, options: { openInNewTab: boolean }) => void,
): () => void {
  const handleClick = (event: MouseEvent) => {
    // Left button only; let a prior handler that already acted win.
    if (event.button !== 0 || event.defaultPrevented) return;
    const href = findClickedAnchorHref(event.target, surface);
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(href, { openInNewTab: event.metaKey || event.ctrlKey });
  };
  surface.addEventListener('click', handleClick, true);
  return () => surface.removeEventListener('click', handleClick, true);
}
