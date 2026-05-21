export const SIDEBAR_STATE_KEY = 'markdowner.sidebarOpen';
export const SIDEBAR_WIDTH_KEY = 'markdowner.sidebarWidth';
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 720;
export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_KEYBOARD_STEP = 8;
export const SIDEBAR_KEYBOARD_PAGE_STEP = 32;

type SidebarStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readSidebarState(storage = getSidebarStorage()): boolean {
  try {
    const value = storage?.getItem(SIDEBAR_STATE_KEY);
    if (value === null || value === undefined) return false;
    return value === 'true';
  } catch {
    return false;
  }
}

export function writeSidebarState(isOpen: boolean, storage = getSidebarStorage()): void {
  try {
    storage?.setItem(SIDEBAR_STATE_KEY, String(isOpen));
  } catch {
    // localStorage unavailable; ignore
  }
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function readSidebarWidth(storage = getSidebarStorage()): number {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null || raw === undefined) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    return clampSidebarWidth(parsed);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function writeSidebarWidth(width: number, storage = getSidebarStorage()): void {
  try {
    storage?.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    // localStorage unavailable; ignore
  }
}

function getSidebarStorage(): SidebarStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}
