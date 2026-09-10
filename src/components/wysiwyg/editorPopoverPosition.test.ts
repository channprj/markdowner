import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import { editorPopoverAnchor, placeEditorPopover } from './editorPopoverPosition';

const bounds = { left: 100, right: 900, top: 80, bottom: 680 };

describe('editor popover placement', () => {
  it('protects both lines of a selection near the top instead of only its active end', () => {
    const editor = {
      state: { selection: { from: 1, to: 2, head: 2 } },
      view: { coordsAtPos: (position: number) => ({ left: 200, right: 200, top: 90 + (position - 1) * 32, bottom: 114 + (position - 1) * 32 }) },
    } as unknown as Editor;
    const anchor = editorPopoverAnchor(editor, bounds, 40)!;
    const result = placeEditorPopover({ anchor, bounds, width: 300, height: 40, preferred: 'above' });
    expect(anchor.top).toBe(90);
    expect(result.top).toBe(154);
  });

  it.each([100, 320, 600])('leaves the active line visible at y=%i', top => {
    const anchor = { left: 400, right: 400, top, bottom: top + 24 };
    const result = placeEditorPopover({ anchor, bounds, width: 480, height: 380 });
    const bottom = result.top + Math.min(380, result.maxHeight);
    expect(result.top >= anchor.bottom + 8 || bottom <= anchor.top - 8).toBe(true);
    expect(result.top).toBeGreaterThanOrEqual(bounds.top + 8);
    expect(bottom).toBeLessThanOrEqual(bounds.bottom - 8);
    expect(result.left + 480).toBeLessThanOrEqual(bounds.right - 8);
  });

  it('limits tall content to available space without moving it over the line', () => {
    const anchor = { left: 120, right: 120, top: 360, bottom: 384 };
    const result = placeEditorPopover({ anchor, bounds, width: 480, height: 900 });
    expect(result).toEqual({ left: 120, top: 392, maxHeight: 280 });
  });

  it('flips an above-line toolbar below a line near the top', () => {
    const anchor = { left: 400, right: 400, top: 90, bottom: 114 };
    const result = placeEditorPopover({ anchor, bounds, width: 300, height: 40, preferred: 'above' });
    expect(result.top).toBe(122);
  });

  it('keeps a panel visible when its anchor scrolls offscreen', () => {
    const result = placeEditorPopover({
      anchor: { left: 400, right: 400, top: -40, bottom: -16 },
      bounds, width: 480, height: 300,
    });
    expect(result.top).toBe(88);
  });
});
