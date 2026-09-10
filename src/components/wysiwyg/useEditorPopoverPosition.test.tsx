import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditorPopoverPosition } from './useEditorPopoverPosition';

describe('floating editor panel', () => {
  it('avoids the current line on open, editor scroll, content growth, and selection changes', () => {
    let lineTop = 600;
    let contentHeight = 300;
    const dom = document.createElement('div');
    vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 80, 800, 600));
    const handlers = new Map<string, () => void>();
    const editor = {
      state: { selection: { from: 1, to: 1, head: 1 } },
      view: { dom, coordsAtPos: () => ({ left: 300, right: 300, top: lineTop, bottom: lineTop + 24 }) },
      on: (name: string, callback: () => void) => handlers.set(name, callback),
      off: (name: string) => handlers.delete(name),
    } as unknown as Editor;

    function Panel() {
      const ref = useRef<HTMLElement | null>(null);
      const position = useEditorPopoverPosition(editor, ref);
      return <section data-testid="panel" ref={element => {
        ref.current = element;
        if (element) {
          element.getBoundingClientRect = () => new DOMRect(
            Number.parseFloat(element.style.left) || 0,
            Number.parseFloat(element.style.top) || 0,
            480, Math.min(contentHeight, Number.parseFloat(element.style.maxHeight) || contentHeight),
          );
          Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => contentHeight });
        }
      }} style={position ?? undefined} />;
    }
    const { rerender, unmount } = render(<Panel />);
    const check = () => {
      const rect = screen.getByTestId('panel').getBoundingClientRect();
      expect(rect.bottom <= lineTop - 8 || rect.top >= lineTop + 32).toBe(true);
      expect(rect.top).toBeGreaterThanOrEqual(88);
      expect(rect.bottom).toBeLessThanOrEqual(672);
    };
    check();
    lineTop = 100;
    fireEvent.scroll(window);
    check();
    contentHeight = 900;
    rerender(<Panel />);
    check();
    lineTop = 340;
    act(() => handlers.get('selectionUpdate')?.());
    check();
    unmount();
    expect(handlers.size).toBe(0);
  });
});
