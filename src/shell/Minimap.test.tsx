import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Minimap } from './Minimap';

/**
 * Builds a fake scrollable editor element. jsdom reports zero geometry, so
 * scrollHeight/clientHeight are defined explicitly; scrollTop stays a plain
 * writable property the component can assign.
 */
function createScrollEl(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  el.scrollTop = 0;
  document.body.appendChild(el);
  return el;
}

/** Gives the minimap root real geometry for event-time measurements. */
function sizeMinimapRoot(root: HTMLElement, height: number) {
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: height });
  root.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 96,
      bottom: height,
      width: 96,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

// 1000-line doc, editor line height 20px, viewport 50 lines, minimap 400px
// at lineHeight=2 → mini line height 4px (100 visible minimap lines).
const DOC = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');

function renderMinimap(scrollEl: HTMLElement) {
  const utils = render(<Minimap text={DOC} scrollEl={scrollEl} lineHeight={2} />);
  const root = screen.getByTestId('editor-minimap');
  sizeMinimapRoot(root, 400);
  return { ...utils, root };
}

describe('Minimap (Zed-style canvas renderer)', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders a canvas layer instead of per-line DOM bars', () => {
    const scrollEl = createScrollEl(20000, 1000);
    const { root } = renderMinimap(scrollEl);

    expect(root.querySelector('canvas.minimap-canvas')).not.toBeNull();
    expect(root.querySelector('.minimap-row')).toBeNull();
  });

  it('shows the viewport thumb only when the editor can scroll', () => {
    const scrollable = createScrollEl(20000, 1000);
    const { unmount, root } = renderMinimap(scrollable);
    expect(root.querySelector('.minimap-viewport')).not.toBeNull();
    unmount();

    const fits = createScrollEl(300, 300);
    render(<Minimap text={'a\nb'} scrollEl={fits} lineHeight={2} />);
    const fittingRoot = screen.getByTestId('editor-minimap');
    expect(fittingRoot.querySelector('.minimap-viewport')).toBeNull();
  });

  it('jumps so the thumb centers on a track click (Zed jump-then-grab)', () => {
    const scrollEl = createScrollEl(20000, 1000);
    const { root } = renderMinimap(scrollEl);

    // thumb is [0, 200]; clicking at 300 → top = 300 - 100 = 200 → 50 lines
    // at 20px editor lines = 1000px.
    fireEvent.mouseDown(root, { button: 0, clientY: 300 });

    expect(scrollEl.scrollTop).toBeCloseTo(1000);
  });

  it('drags the thumb with Zed delta math without an initial jump', () => {
    const scrollEl = createScrollEl(20000, 1000);
    const { root } = renderMinimap(scrollEl);

    // mousedown inside the thumb [0, 200): no jump.
    fireEvent.mouseDown(root, { button: 0, clientY: 100 });
    expect(scrollEl.scrollTop).toBe(0);

    // pixelsPerLine = min(400/1000, 4) = 0.4 → +50px = 125 lines = 2500px.
    fireEvent.mouseMove(document, { clientY: 150 });
    expect(scrollEl.scrollTop).toBeCloseTo(2500);

    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientY: 400 });
    expect(scrollEl.scrollTop).toBeCloseTo(2500);
  });

  it('publishes its width to the parent through --minimap-width', () => {
    const scrollEl = createScrollEl(20000, 1000);
    const { root } = renderMinimap(scrollEl);
    const parent = root.parentElement as HTMLElement;

    // jsdom parents measure 0 wide → fall back to the 80-column cap.
    expect(parent.style.getPropertyValue('--minimap-width')).toBe('96px');
  });

  it('hides entirely when the pane is too narrow (Zed min-width rule)', () => {
    const scrollEl = createScrollEl(20000, 1000);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 150 });
    document.body.appendChild(container);

    render(<Minimap text={DOC} scrollEl={scrollEl} lineHeight={2} />, { container });
    const root = screen.getByTestId('editor-minimap');

    expect(root.style.display).toBe('none');
    expect(container.style.getPropertyValue('--minimap-width')).toBe('0px');
  });

  it('survives a null scroll element', () => {
    render(<Minimap text={DOC} scrollEl={null} lineHeight={2} />);

    expect(screen.getByTestId('editor-minimap')).toBeInTheDocument();
  });
});
