import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AI_ACTIVITY_CHANGED_EVENT, AI_HISTORY_CHANGED_EVENT } from '@/lib/desktop';
import { useAiRuntime, type AiRuntimeServices } from './useAiRuntime';
import type { AiActiveRun } from './types';

describe('useAiRuntime', () => {
  it('does not resurrect a completed request when an older snapshot arrives late', async () => {
    let resolveOld!: (runs: AiActiveRun[]) => void;
    const old = new Promise<AiActiveRun[]>((resolve) => { resolveOld = resolve; });
    const listeners = new Map<string, () => void | Promise<void>>();
    const services: AiRuntimeServices = {
      listActive: vi.fn().mockReturnValueOnce(old).mockResolvedValue([]),
      historyPage: vi.fn(),
      listen: vi.fn(async (event, callback) => { listeners.set(event, callback); return vi.fn(); }),
    };
    const { result, unmount } = renderHook(() => useAiRuntime({ historyEnabled: false, services }));
    await waitFor(() => expect(services.listActive).toHaveBeenCalledTimes(2));
    await act(async () => listeners.get(AI_ACTIVITY_CHANGED_EVENT)?.());
    await act(async () => resolveOld([{ requestId: 'finished-run' } as AiActiveRun]));
    expect(result.current.activeRuns).toEqual([]);
    unmount();
  });

  it('releases a successful listener even if the other subscription fails', async () => {
    const cleanup = vi.fn();
    const services: AiRuntimeServices = {
      listActive: vi.fn().mockResolvedValue([]),
      historyPage: vi.fn().mockResolvedValue({ items: [], page: 0, pageSize: 20, total: 0 }),
      listen: vi.fn((event) => event === AI_ACTIVITY_CHANGED_EVENT
        ? Promise.resolve(cleanup) : Promise.reject(new Error('listener unavailable'))),
    };
    const { unmount } = renderHook(() => useAiRuntime({ historyEnabled: true, services }));
    await waitFor(() => expect(services.listActive).toHaveBeenCalled());
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('polls as a fallback and stops polling after unmount', async () => {
    vi.useFakeTimers();
    try {
      const services: AiRuntimeServices = {
        listActive: vi.fn().mockResolvedValue([]),
        historyPage: vi.fn(),
        listen: vi.fn().mockResolvedValue(vi.fn()),
      };
      const { unmount } = renderHook(() => useAiRuntime({ historyEnabled: false, services }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const initial = vi.mocked(services.listActive).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(services.listActive).toHaveBeenCalledTimes(initial + 1);
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(services.listActive).toHaveBeenCalledTimes(initial + 1);
    } finally { vi.useRealTimers(); }
  });
  it('loads snapshots, refreshes only the invalidated model, pages, and cleans listeners', async () => {
    const listeners = new Map<string, () => void>();
    const cleanupActivity = vi.fn();
    const cleanupHistory = vi.fn();
    const services: AiRuntimeServices = {
      listActive: vi.fn().mockResolvedValue([]),
      historyPage: vi.fn().mockResolvedValue({ items: [], page: 0, pageSize: 20, total: 41 }),
      listen: vi.fn(async (event, callback) => {
        listeners.set(event, callback);
        return event === AI_ACTIVITY_CHANGED_EVENT ? cleanupActivity : cleanupHistory;
      }),
    };

    const { result, unmount } = renderHook(() =>
      useAiRuntime({ historyEnabled: true, services }),
    );

    await waitFor(() => {
      expect(services.listActive).toHaveBeenCalledTimes(2);
      expect(services.historyPage).toHaveBeenCalledWith(0, 20);
    });

    await act(async () => listeners.get(AI_ACTIVITY_CHANGED_EVENT)?.());
    expect(services.listActive).toHaveBeenCalledTimes(3);
    expect(services.historyPage).toHaveBeenCalledTimes(2);

    await act(async () => listeners.get(AI_HISTORY_CHANGED_EVENT)?.());
    expect(services.historyPage).toHaveBeenCalledTimes(3);

    act(() => result.current.setHistoryPage(1));
    await waitFor(() => expect(services.historyPage).toHaveBeenLastCalledWith(1, 20));

    unmount();
    await waitFor(() => {
      expect(cleanupActivity).toHaveBeenCalledTimes(1);
      expect(cleanupHistory).toHaveBeenCalledTimes(1);
    });
  });

  it('clamps an empty page after history deletion to the last available page', async () => {
    const services: AiRuntimeServices = {
      listActive: vi.fn().mockResolvedValue([]),
      historyPage: vi.fn(async (page) => ({
        items: page === 1 ? [{
          id: 'run-21',
          task: 'translation' as const,
          model: 'z-ai/glm-5.2',
          status: 'completed' as const,
          scopeJson: '{}',
          sourceHash: 'hash',
          promptVersion: 'v1',
          instruction: null,
          targetLanguage: null,
          maxOutputTokens: null,
          zdrOnly: null,
          resultJson: null,
          errorJson: null,
          usageJson: null,
          startedAt: 1,
          finishedAt: 2,
        }] : [],
        page,
        pageSize: 20,
        total: 21,
      })),
      listen: vi.fn().mockResolvedValue(vi.fn()),
    };

    const { result } = renderHook(() =>
      useAiRuntime({ historyEnabled: true, services }),
    );
    await waitFor(() => expect(services.historyPage).toHaveBeenCalledWith(0, 20));

    act(() => result.current.setHistoryPage(2));

    await waitFor(() => expect(result.current.historyPageIndex).toBe(1));
    await waitFor(() => expect(services.historyPage).toHaveBeenLastCalledWith(1, 20));
    expect(result.current.history.items[0]?.id).toBe('run-21');
  });
});
