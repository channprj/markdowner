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

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Position = { top: number; left: number };

const TOOLBAR_OFFSET_PX = 12;

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

    // Use ProseMirror coordinates: anchor/head can be in any direction, so we
    // use the start and end of the selection to compute a bounding box.
    const startCoords = view.coordsAtPos(from);
    const endCoords = view.coordsAtPos(to, 1);

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

  const promptForLink = () => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    const next = window.prompt('Enter URL', existing ?? 'https://');
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: trimmed })
      .run();
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
        onClick={promptForLink}
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
