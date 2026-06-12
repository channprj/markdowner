import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs, type TabsItem } from './Tabs';

function tabsItem(id: string, name: string): TabsItem {
  return { id, kind: 'document', name, isDirty: false, missing: false, shortcutLabel: null };
}

// jsdom has no DataTransfer — provide the minimal surface the handlers use.
function dataTransfer() {
  return { effectAllowed: '', dropEffect: '', setData: vi.fn() };
}

// jsdom lacks DragEvent, so fireEvent drops clientX from drag events. Build
// the event manually and pin the fields the component reads.
function fireDragEventAt(
  node: Element,
  type: 'dragOver' | 'drop',
  clientX: number,
  transfer: ReturnType<typeof dataTransfer>,
) {
  const event = createEvent[type](node);
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  fireEvent(node, event);
}

describe('Tabs drag reordering', () => {
  afterEach(cleanup);

  it('reorders by dragging a tab onto another tab half', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md'), tabsItem('c', 'gamma.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const target = screen.getByRole('tab', { name: /gamma\.md/i });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      width: 100,
    } as DOMRect);

    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'a');

    // Pointer on the right half of the target → insert after it.
    fireDragEventAt(target, 'dragOver', 280, transfer);
    fireDragEventAt(target, 'drop', 280, transfer);

    expect(onReorderTab).toHaveBeenCalledWith('a', 'c', true);
  });

  it('inserts before the target when dropped on its left half', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /beta\.md/i });
    const target = screen.getByRole('tab', { name: /alpha\.md/i });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);

    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireDragEventAt(target, 'dragOver', 10, transfer);
    fireDragEventAt(target, 'drop', 10, transfer);

    expect(onReorderTab).toHaveBeenCalledWith('b', 'a', false);
  });

  it('ignores drops onto the dragged tab itself', () => {
    const onReorderTab = vi.fn();
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md'), tabsItem('b', 'beta.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTab={onReorderTab}
      />,
    );

    const source = screen.getByRole('tab', { name: /alpha\.md/i });
    const transfer = dataTransfer();
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.drop(source, { dataTransfer: transfer, clientX: 10 });

    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('keeps tabs non-draggable when no reorder handler is provided', () => {
    render(
      <Tabs
        items={[tabsItem('a', 'alpha.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /alpha\.md/i })).toHaveAttribute(
      'draggable',
      'false',
    );
  });
});
