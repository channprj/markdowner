import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import {
  AI_ACTIVITY_CHANGED_EVENT,
  AI_HISTORY_CHANGED_EVENT,
  aiHistoryPage,
  aiListActive,
} from '@/lib/desktop';
import type { AiActiveRun, AiHistoryPage } from './types';

const EMPTY_HISTORY: AiHistoryPage = { items: [], page: 0, pageSize: 20, total: 0 };

export interface AiRuntimeServices {
  listActive: () => Promise<AiActiveRun[]>;
  historyPage: (page: number, pageSize: number) => Promise<AiHistoryPage>;
  listen: (
    event: string,
    callback: () => void | Promise<void>,
  ) => Promise<() => void>;
}

const DEFAULT_SERVICES: AiRuntimeServices = {
  listActive: aiListActive,
  historyPage: aiHistoryPage,
  listen: async (event, callback) => listen(event, () => void callback()),
};

export function useAiRuntime({
  historyEnabled,
  services = DEFAULT_SERVICES,
}: {
  historyEnabled: boolean;
  services?: AiRuntimeServices;
}) {
  const [activeRuns, setActiveRuns] = useState<AiActiveRun[]>([]);
  const [history, setHistory] = useState<AiHistoryPage>(EMPTY_HISTORY);
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const [activityLoading, setActivityLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(historyEnabled);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyPageRef = useRef(historyPageIndex);
  const mounted = useRef(false);
  const activityVersion = useRef(0);
  const historyVersion = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activityVersion.current += 1;
      historyVersion.current += 1;
    };
  }, [services]);

  useEffect(() => {
    historyPageRef.current = historyPageIndex;
  }, [historyPageIndex]);

  const reloadActivity = useCallback(async () => {
    const version = ++activityVersion.current;
    setActivityLoading(true);
    try {
      const next = await services.listActive();
      if (!mounted.current || version !== activityVersion.current) return;
      setActiveRuns(next);
      setActivityError(null);
    } catch (reason) {
      if (mounted.current && version === activityVersion.current) setActivityError(errorMessage(reason));
    } finally {
      if (mounted.current && version === activityVersion.current) setActivityLoading(false);
    }
  }, [services]);

  const loadHistoryPage = useCallback(
    async (page: number) => {
      const version = ++historyVersion.current;
      if (!historyEnabled) {
        setHistory(EMPTY_HISTORY);
        setHistoryError(null);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      try {
        const next = await services.historyPage(page, 20);
        if (!mounted.current || version !== historyVersion.current) return;
        const lastPage = Math.max(0, Math.ceil(next.total / next.pageSize) - 1);
        if (page > lastPage) {
          historyPageRef.current = lastPage;
          setHistoryPageIndex(lastPage);
          return;
        }
        setHistory(next);
        setHistoryError(null);
      } catch (reason) {
        if (mounted.current && version === historyVersion.current) setHistoryError(errorMessage(reason));
      } finally {
        if (mounted.current && version === historyVersion.current) setHistoryLoading(false);
      }
    },
    [historyEnabled, services],
  );

  const reloadHistory = useCallback(
    () => loadHistoryPage(historyPageRef.current),
    [loadHistoryPage],
  );

  useEffect(() => {
    void reloadActivity();
  }, [reloadActivity]);

  useEffect(() => {
    void loadHistoryPage(historyPageIndex);
  }, [historyPageIndex, loadHistoryPage]);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    for (const [event, reload] of [
      [AI_ACTIVITY_CHANGED_EVENT, reloadActivity],
      [AI_HISTORY_CHANGED_EVENT, reloadHistory],
    ] as const) {
      services.listen(event, reload).then((cleanup) => {
        if (disposed) { cleanup(); return; }
        cleanups.push(cleanup);
        // Close the gap between the initial snapshot and listener registration.
        void reload();
      }).catch((reason) => {
        if (!disposed) setActivityError(errorMessage(reason));
      });
    }
    // Events are hints, not the only source of truth. Recover after missed
    // notifications, window suspension, or an unavailable event subscription.
    const poll = window.setInterval(() => { void reloadActivity(); }, 2_000);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [reloadActivity, reloadHistory, services]);

  return {
    activeRuns,
    history,
    historyPageIndex,
    activityLoading,
    historyLoading,
    activityError,
    historyError,
    setHistoryPage: setHistoryPageIndex,
    reloadActivity,
    reloadHistory,
  };
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    return String(reason.message);
  }
  return String(reason || 'AI runtime state is unavailable.');
}
