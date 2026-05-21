import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STATE_KEY,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  readSidebarState,
  readSidebarWidth,
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
});
