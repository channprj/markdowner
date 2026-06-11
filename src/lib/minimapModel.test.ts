import { describe, expect, it } from 'vitest';

import {
  MINIMAP_MIN_THUMB_PX,
  buildLineSpecs,
  computeMinimapLayout,
  minimapWidthPx,
  scrollTopForDragDelta,
  scrollTopForTrackJump,
} from './minimapModel';

describe('buildLineSpecs', () => {
  it('classifies markdown line kinds', () => {
    const specs = buildLineSpecs(
      ['# Title', '', '- item', '> quote', 'plain text'].join('\n'),
    );

    expect(specs.map((spec) => spec.kind)).toEqual([
      'heading',
      'blank',
      'list',
      'quote',
      'regular',
    ]);
  });

  it('classifies fenced code bodies as code, not just the fence lines', () => {
    const specs = buildLineSpecs(
      ['```js', 'const x = 1;', '# not a heading', '```', 'after'].join('\n'),
    );

    expect(specs.map((spec) => spec.kind)).toEqual([
      'code',
      'code',
      'code',
      'code',
      'regular',
    ]);
  });

  it('supports tilde fences', () => {
    const specs = buildLineSpecs(['~~~', 'body', '~~~'].join('\n'));

    expect(specs.map((spec) => spec.kind)).toEqual(['code', 'code', 'code']);
  });

  it('classifies four-space indented lines as code but keeps indented lists', () => {
    const specs = buildLineSpecs(['    indented code', '    - nested item'].join('\n'));

    expect(specs.map((spec) => spec.kind)).toEqual(['code', 'list']);
  });

  it('preserves leading indentation in render text and expands tabs', () => {
    const specs = buildLineSpecs(['  - item', '\tcode'].join('\n'));

    expect(specs[0].text).toBe('  - item');
    expect(specs[1].text).toBe('    code');
  });

  it('clips render text to a bounded column count', () => {
    const specs = buildLineSpecs('x'.repeat(500));

    expect(specs[0].text.length).toBeLessThanOrEqual(120);
  });
});

describe('computeMinimapLayout', () => {
  // 1000-line document: editor line height 20px (scrollHeight 20000),
  // viewport 1000px (50 visible lines), minimap 400px tall at 4px/line
  // (100 visible minimap lines). Max scrollTop = 19000.
  const overflowing = {
    totalLines: 1000,
    minimapHeightPx: 400,
    minimapLineHeightPx: 4,
    scrollHeight: 20000,
    clientHeight: 1000,
  };

  it('keeps the minimap anchored when scrolled to the top', () => {
    const layout = computeMinimapLayout({ ...overflowing, scrollTop: 0 });

    expect(layout.minimapScrollTopLines).toBe(0);
    expect(layout.thumbTopPx).toBe(0);
    expect(layout.thumbHeightPx).toBe(200);
    expect(layout.showThumb).toBe(true);
  });

  it('slides the minimap so both editor and minimap reach the end together', () => {
    const layout = computeMinimapLayout({ ...overflowing, scrollTop: 19000 });

    // minimap scrolls to totalLines - visibleMinimapLines = 900
    expect(layout.minimapScrollTopLines).toBeCloseTo(900);
    // thumb lands flush at the bottom: 400 - 200
    expect(layout.thumbTopPx).toBeCloseTo(200);
  });

  it('slides proportionally at mid-scroll', () => {
    const layout = computeMinimapLayout({ ...overflowing, scrollTop: 9500 });

    expect(layout.minimapScrollTopLines).toBeCloseTo(450);
    expect(layout.thumbTopPx).toBeCloseTo(100);
  });

  it('does not slide when the document fits inside the minimap', () => {
    // 50 lines at 4px = 200px of minimap content inside a 400px minimap.
    const layout = computeMinimapLayout({
      totalLines: 50,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
    });

    expect(layout.minimapScrollTopLines).toBe(0);
    expect(layout.thumbTopPx).toBeCloseTo(100);
    expect(layout.thumbHeightPx).toBeCloseTo(100);
  });

  it('clamps the thumb to the Zed minimum size', () => {
    const layout = computeMinimapLayout({
      totalLines: 10000,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollTop: 0,
      scrollHeight: 200000,
      clientHeight: 100,
    });

    expect(layout.thumbHeightPx).toBe(MINIMAP_MIN_THUMB_PX);
  });

  it('hides the thumb when the editor has nothing to scroll', () => {
    const layout = computeMinimapLayout({
      totalLines: 10,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollTop: 0,
      scrollHeight: 300,
      clientHeight: 300,
    });

    expect(layout.showThumb).toBe(false);
  });

  it('bounds the visible line range to the document', () => {
    const layout = computeMinimapLayout({ ...overflowing, scrollTop: 19000 });

    expect(layout.firstVisibleLine).toBe(900);
    expect(layout.lastVisibleLine).toBe(999);
  });

  it('is safe on empty documents', () => {
    const layout = computeMinimapLayout({
      totalLines: 0,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
    });

    expect(layout.minimapScrollTopLines).toBe(0);
    expect(layout.showThumb).toBe(false);
  });
});

describe('scrollTopForTrackJump', () => {
  const overflowing = {
    totalLines: 1000,
    minimapHeightPx: 400,
    minimapLineHeightPx: 4,
    scrollHeight: 20000,
    clientHeight: 1000,
  };

  it('centers the thumb on the click point (Zed jump-then-grab)', () => {
    // thumbHeight 200 → top = 200 - 100 = 100 → 25 lines → 500px.
    const next = scrollTopForTrackJump({
      ...overflowing,
      scrollTop: 0,
      clickYPx: 200,
    });

    expect(next).toBeCloseTo(500);
  });

  it('clamps at the document start', () => {
    const next = scrollTopForTrackJump({
      ...overflowing,
      scrollTop: 0,
      clickYPx: 0,
    });

    expect(next).toBe(0);
  });

  it('clamps at the maximum editor scroll', () => {
    const next = scrollTopForTrackJump({
      ...overflowing,
      scrollTop: 19000,
      clickYPx: 400,
    });

    expect(next).toBeLessThanOrEqual(19000);
  });
});

describe('scrollTopForDragDelta', () => {
  it('traverses the whole document when dragging the full minimap height', () => {
    // pixelsPerLine = min(400 / 1000, 4) = 0.4 → 400px drag = 1000 lines.
    const next = scrollTopForDragDelta({
      totalLines: 1000,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollHeight: 20000,
      clientHeight: 1000,
      startScrollTop: 0,
      deltaYPx: 400,
    });

    expect(next).toBe(19000);
  });

  it('tracks the minimap scale when the document fits the minimap', () => {
    // pixelsPerLine = min(400 / 50, 4) = 4 → 40px drag = 10 lines = 200px.
    const next = scrollTopForDragDelta({
      totalLines: 50,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollHeight: 1000,
      clientHeight: 500,
      startScrollTop: 0,
      deltaYPx: 40,
    });

    expect(next).toBeCloseTo(200);
  });

  it('clamps to the scrollable range', () => {
    const next = scrollTopForDragDelta({
      totalLines: 50,
      minimapHeightPx: 400,
      minimapLineHeightPx: 4,
      scrollHeight: 1000,
      clientHeight: 500,
      startScrollTop: 450,
      deltaYPx: 100,
    });

    expect(next).toBe(500);
  });
});

describe('minimapWidthPx', () => {
  it('caps at the 80-column width on wide panes', () => {
    expect(minimapWidthPx(1000)).toBe(96);
  });

  it('uses 15% of the pane width on narrow panes', () => {
    expect(minimapWidthPx(400)).toBe(60);
  });

  it('hides entirely below the minimum width', () => {
    expect(minimapWidthPx(150)).toBe(0);
  });
});
