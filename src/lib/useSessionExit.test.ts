import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionExit } from './useSessionExit';

const { handlers, invoke, unlisten } = vi.hoisted(() => ({
  handlers: new Map<string, (event: any) => Promise<void> | void>(),
  invoke: vi.fn(), unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name, handler) => { handlers.set(name, handler); return unlisten; }),
}));

describe('all-window exit participant', () => {
  beforeEach(() => { handlers.clear(); invoke.mockReset().mockResolvedValue(undefined); unlisten.mockReset(); });

  it('locks before flushing, acknowledges only after durable success, and unlocks when exit is cancelled', async () => {
    let finish!: () => void;
    const flush = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onLockChange = vi.fn();
    const { result, unmount } = renderHook(() => useSessionExit({ flush, onLockChange, onError: vi.fn() }));
    let prepared!: Promise<void>;
    act(() => { prepared = handlers.get('markdowner://prepare-session-exit')!({ payload: { requestId: 42 } }) as Promise<void>; });
    expect(result.current.lockedRef.current).toBe(true);
    expect(result.current.locked).toBe(true);
    expect(onLockChange).toHaveBeenCalledWith(true);
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { finish(); await prepared; });
    expect(invoke).toHaveBeenCalledWith('complete_session_flush', { requestId: 42, error: null });
    expect(result.current.locked).toBe(true);
    act(() => { handlers.get('markdowner://release-session-exit')!({}); });
    expect(result.current.locked).toBe(false);
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(3);
  });

  it('sends a failed acknowledgement and preserves editability when persistence fails', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSessionExit({
      flush: vi.fn().mockRejectedValue(new Error('disk full')),
      onLockChange: vi.fn(), onError,
    }));
    await act(async () => { await handlers.get('markdowner://prepare-session-exit')!({ payload: { requestId: 7 } }); });
    expect(invoke).toHaveBeenCalledWith('complete_session_flush', { requestId: 7, error: 'disk full' });
    expect(onError).toHaveBeenCalled();
    expect(result.current.lockedRef.current).toBe(false);
  });

  it('unlocks after a native acknowledgement failure so a timed-out quit can be retried', async () => {
    invoke.mockRejectedValueOnce(new Error('stale request'));
    const { result } = renderHook(() => useSessionExit({
      flush: vi.fn().mockResolvedValue(undefined), onLockChange: vi.fn(), onError: vi.fn(),
    }));
    await act(async () => { await handlers.get('markdowner://prepare-session-exit')!({ payload: { requestId: 9 } }); });
    expect(result.current.locked).toBe(false);
  });

  it('defers incoming document results until cancellation and ignores errors from a previous request', async () => {
    let rejectOld!: (error: Error) => void;
    invoke.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const { result } = renderHook(() => useSessionExit({
      flush: vi.fn().mockResolvedValue(undefined), onLockChange: vi.fn(), onError: vi.fn(),
    }));
    let old!: Promise<void>;
    await act(async () => {
      old = handlers.get('markdowner://prepare-session-exit')!({ payload: { requestId: 1 } }) as Promise<void>;
      await Promise.resolve();
    });
    act(() => { handlers.get('markdowner://release-session-exit')!({}); });
    await act(async () => { await handlers.get('markdowner://prepare-session-exit')!({ payload: { requestId: 2 } }); });
    const incoming = vi.fn();
    expect(result.current.deferWhileLocked(incoming)).toBe(true);
    await act(async () => { rejectOld(new Error('old request expired')); await old; });
    expect(result.current.locked).toBe(true);
    expect(incoming).not.toHaveBeenCalled();
    await act(async () => { result.current.unlock(); });
    expect(incoming).toHaveBeenCalledOnce();
  });
});
