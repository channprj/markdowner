/**
 * Tiny event bus shared by the floating editor overlays (link popup,
 * selection toolbar, slash menu, etc.) so they can coordinate without
 * threading callbacks through the App.tsx tree.
 *
 * Events are typed by name; the payload type is enforced at the
 * publish/subscribe site so downstream listeners stay in sync.
 */

export type EditorOverlayEvent = 'link:edit-request' | 'link:open' | 'slash:open-at-cursor';

interface LinkEditRequest {
  /** When true, request the URL input to take focus immediately. */
  focusInput?: boolean;
}

interface LinkOpenRequest {
  /** Raw href from the clicked markdown link (relative, absolute, or URL). */
  href: string;
  /** Cmd/Ctrl-click: open markdown targets in a new tab instead of the current one. */
  openInNewTab: boolean;
}

interface SlashOpenAtCursorRequest {
  /**
   * 'insert' opens the classic block-insert list at the caret. 'convert'
   * opens the Turn-into list that reformats the current line — or every
   * block in the selection — and hides non-convertible items.
   */
  mode?: 'insert' | 'convert';
}

type PayloadFor<E extends EditorOverlayEvent> = E extends 'link:edit-request'
  ? LinkEditRequest
  : E extends 'link:open'
    ? LinkOpenRequest
    : E extends 'slash:open-at-cursor'
      ? SlashOpenAtCursorRequest
      : never;

type Listener<E extends EditorOverlayEvent> = (payload: PayloadFor<E>) => void;

const listeners: Map<EditorOverlayEvent, Set<Listener<EditorOverlayEvent>>> = new Map();

export function publishEditorEvent<E extends EditorOverlayEvent>(
  event: E,
  payload: PayloadFor<E>,
): void {
  const bucket = listeners.get(event);
  if (!bucket) return;
  for (const listener of bucket) {
    try {
      listener(payload);
    } catch {
      // Listeners are best-effort; swallow individual failures.
    }
  }
}

export function subscribeEditorEvent<E extends EditorOverlayEvent>(
  event: E,
  listener: Listener<E>,
): () => void {
  let bucket = listeners.get(event);
  if (!bucket) {
    bucket = new Set();
    listeners.set(event, bucket);
  }
  bucket.add(listener as Listener<EditorOverlayEvent>);
  return () => {
    bucket?.delete(listener as Listener<EditorOverlayEvent>);
  };
}
