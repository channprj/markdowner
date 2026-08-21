import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AI_ACTIVITY_CHANGED_EVENT, AI_HISTORY_CHANGED_EVENT } from '@/lib/desktop';
import { useAiRuntime, type AiRuntimeServices } from './useAiRuntime';

describe('useAiRuntime', () => {
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
      expect(services.listActive).toHaveBeenCalledTimes(1);
      expect(services.historyPage).toHaveBeenCalledWith(0, 20);
    });

    await act(async () => listeners.get(AI_ACTIVITY_CHANGED_EVENT)?.());
    expect(services.listActive).toHaveBeenCalledTimes(2);
    expect(services.historyPage).toHaveBeenCalledTimes(1);

    await act(async () => listeners.get(AI_HISTORY_CHANGED_EVENT)?.());
    expect(services.historyPage).toHaveBeenCalledTimes(2);

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
