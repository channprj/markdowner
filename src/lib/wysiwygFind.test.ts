import { describe, expect, it, vi } from 'vitest';

import {
  centeredScrollTop,
  selectWysiwygFindMatch,
  type WysiwygFindMatch,
} from './wysiwygFind';

const match: WysiwygFindMatch = {
  start: 0,
  end: 4,
  text: 'word',
  regex: false,
  captures: [],
  groups: null,
  wysiwygFrom: 10,
  wysiwygTo: 14,
};

/**
 * Builds a duck-typed editor whose view DOM sits inside a scrollable
 * container with explicit geometry (jsdom reports zeros otherwise).
 */
function createEditor({
  coordsTop,
  containerTop = 0,
  clientHeight = 600,
  scrollTop = 0,
}: {
  coordsTop?: number;
  containerTop?: number;
  clientHeight?: number;
  scrollTop?: number;
}) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 5000 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: clientHeight });
  container.scrollTop = scrollTop;
  container.getBoundingClientRect = () =>
    ({ top: containerTop, bottom: containerTop + clientHeight }) as DOMRect;

  const dom = document.createElement('div');
  container.appendChild(dom);
  document.body.appendChild(container);

  const setTextSelection = vi.fn().mockReturnValue(true);
  const scrollIntoView = vi.fn().mockReturnValue(true);
  const editor = {
    commands: { setTextSelection, scrollIntoView },
    view: {
      dom,
      focus: vi.fn(),
      coordsAtPos:
        coordsTop === undefined
          ? undefined
          : vi.fn().mockReturnValue({ top: coordsTop, bottom: coordsTop + 20 }),
    },
  };
  return { editor, container, setTextSelection, scrollIntoView };
}

describe('centeredScrollTop', () => {
  it('returns null when the match is already visible', () => {
    expect(
      centeredScrollTop({
        matchTop: 300,
        containerTop: 0,
        containerHeight: 600,
        scrollTop: 1000,
      }),
    ).toBeNull();
  });

  it('centers a match below the viewport', () => {
    // match sits 900px below the container top in a 600px viewport →
    // scroll down by 900 - 300 = +600.
    expect(
      centeredScrollTop({
        matchTop: 900,
        containerTop: 0,
        containerHeight: 600,
        scrollTop: 1000,
      }),
    ).toBe(1600);
  });

  it('centers a match above the viewport and clamps at zero', () => {
    expect(
      centeredScrollTop({
        matchTop: -500,
        containerTop: 0,
        containerHeight: 600,
        scrollTop: 100,
      }),
    ).toBe(0);
  });
});

describe('selectWysiwygFindMatch scrolling', () => {
  it('scrolls the container to center an offscreen match', () => {
    const { editor, container } = createEditor({
      coordsTop: 900,
      clientHeight: 600,
      scrollTop: 1000,
    });

    selectWysiwygFindMatch(editor, match, { focusEditor: false });

    expect(container.scrollTop).toBe(1600);
  });

  it('leaves the container alone when the match is visible', () => {
    const { editor, container, scrollIntoView } = createEditor({
      coordsTop: 300,
      clientHeight: 600,
      scrollTop: 1000,
    });

    selectWysiwygFindMatch(editor, match, { focusEditor: false });

    expect(container.scrollTop).toBe(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('falls back to the editor scrollIntoView command without geometry', () => {
    const { editor, scrollIntoView } = createEditor({ coordsTop: undefined });

    selectWysiwygFindMatch(editor, match, { focusEditor: false });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('still selects the match and respects focusEditor=false', () => {
    const { editor, setTextSelection } = createEditor({ coordsTop: 300 });

    selectWysiwygFindMatch(editor, match, { focusEditor: false });

    expect(setTextSelection).toHaveBeenCalledWith({ from: 10, to: 14 });
    expect(editor.view.focus).not.toHaveBeenCalled();
  });
});
