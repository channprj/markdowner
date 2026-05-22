import { describe, expect, it, vi } from 'vitest';

import { resolveSourceSurfaceMouseDown } from './sourceEditorInteractions';

function buildView({
  posAtCoords,
  length = 42,
}: {
  posAtCoords?: (coords: { x: number; y: number }, precise: boolean) => number | null;
  length?: number;
} = {}) {
  const dom = document.createElement('div');
  const child = document.createElement('span');
  dom.append(child);

  return {
    dom,
    child,
    view: {
      dom,
      posAtCoords: vi.fn(posAtCoords ?? (() => 7)),
      state: {
        doc: { length },
      },
    },
  };
}

describe('resolveSourceSurfaceMouseDown', () => {
  it('ignores clicks without a source view, outside source modes, or inside CodeMirror', () => {
    const { child, view } = buildView();

    expect(
      resolveSourceSurfaceMouseDown({
        currentMode: 'Editor',
        view: null,
        target: child,
        clientX: 12,
        clientY: 24,
      }),
    ).toEqual({ kind: 'ignore' });

    expect(
      resolveSourceSurfaceMouseDown({
        currentMode: 'Wysiwyg',
        view,
        target: child,
        clientX: 12,
        clientY: 24,
      }),
    ).toEqual({ kind: 'ignore' });

    expect(
      resolveSourceSurfaceMouseDown({
        currentMode: 'Editor',
        view,
        target: child,
        clientX: 12,
        clientY: 24,
      }),
    ).toEqual({ kind: 'ignore' });
  });

  it('maps wrapper padding clicks through CodeMirror coordinates', () => {
    const { view } = buildView({
      posAtCoords: ({ x, y }, precise) => (x === 12 && y === 24 && precise === false ? 9 : null),
    });
    const target = document.createElement('button');

    expect(
      resolveSourceSurfaceMouseDown({
        currentMode: 'SplitView',
        view,
        target,
        clientX: 12,
        clientY: 24,
      }),
    ).toEqual({
      kind: 'focusSource',
      position: 9,
    });
    expect(view.posAtCoords).toHaveBeenCalledWith({ x: 12, y: 24 }, false);
  });

  it('falls back to the document end when CodeMirror cannot resolve coordinates', () => {
    const { view } = buildView({
      posAtCoords: () => null,
      length: 88,
    });

    expect(
      resolveSourceSurfaceMouseDown({
        currentMode: 'Editor',
        view,
        target: document.createElement('div'),
        clientX: 0,
        clientY: 0,
      }),
    ).toEqual({
      kind: 'focusSource',
      position: 88,
    });
  });
});
