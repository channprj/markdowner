import { startTransition, useCallback, useReducer, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AppSnapshot } from './desktop';
import type { DocumentTab } from './documentTabs';
import { clearActiveDocumentSnapshot } from './snapshotState';

interface DocumentSession {
  snapshot: AppSnapshot;
  localDraft: string;
  tabs: DocumentTab[];
  activeTabId: string | null;
  closedDocumentTabs: DocumentTab[];
  startupTabsReady: boolean;
}

type SessionPatch = Partial<DocumentSession>;

function sessionReducer(state: DocumentSession, patch: SessionPatch): DocumentSession {
  return { ...state, ...patch };
}

/** A field's live ref advances with intent, before React commits its render. */
function useSessionField<Key extends keyof DocumentSession>(
  key: Key,
  initial: DocumentSession[Key],
  dispatch: Dispatch<SessionPatch>,
) {
  const ref = useRef(initial);
  const set = useCallback((update: SetStateAction<DocumentSession[Key]>) => {
    const next = typeof update === 'function'
      ? (update as (previous: DocumentSession[Key]) => DocumentSession[Key])(ref.current)
      : update;
    ref.current = next;
    dispatch({ [key]: next } as SessionPatch);
  }, [dispatch, key]);
  return [ref, set] as const;
}

function snapshotIsOlder(current: AppSnapshot, incoming: AppSnapshot) {
  const previous = current.activeDocumentVersion;
  const next = incoming.activeDocumentVersion;
  if (!previous) return false;
  return !next || next.id < previous.id || (next.id === previous.id && next.revision < previous.revision);
}

/** Owns document UI state and the synchronous views used by async operations. */
export function useDocumentSession(initialSnapshot: AppSnapshot) {
  const [state, dispatch] = useReducer(sessionReducer, {
    snapshot: initialSnapshot, localDraft: '', tabs: [], activeTabId: null,
    closedDocumentTabs: [], startupTabsReady: false,
  });
  const [snapshotRef, setSnapshot] = useSessionField('snapshot', initialSnapshot, dispatch);
  const [localDraftRef, setLocalDraft] = useSessionField('localDraft', '', dispatch);
  const [tabsRef, setTabs] = useSessionField('tabs', [], dispatch);
  const [activeTabIdRef, setActiveTabId] = useSessionField('activeTabId', null, dispatch);
  const [closedDocumentTabsRef, setClosedDocumentTabs] = useSessionField('closedDocumentTabs', [], dispatch);
  const [startupTabsReadyRef, setStartupTabsReady] = useSessionField('startupTabsReady', false, dispatch);

  const applySnapshot = useCallback((next: AppSnapshot, preserveDraft = false) => {
    if (snapshotIsOlder(snapshotRef.current, next)) return false;
    snapshotRef.current = next;
    const patch: SessionPatch = { snapshot: next };
    if (!preserveDraft) {
      localDraftRef.current = next.activeDocumentSource ?? '';
      patch.localDraft = localDraftRef.current;
    }
    startTransition(() => dispatch(patch));
    return true;
  }, [snapshotRef, localDraftRef]);

  const clearActiveDocument = useCallback(() => {
    snapshotRef.current = clearActiveDocumentSnapshot(snapshotRef.current);
    localDraftRef.current = '';
    tabsRef.current = [];
    activeTabIdRef.current = null;
    startTransition(() => dispatch({
      snapshot: snapshotRef.current, localDraft: '', tabs: [], activeTabId: null,
    }));
  }, [snapshotRef, localDraftRef, tabsRef, activeTabIdRef]);

  return {
    ...state, snapshotRef, localDraftRef, tabsRef, activeTabIdRef, closedDocumentTabsRef, startupTabsReadyRef,
    setSnapshot, setLocalDraft, setTabs, setActiveTabId, setClosedDocumentTabs, setStartupTabsReady,
    applySnapshot, clearActiveDocument,
  };
}
