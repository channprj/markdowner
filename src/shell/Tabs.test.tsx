import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs, type TabsItem } from './Tabs';

const TAB_WIDTH = 100;

function tabsItem(id: string, name: string): TabsItem {
  return { id, kind: 'document', name, isDirty: false, missing: false, shortcutLabel: null };
}

function renderTabs(
  ids: string[],
  handlers: {
    onSelectTab?: () => void;
    onCloseTab?: () => void;
    onReorderTab?: ((sourceId: string, index: number) => void) | undefined;
  } = {},
) {
  const { onReorderTab = vi.fn() } = handlers;
  render(
    <Tabs
      items={ids.map((id) => tabsItem(id, `${id}.md`))}
      activeTabId={ids[0] ?? null}
      onSelectTab={handlers.onSelectTab ?? vi.fn()}
      onCloseTab={handlers.onCloseTab ?? vi.fn()}
      onReorderTab={onReorderTab}
    />,
  );
  return onReorderTab;
}

/**
 * jsdom lays everything out at zero, so pin the geometry the drag reads: equal
 * tabs of `TAB_WIDTH` packed from content x=0 inside a 400px strip.
 */
function layoutStrip() {
  const strip = screen.getByRole('tablist', { name: /open documents/i }) as HTMLDivElement;
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 400,
    width: 400,
  } as DOMRect);
  screen.getAllByRole('tab').forEach((tab, index) => {
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({
      left: index * TAB_WIDTH,
      right: (index + 1) * TAB_WIDTH,
      width: TAB_WIDTH,
    } as DOMRect);
  });
  return strip;
}

function tab(id: string) {
  return screen.getByRole('tab', { name: new RegExp(`${id}\\.md`, 'i') });
}

/** Presses the middle of the tab at `index` and reports its centre x. */
function pressTab(index: number, id: string) {
  const clientX = index * TAB_WIDTH + TAB_WIDTH / 2;
  fireEvent.pointerDown(tab(id), {
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX,
  });
  return clientX;
}

function movePointer(clientX: number) {
  fireEvent.pointerMove(document, { pointerId: 1, clientX });
}

function releasePointer() {
  fireEvent.pointerUp(document, { pointerId: 1 });
}

describe('Tabs drag reordering', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('moves a tab forward once it is dragged half over its neighbour', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(160);
    releasePointer();

    expect(onReorderTab).toHaveBeenCalledOnce();
    expect(onReorderTab).toHaveBeenCalledWith('a', 1);
  });

  it('moves a tab backward to the first slot', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(2, 'c');
    movePointer(60);
    releasePointer();

    expect(onReorderTab).toHaveBeenCalledWith('c', 0);
  });

  it('moves a tab to the end when dragged past the final tab', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(600);
    releasePointer();

    expect(onReorderTab).toHaveBeenCalledWith('a', 2);
  });

  it('slides the displaced neighbour aside while the drag is still in flight', () => {
    renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(160);

    // The dragged tab tracks the pointer with no transition of its own.
    expect(tab('a')).toHaveAttribute('data-tab-dragging');
    expect(tab('a').style.transform).toBe('translateX(110px)');
    expect(tab('a').style.transition).toBe('');
    // Its neighbour animates out of the way by exactly one tab width.
    expect(tab('b').style.transform).toBe('translateX(-100px)');
    expect(tab('b').style.transition).toBe('transform 130ms ease-out');
    // Untouched tabs stay put.
    expect(tab('c').style.transform).toBe('');
  });

  it('commits a single reorder no matter how far the pointer wandered', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(160);
    movePointer(280);
    movePointer(220);
    movePointer(160);
    releasePointer();

    expect(onReorderTab).toHaveBeenCalledOnce();
    expect(onReorderTab).toHaveBeenCalledWith('a', 1);
  });

  it('does not reorder before the dragged tab is half over its neighbour', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(90);

    expect(tab('a').style.transform).toBe('translateX(40px)');
    expect(tab('b').style.transform).toBe('');

    releasePointer();
    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('treats a press that barely moves as a click rather than a drag', () => {
    const onSelectTab = vi.fn();
    const onReorderTab = renderTabs(['a', 'b', 'c'], { onSelectTab });
    layoutStrip();

    pressTab(0, 'a');
    movePointer(52);
    releasePointer();
    fireEvent.click(tab('a'));

    expect(onReorderTab).not.toHaveBeenCalled();
    expect(tab('a')).not.toHaveAttribute('data-tab-dragging');
    expect(onSelectTab).toHaveBeenCalledWith('a');
  });

  it('does not switch documents when a tab is dragged', () => {
    const onSelectTab = vi.fn();
    renderTabs(['a', 'b', 'c'], { onSelectTab });
    layoutStrip();

    pressTab(1, 'b');
    movePointer(280);
    releasePointer();
    fireEvent.click(tab('b'));

    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it('blocks the text selection WebKit starts when a press becomes a drag', () => {
    renderTabs(['a', 'b', 'c']);
    layoutStrip();

    const idle = new Event('selectstart', { bubbles: true, cancelable: true });
    document.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    pressTab(0, 'a');
    movePointer(160);
    const during = new Event('selectstart', { bubbles: true, cancelable: true });
    document.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    releasePointer();
    const after = new Event('selectstart', { bubbles: true, cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('selects a tab on a plain click', () => {
    const onSelectTab = vi.fn();
    renderTabs(['a', 'b', 'c'], { onSelectTab });

    fireEvent.click(tab('b'));

    expect(onSelectTab).toHaveBeenCalledWith('b');
  });

  it('cancels a drag on Escape without reordering or leaving transforms behind', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(160);
    expect(tab('b').style.transform).toBe('translateX(-100px)');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onReorderTab).not.toHaveBeenCalled();
    expect(tab('a')).not.toHaveAttribute('data-tab-dragging');
    expect(tab('a').style.transform).toBe('');
    expect(tab('b').style.transform).toBe('');

    // The cancelled pointer must not commit anything when it is finally released.
    releasePointer();
    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('cancels a drag when the window loses focus', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(160);
    fireEvent.blur(window);

    expect(onReorderTab).not.toHaveBeenCalled();
    expect(tab('a').style.transform).toBe('');
  });

  it('cancels a drag when the pointer is cancelled', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(160);
    fireEvent.pointerCancel(document, { pointerId: 1 });

    expect(onReorderTab).not.toHaveBeenCalled();
    expect(tab('a').style.transform).toBe('');
  });

  it('does not start a drag from the close button', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    fireEvent.pointerDown(screen.getAllByRole('button', { name: /close tab/i })[0], {
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 90,
    });
    movePointer(280);
    releasePointer();

    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('ignores non-primary buttons and touch contacts', () => {
    const onReorderTab = renderTabs(['a', 'b', 'c']);
    layoutStrip();

    fireEvent.pointerDown(tab('a'), {
      button: 2,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 50,
    });
    movePointer(280);
    releasePointer();

    fireEvent.pointerDown(tab('a'), {
      button: 0,
      pointerId: 2,
      pointerType: 'touch',
      clientX: 50,
    });
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 280 });
    fireEvent.pointerUp(document, { pointerId: 2 });

    expect(onReorderTab).not.toHaveBeenCalled();
  });

  it('leaves tabs undraggable when no reorder handler is provided', () => {
    render(
      <Tabs
        items={[tabsItem('a', 'a.md'), tabsItem('b', 'b.md')]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );
    layoutStrip();

    pressTab(0, 'a');
    movePointer(280);

    expect(tab('a')).not.toHaveClass('cursor-grab');
    expect(tab('a')).not.toHaveAttribute('data-tab-dragging');
    expect(tab('a').style.transform).toBe('');
  });

  it('cannot reorder a single-tab strip', () => {
    const onReorderTab = renderTabs(['a']);
    layoutStrip();

    pressTab(0, 'a');
    movePointer(280);
    releasePointer();

    expect(onReorderTab).not.toHaveBeenCalled();
    expect(tab('a').style.transform).toBe('');
  });

  it('scrolls an overflowing strip near either edge and stops at drag end', () => {
    let runFrame: FrameRequestCallback = () => {
      throw new Error('requestAnimationFrame callback was not scheduled');
    };
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        runFrame = callback;
        return 41;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);

    renderTabs(['a', 'b', 'c']);
    const strip = layoutStrip();
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, value: 300, writable: true },
    });
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 300,
      width: 300,
    } as DOMRect);

    pressTab(1, 'b');
    movePointer(4);
    expect(requestFrame).toHaveBeenCalled();

    const beforeLeftScroll = strip.scrollLeft;
    act(() => runFrame(16));
    expect(strip.scrollLeft).toBeLessThan(beforeLeftScroll);

    const beforeRightScroll = strip.scrollLeft;
    movePointer(296);
    act(() => runFrame(32));
    expect(strip.scrollLeft).toBeGreaterThan(beforeRightScroll);

    releasePointer();
    expect(cancelFrame).toHaveBeenCalledWith(41);
  });

  it('does not scroll a strip that fits its tabs', () => {
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 41);

    renderTabs(['a', 'b', 'c']);
    const strip = layoutStrip();
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 400 },
      scrollWidth: { configurable: true, value: 300 },
    });

    pressTab(1, 'b');
    movePointer(4);

    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('renders the Export Preview application tab with its own icon', () => {
    render(
      <Tabs
        items={[
          {
            ...tabsItem('__markdowner_export_preview__', 'Export Preview'),
            kind: 'export',
          },
        ]}
        activeTabId="__markdowner_export_preview__"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /Export Preview/ }).querySelectorAll('svg')).toHaveLength(2);
  });
});

describe('Tabs overflow navigation', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** A 300px strip showing content x=`scrollLeft`..+300 of 900px of tabs. */
  function overflowStrip(scrollLeft: number) {
    const strip = layoutStrip();
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, value: scrollLeft, writable: true },
    });
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 300,
      width: 300,
    } as DOMRect);
    strip.scrollBy = vi.fn() as typeof strip.scrollBy;
    fireEvent.scroll(strip);
    return strip;
  }

  it('shows no scroll arrows while every tab fits', () => {
    renderTabs(['a', 'b', 'c']);

    expect(screen.queryByRole('button', { name: /scroll tabs/i })).toBeNull();
  });

  it('offers arrows that page the strip and disable at its edges', () => {
    renderTabs(['a', 'b', 'c']);
    const strip = overflowStrip(0);

    const left = screen.getByRole('button', { name: /scroll tabs left/i });
    const right = screen.getByRole('button', { name: /scroll tabs right/i });
    expect(left).toBeDisabled();
    expect(right).toBeEnabled();

    fireEvent.click(right);
    expect(strip.scrollBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 240 }),
    );

    strip.scrollLeft = 600;
    fireEvent.scroll(strip);
    expect(left).toBeEnabled();
    expect(right).toBeDisabled();

    fireEvent.click(left);
    expect(strip.scrollBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: -240 }),
    );
  });

  it('scrolls the strip sideways with a vertical mouse wheel', () => {
    renderTabs(['a', 'b', 'c']);
    const strip = overflowStrip(0);

    fireEvent.wheel(strip, { deltaY: 120 });

    expect(strip.scrollLeft).toBe(120);
  });

  it('scrolls a newly activated tab into view on either side', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => tabsItem(id, `${id}.md`));
    const renderWith = (activeTabId: string) => (
      <Tabs items={items} activeTabId={activeTabId} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />
    );
    const { rerender } = render(renderWith('a'));
    const strip = overflowStrip(0);

    // Tab f spans x=500..600, 300px past the strip's right edge.
    rerender(renderWith('f'));
    expect(strip.scrollLeft).toBe(300);

    // jsdom rects ignore scrolling, so place tab b 200px left of the strip by hand.
    vi.spyOn(tab('b'), 'getBoundingClientRect').mockReturnValue({
      left: -200,
      right: -100,
      width: 100,
    } as DOMRect);
    rerender(renderWith('b'));
    expect(strip.scrollLeft).toBe(100);
  });
});
