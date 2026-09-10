import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { editorPopoverAnchor, editorSurfaceRect, placeEditorPopover } from './editorPopoverPosition';

/** Tracks the editor even while keyboard focus is inside the floating panel. */
export function useEditorPopoverPosition(
  editor: Editor | null,
  panelRef: RefObject<HTMLElement | null>,
  preferredPosition: { left: number; top: number } | null = null,
) {
  const [position, setPosition] = useState<ReturnType<typeof placeEditorPopover> | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const panel = panelRef.current;
      const bounds = editorSurfaceRect(editor);
      const rect = panel?.getBoundingClientRect();
      const height = Math.max(rect?.height ?? 0, panel?.scrollHeight ?? 0);
      const anchor = bounds && editorPopoverAnchor(editor, bounds, height);
      if (!panel || !rect || !bounds || !anchor) {
        setPosition(current => current === null ? current : null);
        return;
      }
      const next = placeEditorPopover({
        anchor, bounds, width: rect.width, height,
        left: preferredPosition?.left ?? anchor.left,
        preferred: preferredPosition && preferredPosition.top < anchor.top ? 'above' : 'below',
      });
      // Preserve user positioning when it already leaves the active line clear.
      if (preferredPosition) {
        const top = Math.max(bounds.top + 8, Math.min(preferredPosition.top, bounds.bottom - Math.min(height, next.maxHeight) - 8));
        if (top + height <= anchor.top - 8 || top >= anchor.bottom + 8) next.top = top;
      }
      setPosition(current => current?.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (panelRef.current) observer?.observe(panelRef.current);
    const surface = editor?.view?.dom?.closest('[data-testid="editor-surface-wysiwyg"]');
    if (surface) observer?.observe(surface);
    editor?.on?.('selectionUpdate', update);
    editor?.on?.('transaction', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      editor?.off?.('selectionUpdate', update);
      editor?.off?.('transaction', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  });
  return position;
}
