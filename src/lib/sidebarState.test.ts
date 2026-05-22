import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STATE_KEY,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  nextSidebarWidthFromKey,
  readSidebarState,
  readSidebarWidth,
  resolveSidebarLayoutState,
  resolveSidebarPanelState,
  sidebarWidthFromPointerX,
  writeSidebarState,
  writeSidebarWidth,
} from './sidebarState';

describe('sidebar state persistence', () => {
  const clearStoredSidebarState = () => {
    window.localStorage.removeItem(SIDEBAR_STATE_KEY);
    window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  };

  beforeEach(clearStoredSidebarState);
  afterEach(clearStoredSidebarState);

  it('defaults the sidebar to collapsed when no preference is stored', () => {
    expect(readSidebarState()).toBe(false);
  });

  it('reads and writes the sidebar open state', () => {
    writeSidebarState(true);
    expect(window.localStorage.getItem(SIDEBAR_STATE_KEY)).toBe('true');
    expect(readSidebarState()).toBe(true);

    writeSidebarState(false);
    expect(window.localStorage.getItem(SIDEBAR_STATE_KEY)).toBe('false');
    expect(readSidebarState()).toBe(false);
  });

  it('clamps sidebar width to the supported range', () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 1)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 1)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(319.6)).toBe(320);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('reads stored sidebar width through the clamp', () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, '9999');
    expect(readSidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);

    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, 'bad-width');
    expect(readSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('writes clamped sidebar width values', () => {
    writeSidebarWidth(123);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(SIDEBAR_MIN_WIDTH));

    writeSidebarWidth(320);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('320');
  });

  it('calculates sidebar width from pointer position relative to the activity bar', () => {
    expect(sidebarWidthFromPointerX(360)).toBe(312);
    expect(sidebarWidthFromPointerX(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(sidebarWidthFromPointerX(900)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('calculates keyboard resize targets and ignores unrelated keys', () => {
    expect(nextSidebarWidthFromKey(280, 'ArrowRight')).toBe(288);
    expect(nextSidebarWidthFromKey(280, 'ArrowLeft')).toBe(272);
    expect(nextSidebarWidthFromKey(280, 'PageDown')).toBe(312);
    expect(nextSidebarWidthFromKey(280, 'PageUp')).toBe(248);
    expect(nextSidebarWidthFromKey(280, 'Home')).toBe(SIDEBAR_MIN_WIDTH);
    expect(nextSidebarWidthFromKey(280, 'End')).toBe(SIDEBAR_MAX_WIDTH);
    expect(nextSidebarWidthFromKey(280, 'Escape')).toBeNull();
  });

  it('toggles the current sidebar panel closed', () => {
    expect(
      resolveSidebarPanelState({
        currentOpen: true,
        currentPanel: 'files',
        intent: 'toggle',
        targetPanel: 'files',
      }),
    ).toEqual({
      panel: 'files',
      isOpen: false,
      announcement: 'Sidebar hidden',
    });
  });

  it('opens the requested panel when toggling from another panel or a closed sidebar', () => {
    expect(
      resolveSidebarPanelState({
        currentOpen: true,
        currentPanel: 'files',
        intent: 'toggle',
        targetPanel: 'search',
      }),
    ).toEqual({
      panel: 'search',
      isOpen: true,
      announcement: 'Search sidebar shown',
    });

    expect(
      resolveSidebarPanelState({
        currentOpen: false,
        currentPanel: 'outline',
        intent: 'toggle',
        targetPanel: 'files',
      }),
    ).toEqual({
      panel: 'files',
      isOpen: true,
      announcement: 'Files sidebar shown',
    });
  });

  it('shows a panel without re-announcing when it is already visible', () => {
    expect(
      resolveSidebarPanelState({
        currentOpen: true,
        currentPanel: 'search',
        intent: 'show',
        targetPanel: 'search',
      }),
    ).toEqual({
      panel: 'search',
      isOpen: true,
      announcement: null,
    });
  });

  it('derives open sidebar layout state for the app grid and resize handle', () => {
    expect(
      resolveSidebarLayoutState({
        isOpen: true,
        width: 312,
        isResizing: false,
      }),
    ).toEqual({
      gridTemplateColumns: '48px 312px 4px minmax(0, 1fr)',
      gridShouldAnimate: true,
      resizeHandleTabIndex: 0,
      resizeHandleInteractive: true,
      resizeRailActive: false,
      resizeRailHoverable: true,
    });
  });

  it('derives collapsed and resizing sidebar layout state', () => {
    expect(
      resolveSidebarLayoutState({
        isOpen: false,
        width: 312,
        isResizing: true,
      }),
    ).toEqual({
      gridTemplateColumns: '48px 0px 0px minmax(0, 1fr)',
      gridShouldAnimate: false,
      resizeHandleTabIndex: -1,
      resizeHandleInteractive: false,
      resizeRailActive: true,
      resizeRailHoverable: false,
    });
  });
});
