import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    view: {
      dom,
      hasFocus: () => true,
      coordsAtPos: () => ({ top: 88, bottom: 110, left: 120, right: 220 }),
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
