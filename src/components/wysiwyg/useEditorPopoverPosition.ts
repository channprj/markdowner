import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { editorPopoverAnchor, editorSurfaceRect, placeEditorPopover } from './editorPopoverPosition';

type EditorPopoverPosition = ReturnType<typeof placeEditorPopover>;

function samePosition(a: EditorPopoverPosition | null, b: EditorPopoverPosition | null) {
  return a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.maxHeight === b.maxHeight);
}

/** Tracks the editor even while keyboard focus is inside the floating panel. */
export function useEditorPopoverPosition(
  editor: Editor | null,
  panelRef: RefObject<HTMLElement | null>,
  preferredPosition: { left: number; top: number } | null = null,
) {
  const [position, setPosition] = useState<EditorPopoverPosition | null>(null);
  // The placement last handed to React. Measuring after every commit must not
  // dispatch an unchanged value: once this fiber has pending lanes React cannot
  // drop it eagerly, so every commit would schedule another sync render and a
  // re-rendering parent would hit React's nested update limit (#185).
  const appliedRef = useRef<EditorPopoverPosition | null>(null);
  const updateRef = useRef(() => {});

  // Content can grow without resizing the window, so measure after each commit.
  useLayoutEffect(() => {
    const apply = (next: EditorPopoverPosition | null) => {
      if (samePosition(appliedRef.current, next)) return;
      appliedRef.current = next;
      setPosition(next);
    };
    updateRef.current = () => {
      const panel = panelRef.current;
      const bounds = editorSurfaceRect(editor);
      const rect = panel?.getBoundingClientRect();
      const height = Math.max(rect?.height ?? 0, panel?.scrollHeight ?? 0);
      const anchor = bounds && editorPopoverAnchor(editor, bounds, height);
      if (!panel || !rect || !bounds || !anchor) {
        apply(null);
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
      apply(next);
    };
    updateRef.current();
  });

  // Subscribe once per editor; the panel element must stay mounted with the hook.
  useLayoutEffect(() => {
    const update = () => updateRef.current();
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
  }, [editor, panelRef]);
  return position;
}
