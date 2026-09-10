import type { Editor } from '@tiptap/react';

export type PopoverRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;

export function editorSurfaceRect(editor: Editor | null): PopoverRect | null {
  const dom = editor?.view?.dom;
  if (!(dom instanceof HTMLElement)) return null;
  const rect = (dom.closest('[data-testid="editor-surface-wysiwyg"]') ?? dom).getBoundingClientRect();
  const bounds = {
    left: Math.max(0, rect.left),
    right: Math.min(window.innerWidth, rect.right),
    top: Math.max(0, rect.top),
    bottom: Math.min(window.innerHeight, rect.bottom),
  };
  return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : null;
}

export function editorPopoverAnchor(
  editor: Editor | null,
  bounds: PopoverRect,
  panelHeight: number,
): PopoverRect | null {
  if (!editor) return null;
  try {
    const selection = editor.state.selection;
    const head = editor.view.coordsAtPos(selection.head ?? selection.to);
    if (!Object.values(head).every(Number.isFinite) || head.bottom <= head.top) return null;
    if (selection.from === selection.to) return head;
    const start = editor.view.coordsAtPos(selection.from);
    const end = editor.view.coordsAtPos(selection.to);
    const range = {
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
    };
    if (!Object.values(range).every(Number.isFinite)) return head;
    // Protect the whole selection when possible. For selections spanning most
    // of the screen, keep the active end visible and the panel usable.
    const room = Math.max(range.top - bounds.top - 16, bounds.bottom - range.bottom - 16);
    return room >= Math.min(panelHeight, 120) ? range : head;
  } catch {
    return null;
  }
}

/** Place outside the active line; a tall panel scrolls within the larger slot. */
export function placeEditorPopover({
  anchor, bounds, width, height, left = anchor.left, preferred = 'below', margin = 8,
}: {
  anchor: PopoverRect;
  bounds: PopoverRect;
  width: number;
  height: number;
  left?: number;
  preferred?: 'above' | 'below';
  margin?: number;
}) {
  const topEdge = bounds.top + margin;
  const bottomEdge = bounds.bottom - margin;
  const aboveEnd = Math.max(topEdge, Math.min(bottomEdge, anchor.top - margin));
  const belowStart = Math.min(bottomEdge, Math.max(topEdge, anchor.bottom + margin));
  const above = Math.max(0, aboveEnd - topEdge);
  const below = Math.max(0, bottomEdge - belowStart);
  const preferredSpace = preferred === 'above' ? above : below;
  const otherSpace = preferred === 'above' ? below : above;
  const side = height <= preferredSpace || (height > otherSpace && preferredSpace >= otherSpace)
    ? preferred : preferred === 'above' ? 'below' : 'above';
  const maxHeight = side === 'above' ? above : below;
  return {
    left: Math.max(bounds.left + margin, Math.min(left, bounds.right - width - margin)),
    top: side === 'above' ? aboveEnd - Math.min(height, maxHeight) : belowStart,
    maxHeight,
  };
}
