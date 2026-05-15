import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlashCommandMenu } from './SlashCommandMenu';

function createSlashEditor() {
  const handlers = new Map<string, Set<() => void>>();
  const dom = document.createElement('div');

  const editor: any = {
    state: {
      selection: {
        from: 2,
        to: 2,
        empty: true,
        $from: {
          depth: 1,
          start: () => 1,
        },
      },
      doc: {
        textBetween: () => '/',
      },
    },
    view: {
      dom,
      coordsAtPos: () => ({ top: 24, bottom: 42, left: 18, right: 18 }),
    },
    on: vi.fn((name: string, handler: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(handler);
    }),
    off: vi.fn((name: string, handler: () => void) => {
      handlers.get(name)?.delete(handler);
    }),
    emit: (name: string) => {
      handlers.get(name)?.forEach((handler) => handler());
    },
  };

  return editor;
}

describe('SlashCommandMenu', () => {
  const scrollCalls: Array<{ text: string; options: ScrollIntoViewOptions | boolean | undefined }> =
    [];
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    scrollCalls.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(function scrollIntoView(
        this: HTMLElement,
        options?: ScrollIntoViewOptions | boolean,
      ) {
        scrollCalls.push({ text: this.textContent ?? '', options });
      }),
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it('scrolls the newly active item into view while navigating with arrow keys', async () => {
    const editor = createSlashEditor();

    render(<SlashCommandMenu editor={editor} />);

    act(() => {
      editor.emit('update');
    });

    expect(await screen.findByRole('menu', { name: /insert block/i })).toBeInTheDocument();

    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    }

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /table/i })).toHaveAttribute(
        'data-active',
        'true',
      );
    });

    const lastScrollCall = scrollCalls[scrollCalls.length - 1];
    expect(lastScrollCall?.text).toMatch(/table/i);
    expect(lastScrollCall?.options).toEqual({ block: 'nearest' });
  });
});
