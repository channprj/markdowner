import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * An event handler with a stable identity that always runs the latest
 * render's closure. Use it for handlers passed to memoised children or listed
 * in memo/effect dependencies. React 19.2's `useEffectEvent` returns a new
 * function on every render, so those uses rebuild on every parent render
 * (for example, CodeMirror reconfigures and reports statistics after each
 * App commit).
 */
export function useStableEvent<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const handlerRef = useRef(handler);
  // Insertion effects run before this commit's layout and passive effects.
  // Unlike useEffectEvent, child layout-effect cleanups in the same commit
  // still see the previous closure.
  useInsertionEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args: Args) => handlerRef.current(...args), []);
}
