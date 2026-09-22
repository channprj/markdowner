import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

import { saveDraftBackups, saveOpenTabs, type OpenTabsPayload } from './desktop';
import { buildDraftBackupEntries, type DraftBackupEntry } from './draftBackups';
import type { DocumentTab } from './documentTabs';
import type { SourceCursorLocation } from './modeCursor';
import { buildOpenTabsPayload } from './openTabsSession';

type SessionPayload = { tabs: OpenTabsPayload; drafts: DraftBackupEntry[] };

/** All writes share a queue so a delayed periodic backup cannot replace a final flush. */
export function createSessionWriter(write: (payload: SessionPayload) => Promise<void>) {
  let pending = Promise.resolve();
  return (payload: SessionPayload) => {
    const result = pending.then(() => write(payload));
    pending = result.catch(() => undefined);
    return result;
  };
}

interface DocumentPersistenceInput {
  tabs: DocumentTab[];
  activeTabId: string | null;
  localDraft: string;
  ready: boolean;
  tabsRef: RefObject<DocumentTab[]>;
  activeTabIdRef: RefObject<string | null>;
  localDraftRef: RefObject<string>;
  readyRef: RefObject<boolean>;
  cursorByPathRef: RefObject<Map<string, SourceCursorLocation>>;
}

export function useDocumentPersistence(input: DocumentPersistenceInput) {
  const current = useRef(input);
  current.current = input;
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useMemo(() => createSessionWriter(async ({ tabs, drafts }) => {
    await saveDraftBackups(drafts);
    await saveOpenTabs(tabs);
  }), []);

  const persist = useCallback((draftOverride?: string | null) => {
    const state = current.current;
    if (!state.readyRef.current) {
      return Promise.reject(new Error('The previous session is still being restored. Please retry after it finishes.'));
    }
    const tabs = state.tabsRef.current;
    const activeTabId = state.activeTabIdRef.current;
    return write({
      tabs: buildOpenTabsPayload({ tabs, activeTabId, cursorPositions: state.cursorByPathRef.current }),
      drafts: buildDraftBackupEntries({ tabs, activeTabId, localDraft: draftOverride ?? state.localDraftRef.current }),
    });
  }, [write]);

  const persistInBackground = useCallback(() => {
    if (!current.current.readyRef.current) return;
    void persist().catch((error) => console.warn('[Markdowner] Failed to persist session:', error));
  }, [persist]);

  const clearTimers = useCallback(() => {
    if (cursorTimer.current !== null) clearTimeout(cursorTimer.current);
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
    cursorTimer.current = null;
    draftTimer.current = null;
  }, []);

  const flushSession = useCallback((draftOverride?: string | null) => {
    clearTimers();
    return persist(draftOverride);
  }, [clearTimers, persist]);

  const schedulePersistOpenTabs = useCallback(() => {
    if (cursorTimer.current !== null) clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => {
      cursorTimer.current = null;
      persistInBackground();
    }, 800);
  }, [persistInBackground]);

  useEffect(() => {
    if (input.ready) persistInBackground();
  }, [input.tabs, input.activeTabId, input.ready, persistInBackground]);

  useEffect(() => {
    if (!input.ready) return;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      persistInBackground();
    }, 1000);
    return () => {
      if (draftTimer.current !== null) clearTimeout(draftTimer.current);
      draftTimer.current = null;
    };
  }, [input.localDraft, input.ready, persistInBackground]);

  useEffect(() => clearTimers, [clearTimers]);

  return { flushSession, schedulePersistOpenTabs };
}
