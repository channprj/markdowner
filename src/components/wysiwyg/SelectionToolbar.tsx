import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  Strikethrough,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { publishEditorEvent } from '@/lib/editorEvents';

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Position = { top: number; left: number };

const TOOLBAR_OFFSET_PX = 12;

/** A prosemirror-tables CellSelection carries $anchorCell/$headCell. */
function isCellSelection(selection: unknown): boolean {
  return (
    typeof selection === 'object' &&
    selection !== null &&
    '$anchorCell' in selection &&
    '$headCell' in selection
  );
}

/**
 * Notion-style floating selection toolbar.
 *
 * Renders an inline formatting toolbar above the current text selection. Only
 * visible when a non-empty text selection is active inside the WYSIWYG editor.
 */
export function SelectionToolbar({ editor, enabled = true }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const computePosition = useCallback((): Position | null => {
    if (!editor) return null;
    const { state, view } = editor;
    const { from, to, empty } = state.selection;
    if (empty || from === to) return null;
    if (!view.hasFocus() && !window.getSelection()?.toString()) return null;

    // A multi-cell table selection (CellSelection) is structural, not a text
    // run — inline marks across a cell span are meaningless and the table
    // editing toolbar owns this case. Suppress so the two toolbars don't
    // overlap (the formatting toolbar would otherwise sit on top and swallow
    // clicks meant for the table controls).
    if (isCellSelection(state.selection)) return null;

    // Inline marks (bold/italic/strike/inline-code/link) cannot apply inside a
    // code block — ProseMirror's schema forbids it. Showing the toolbar there
    // would offer buttons that silently do nothing on click, which reads as
    // "the editor is broken". Suppress instead.
    if (typeof editor.isActive === 'function' && editor.isActive('codeBlock')) {
      return null;
    }

    // Use ProseMirror coordinates: anchor/head can be in any direction, so we
    // use the start and end of the selection to compute a bounding box.
    let startCoords: { top: number; bottom: number; left: number };
    let endCoords: { top: number; bottom: number; right: number };
    try {
      startCoords = view.coordsAtPos(from);
      endCoords = view.coordsAtPos(to, 1);
    } catch {
      // coordsAtPos can throw briefly while ProseMirror re-measures geometry
      // (e.g. mid-transaction). Hiding the toolbar on that frame is the only
      // safe option — the next selectionUpdate / transaction event will retry.
      return null;
    }

    const top = Math.min(startCoords.top, endCoords.top);
    const left = (startCoords.left + endCoords.right) / 2;

    if (!Number.isFinite(top) || !Number.isFinite(left)) return null;

    return {
      top: top - TOOLBAR_OFFSET_PX,
      left,
    };
  }, [editor]);

  // Track active selection. We listen to both ProseMirror updates and native
  // selectionchange to catch mouse-drag releases that don't always emit a
  // selectionUpdate.
  useEffect(() => {
    if (!editor || !enabled) {
      setVisible(false);
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
      // Test mocks and partially-initialized editors don't implement the event
      // bus — skip silently rather than crashing the render.
      return;
    }

    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = computePosition();
        if (!next) {
          setVisible(false);
          return;
        }
        setPosition(next);
        setVisible(true);
      });
    };

    const handleBlur = () => {
      // Defer so clicks on toolbar buttons aren't interpreted as blur.
      window.setTimeout(() => {
        const active = document.activeElement;
        if (toolbarRef.current && active && toolbarRef.current.contains(active)) return;
        setVisible(false);
      }, 50);
    };

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('blur', handleBlur);
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('blur', handleBlur);
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor, enabled, computePosition]);

  const isActive = useCallback(
    (name: string, attrs?: Record<string, unknown>) => {
      if (!editor) return false;
      return editor.isActive(name, attrs);
    },
    [editor],
  );

  const toggle = (mark: 'bold' | 'italic' | 'strike' | 'code') => () => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (mark) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;
      case 'code':
        chain.toggleCode().run();
        break;
    }
  };

  // Trigger the inline link editor (the floating LinkPopup component) instead
  // of falling back to window.prompt — the prompt is jarring inside a desktop
  // app and steals focus across windows. The popup handles editing existing
  // links naturally; for fresh selections we attach an `https://` placeholder
  // so TipTap's link extension definitely applies the mark, then ask the
  // popup to focus + select its URL input so the user immediately types over
  // the placeholder.
  const editLink = () => {
    if (!editor) return;
    const hasLink = editor.isActive('link');
    if (!hasLink) {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: 'https://' })
        .run();
    }
    publishEditorEvent('link:edit-request', { focusInput: true });
  };

  if (!enabled || !visible) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text formatting"
      data-testid="selection-toolbar"
      className="selection-toolbar"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => {
        // Don't let mousedown collapse the active selection.
        event.preventDefault();
      }}
    >
      <ToolbarButton
        label="Bold"
        shortcut="Cmd+B"
        active={isActive('bold')}
        onClick={toggle('bold')}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        shortcut="Cmd+I"
        active={isActive('italic')}
        onClick={toggle('italic')}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        shortcut="Cmd+Shift+X"
        active={isActive('strike')}
        onClick={toggle('strike')}
      >
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        shortcut="Cmd+E"
        active={isActive('code')}
        onClick={toggle('code')}
      >
        <Code className="size-4" />
      </ToolbarButton>
      <span aria-hidden className="selection-toolbar-separator" />
      <ToolbarButton
        label="Link"
        active={isActive('link')}
        onClick={editLink}
      >
        <LinkIcon className="size-4" />
      </ToolbarButton>
    </div>,
    portalTarget,
  );
}

interface ToolbarButtonProps {
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, shortcut, active, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn('selection-toolbar-button', active && 'is-active')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default SelectionToolbar;
