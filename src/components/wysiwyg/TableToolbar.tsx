import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  PanelBottomDashed,
  PanelLeftDashed,
  PanelRightDashed,
  PanelTop,
  PanelTopDashed,
  TableProperties,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  editor: Editor | null;
  /** When false, listeners are detached and nothing is rendered. */
  enabled?: boolean;
}

type Position = { top: number; left: number };
type TableCommand =
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'deleteTable'
  | 'toggleHeaderRow';

const TOOLBAR_OFFSET_PX = 10;

export function TableToolbar({ editor, enabled = true }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const computePosition = useCallback((): Position | null => {
    if (!editor || !editor.isActive('table')) return null;
    const { state, view } = editor;
    if (!view.hasFocus()) return null;

    // The toolbar stays available for both a caret (TextSelection) and a
    // multi-cell drag (CellSelection): prosemirror-tables resolves add/delete
    // against the selection's edge deterministically, so there is no ambiguity
    // and the user keeps access to the controls while a span is selected.
    const { from, to } = state.selection;
    let startCoords: { top: number; bottom: number; left: number };
    let endCoords: { top: number; bottom: number; right: number };
    try {
      startCoords = view.coordsAtPos(from);
      endCoords = view.coordsAtPos(to, 1);
    } catch {
      // Adding/removing rows or columns briefly leaves the view without
      // measurable geometry. Hide for this frame; the table 'update' event
      // we listen to will re-fire once the new structure has laid out.
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

  useEffect(() => {
    if (!editor || !enabled) {
      setVisible(false);
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
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
      window.setTimeout(() => {
        const active = document.activeElement;
        if (toolbarRef.current && active && toolbarRef.current.contains(active)) return;
        setVisible(false);
      }, 50);
    };

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('update', schedule);
    editor.on('blur', handleBlur);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('update', schedule);
      editor.off('blur', handleBlur);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor, enabled, computePosition]);

  // NOTE: stale-cell-selection / accidental-drag handling now lives entirely
  // in the PreventTableHoverSelection ProseMirror plugin (pointer-tracked,
  // engine-robust). The toolbar used to run its own mousedown/mousemove/
  // mouseup threshold tracking here, which double-handled the gesture and
  // fought prosemirror-tables in WebKit. Removed.

  const runCommand = (command: TableCommand) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (command) {
      case 'addColumnBefore':
        chain.addColumnBefore().run();
        break;
      case 'addColumnAfter':
        chain.addColumnAfter().run();
        break;
      case 'deleteColumn':
        chain.deleteColumn().run();
        break;
      case 'addRowBefore':
        chain.addRowBefore().run();
        break;
      case 'addRowAfter':
        chain.addRowAfter().run();
        break;
      case 'deleteRow':
        chain.deleteRow().run();
        break;
      case 'deleteTable':
        chain.deleteTable().run();
        break;
      case 'toggleHeaderRow':
        chain.toggleHeaderRow().run();
        break;
    }
  };

  if (!enabled || !visible) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Table editing"
      data-testid="table-toolbar"
      className="table-toolbar"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <TableToolbarButton
        label="Add column before"
        onClick={() => runCommand('addColumnBefore')}
      >
        <PanelLeftDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Add column after"
        onClick={() => runCommand('addColumnAfter')}
      >
        <PanelRightDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Delete column"
        danger
        onClick={() => runCommand('deleteColumn')}
      >
        <Trash2 className="size-4" />
      </TableToolbarButton>
      <span aria-hidden className="table-toolbar-separator" />
      <TableToolbarButton
        label="Add row before"
        onClick={() => runCommand('addRowBefore')}
      >
        <PanelTopDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Add row after"
        onClick={() => runCommand('addRowAfter')}
      >
        <PanelBottomDashed className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Delete row"
        danger
        onClick={() => runCommand('deleteRow')}
      >
        <Trash2 className="size-4" />
      </TableToolbarButton>
      <span aria-hidden className="table-toolbar-separator" />
      <TableToolbarButton
        label="Toggle header row"
        onClick={() => runCommand('toggleHeaderRow')}
      >
        <PanelTop className="size-4" />
      </TableToolbarButton>
      <TableToolbarButton
        label="Delete table"
        danger
        onClick={() => runCommand('deleteTable')}
      >
        <TableProperties className="size-4" />
      </TableToolbarButton>
    </div>,
    portalTarget,
  );
}

interface TableToolbarButtonProps {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function TableToolbarButton({ label, danger = false, onClick, children }: TableToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('table-toolbar-button', danger && 'is-danger')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default TableToolbar;
