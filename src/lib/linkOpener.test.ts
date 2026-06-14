import { describe, expect, it, vi } from 'vitest';

import {
  attachMarkdownLinkClickInterceptor,
  findClickedAnchorHref,
  isOpenLinkClick,
} from './linkOpener';

describe('isOpenLinkClick', () => {
  it('treats Cmd+Click as the link-open intent on macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    try {
      expect(isOpenLinkClick({ metaKey: true, ctrlKey: false })).toBe(true);
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: true })).toBe(false);
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: false })).toBe(false);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    }
  });

  it('treats Ctrl+Click as the link-open intent on non-macOS', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    try {
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: true })).toBe(true);
      expect(isOpenLinkClick({ metaKey: true, ctrlKey: false })).toBe(false);
      expect(isOpenLinkClick({ metaKey: false, ctrlKey: false })).toBe(false);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    }
  });
});

describe('findClickedAnchorHref', () => {
  it('returns the closest anchor href from nested click targets', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a href="./notes.md"><span>Notes</span></a>';
    const target = container.querySelector('span');

    expect(findClickedAnchorHref(target, container)).toBe('./notes.md');
  });

  it('rejects anchors outside the supplied container', () => {
    const container = document.createElement('div');
    const outside = document.createElement('a');
    outside.href = 'https://example.com';

    expect(findClickedAnchorHref(outside, container)).toBeNull();
  });

  it('returns null when the target has no usable href', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a><span>No href</span></a>';
    const target = container.querySelector('span');

    expect(findClickedAnchorHref(target, container)).toBeNull();
  });
});

describe('attachMarkdownLinkClickInterceptor', () => {
  function setup() {
    const surface = document.createElement('div');
    surface.innerHTML = '<p>Read <a href="./next.md"><span>next</span></a></p>';
    document.body.appendChild(surface);
    const onOpen = vi.fn();
    const cleanup = attachMarkdownLinkClickInterceptor(surface, onOpen);
    const span = surface.querySelector('span') as HTMLElement;
    return { surface, onOpen, cleanup, span };
  }

  it('routes an anchor click to onOpen and cancels the default navigation', () => {
    const { onOpen, cleanup, span } = setup();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    span.dispatchEvent(event);

    expect(onOpen).toHaveBeenCalledWith('./next.md', { openInNewTab: false });
    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  it('treats Cmd/Ctrl-click as an open-in-new-tab request', () => {
    const { onOpen, cleanup, span } = setup();

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    expect(onOpen).toHaveBeenLastCalledWith('./next.md', { openInNewTab: true });

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(onOpen).toHaveBeenLastCalledWith('./next.md', { openInNewTab: true });
    cleanup();
  });

  it('ignores clicks that miss an anchor and non-left buttons', () => {
    const { surface, onOpen, cleanup, span } = setup();

    surface.querySelector('p')?.firstChild?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 }));

    expect(onOpen).not.toHaveBeenCalled();
    cleanup();
  });

  it('stops firing once cleaned up', () => {
    const { onOpen, cleanup, span } = setup();
    cleanup();

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
