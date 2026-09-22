import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface SessionExitOptions {
  flush: () => Promise<void>;
  onLockChange: (locked: boolean) => void;
  onError: (error: unknown) => void;
}

/** Coordinates the final flush with the native all-window exit barrier. */
export function useSessionExit(options: SessionExitOptions) {
  const current = useRef(options);
  current.current = options;
  const lockedRef = useRef(false);
  const generation = useRef(0);
  const deferred = useRef<Array<() => void>>([]);
  const [locked, setLocked] = useState(false);
  const setLock = useCallback((value: boolean) => {
    lockedRef.current = value;
    current.current.onLockChange(value);
    setLocked(value);
    if (!value) {
      queueMicrotask(() => {
        if (!lockedRef.current) {
          for (const operation of deferred.current.splice(0)) operation();
        }
      });
    }
  }, []);

  const prepare = useCallback(async () => {
    const request = ++generation.current;
    setLock(true);
    try {
      await current.current.flush();
    } catch (error) {
      if (request === generation.current) setLock(false);
      throw error;
    }
  }, [setLock]);

  useEffect(() => {
    let disposed = false;
    const listeners = [
      listen<{ requestId: number }>('markdowner://prepare-session-exit', async ({ payload }) => {
        const prepared = prepare();
        const request = generation.current;
        let error: string | null = null;
        try {
          await prepared;
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
          current.current.onError(failure);
        }
        try {
          await invoke('complete_session_flush', { requestId: payload.requestId, error });
        } catch (failure) {
          // The coordinator may have timed out or another window failed first.
          if (request === generation.current) setLock(false);
          current.current.onError(failure);
        }
      }),
      listen('markdowner://release-session-exit', () => { generation.current += 1; setLock(false); }),
      listen<string>('markdowner://session-exit-error', ({ payload }) => {
        generation.current += 1;
        setLock(false);
        current.current.onError(payload);
      }),
    ];
    const unlisteners: Array<() => void> = [];
    for (const listener of listeners) {
      void listener.then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch((error) => current.current.onError(error));
    }
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [prepare, setLock]);

  const unlock = useCallback(() => { generation.current += 1; setLock(false); }, [setLock]);
  const deferWhileLocked = useCallback((operation: () => void) => {
    if (!lockedRef.current) return false;
    deferred.current.push(operation);
    return true;
  }, []);
  return { locked, lockedRef, prepare, unlock, deferWhileLocked };
}
