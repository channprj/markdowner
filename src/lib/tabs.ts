/**
 * Reorders a list of tabs by moving the tab with `activeId` one position in
 * the given direction. Mirrors VS Code's "Move Editor Left/Right" behavior:
 * the move is a no-op when the active tab is already at the start/end edge
 * (no wrap-around).
 *
 * Returns the original array when there is no move to apply, so callers can
 * use the return value directly with React state setters.
 */
export function moveTab<T extends { id: string }>(
  tabs: readonly T[],
  activeId: string,
  direction: -1 | 1,
): T[] {
  const idx = tabs.findIndex((tab) => tab.id === activeId);
  if (idx < 0) return tabs.slice();
  const target = idx + direction;
  if (target < 0 || target >= tabs.length) return tabs.slice();
  const next = tabs.slice();
  const [moved] = next.splice(idx, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Moves the dragged tab next to the drop target — before or after it,
 * depending on which half of the target the pointer was over when released.
 *
 * Returns a fresh copy even when the drop is a no-op (unknown ids, dropping
 * a tab onto itself), so callers can hand the result straight to setState.
 */
export function reorderTabByDrag<T extends { id: string }>(
  tabs: readonly T[],
  sourceId: string,
  targetId: string,
  placeAfter: boolean,
): T[] {
  const next = tabs.slice();
  if (sourceId === targetId) return next;
  const sourceIndex = next.findIndex((tab) => tab.id === sourceId);
  const targetIndex = next.findIndex((tab) => tab.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return next;
  const [moved] = next.splice(sourceIndex, 1);
  const insertAt = next.findIndex((tab) => tab.id === targetId) + (placeAfter ? 1 : 0);
  next.splice(insertAt, 0, moved);
  return next;
}
