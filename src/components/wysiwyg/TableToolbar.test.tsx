import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { tableEditingKey } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreventTableHoverSelection } from './preventTableHoverSelection';
import { TableToolbar } from './TableToolbar';

type CommandName =
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'deleteTable'
  | 'toggleHeaderRow'
  | 'toggleHeaderColumn';

function createTableEditor({ inTable = true } = {}) {
  const handlers = new Map<string, Set<() => void>>();
  const calls: CommandName[] = [];
  const dom = document.createElement('div');
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  const row = document.createElement('tr');
  const cell = document.createElement('td');

  cell.textContent = 'Cell';
  row.appendChild(cell);
  tbody.appendChild(row);
  table.appendChild(tbody);
  dom.appendChild(table);

  const chain: Record<string, any> = {
    focus: vi.fn(() => chain),
    run: vi.fn(() => true),
  };

  const addCommand = (name: CommandName) => {
    chain[name] = vi.fn(() => {
      calls.push(name);
      return chain;
    });
  };

  ([
    'addColumnBefore',
    'addColumnAfter',
    'deleteColumn',
    'addRowBefore',
    'addRowAfter',
    'deleteRow',
    'deleteTable',
    'toggleHeaderRow',
    'toggleHeaderColumn',
  ] as CommandName[]).forEach(addCommand);

  const editor: any = {
    calls,
    state: {
      selection: {
        from: 5,
        to: 5,
        empty: true,
      },
    },
    commands: {
      setTextSelection: vi.fn(),
    },
    tableCell: cell,
    view: {
      dom,
      hasFocus: () => true,
      coordsAtPos: () => ({ top: 88, bottom: 110, left: 120, right: 220 }),
      focus: vi.fn(),
    },
    isActive: vi.fn((name: string) => name === 'table' && inTable),
    on: vi.fn((name: string, handler: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(handler);
    }),
    off: vi.fn((name: string, handler: () => void) => {
      handlers.get(name)?.delete(handler);
    }),
    chain: vi.fn(() => chain),
    emit: (name: string) => {
      handlers.get(name)?.forEach((handler) => handler());
    },
  };

  return editor;
}

function buildRealTableEditor(): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PreventTableHoverSelection,
    ],
    content: '<p>x</p>',
  });
  editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
  return editor;
}

function cellPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') out.push(pos);
    return true;
  });
  return out;
}

function dimensions(editor: Editor): [number, number] {
  let rows = 0;
  let cols = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableRow') {
      rows += 1;
      if (rows === 1) cols = node.childCount;
    }
    return true;
  });
  return [rows, cols];
}

function tableCount(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') count += 1;
    return true;
  });
  return count;
}

describe('TableToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('exposes row and column editing commands when the WYSIWYG selection is inside a table', async () => {
    const editor = createTableEditor();

    render(<TableToolbar editor={editor} />);

    act(() => {
      editor.emit('selectionUpdate');
    });

    const toolbar = await screen.findByRole('toolbar', { name: /table editing/i });

    fireEvent.click(within(toolbar).getByRole('button', { name: /add column after/i }));
    fireEvent.click(within(toolbar).getByRole('button', { name: /add row after/i }));

    expect(editor.calls).toEqual(['addColumnAfter', 'addRowAfter']);
  });

  it('runs table commands on mouse down so WebKit toolbar clicks cannot lose the table selection before click', async () => {
    const editor = createTableEditor();

    render(<TableToolbar editor={editor} />);

    act(() => {
      editor.emit('selectionUpdate');
    });

    const toolbar = await screen.findByRole('toolbar', { name: /table editing/i });

    fireEvent.mouseDown(within(toolbar).getByRole('button', { name: /add row after/i }), {
      button: 0,
    });

    expect(editor.calls).toEqual(['addRowAfter']);
  });

  it('uses directional panel icons for row and column insert actions', async () => {
    const editor = createTableEditor();

    render(<TableToolbar editor={editor} />);

    act(() => {
      editor.emit('selectionUpdate');
    });

    const toolbar = await screen.findByRole('toolbar', { name: /table editing/i });

    expect(
      within(toolbar)
        .getByRole('button', { name: /add column before/i })
        .querySelector('.lucide-panel-left-dashed'),
    ).not.toBeNull();
    expect(
      within(toolbar)
        .getByRole('button', { name: /add column after/i })
        .querySelector('.lucide-panel-right-dashed'),
    ).not.toBeNull();
    expect(
      within(toolbar)
        .getByRole('button', { name: /add row before/i })
        .querySelector('.lucide-panel-top-dashed'),
    ).not.toBeNull();
    expect(
      within(toolbar)
        .getByRole('button', { name: /add row after/i })
        .querySelector('.lucide-panel-bottom-dashed'),
    ).not.toBeNull();
  });

  it('keeps the row and column popup available during a multi-cell selection', async () => {
    // prosemirror-tables resolves add/delete against the selection edge
    // deterministically, so the controls stay usable while a span is selected
    // (hiding them was a leftover guard from the old accidental-drag bug).
    const editor = createTableEditor();

    editor.state.selection = {
      from: 5,
      to: 12,
      empty: false,
      $anchorCell: { pos: 5 },
      $headCell: { pos: 12 },
    };

    render(<TableToolbar editor={editor} />);

    act(() => {
      editor.emit('selectionUpdate');
    });

    const toolbar = await screen.findByRole('toolbar', { name: /table editing/i });
    expect(within(toolbar).getByRole('button', { name: /add column after/i })).toBeInTheDocument();
  });

  it('applies real Tiptap row insertion and table deletion from toolbar clicks after stale drag teardown', async () => {
    const editor = buildRealTableEditor();
    const host = editor.view.dom.parentElement;
    (editor.view as any).hasFocus = () => true;
    (editor.view as any).coordsAtPos = () => ({
      top: 88,
      bottom: 110,
      left: 120,
      right: 220,
    });

    try {
      const cells = cellPositions(editor);
      editor.chain().setTextSelection(cells[2] + 1).run();

      render(<TableToolbar editor={editor as any} />);

      const toolbar = await screen.findByRole('toolbar', { name: /table editing/i });
      const addRowAfter = within(toolbar).getByRole('button', { name: /add row after/i });

      editor.view.dispatch(editor.state.tr.setMeta(tableEditingKey, cells[2]));
      fireEvent.mouseMove(addRowAfter, {
        buttons: 0,
        clientX: 180,
        clientY: 40,
      });
      fireEvent.click(addRowAfter);

      expect(dimensions(editor)).toEqual([3, 2]);

      fireEvent.click(within(toolbar).getByRole('button', { name: /delete table/i }));

      expect(tableCount(editor)).toBe(0);
    } finally {
      editor.destroy();
      host?.remove();
    }
  });

  // Accidental-drag suppression + click-only cell-selection collapse moved
  // out of TableToolbar into the PreventTableHoverSelection ProseMirror
  // plugin (pointer-tracked, engine-robust). Covered by
  // preventTableHoverSelection.test.ts.

  it('stays hidden when the WYSIWYG selection is outside a table', async () => {
    const editor = createTableEditor({ inTable: false });

    render(<TableToolbar editor={editor} />);

    act(() => {
      editor.emit('selectionUpdate');
    });

    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: /table editing/i })).not.toBeInTheDocument();
    });
  });
});
