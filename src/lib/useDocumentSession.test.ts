import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot } from './desktop';
import { useDocumentSession } from './useDocumentSession';

const empty: AppSnapshot = {
  activeDocumentVersion: null, activeDocumentName: null, activeDocumentPath: null,
  activeDocumentSource: null, activeDocumentDirty: false,
  rootDir: null, workspaceDocuments: [], recentDocuments: [], mode: 'Editor',
  theme: { kind: 'BuiltInDark', stylesheet: null, stylesheetPath: null }, lastError: null,
};

describe('document session state', () => {
  it('makes batched edits visible to async readers before the render commits', () => {
    const { result } = renderHook(() => useDocumentSession(empty));
    act(() => {
      result.current.setLocalDraft('first');
      result.current.setLocalDraft((previous) => previous + ' second');
      result.current.setActiveTabId('new-tab');
      result.current.setStartupTabsReady(true);
      expect(result.current.localDraftRef.current).toBe('first second');
      expect(result.current.activeTabIdRef.current).toBe('new-tab');
      expect(result.current.startupTabsReadyRef.current).toBe(true);
    });
    expect(result.current.localDraft).toBe('first second');
    expect(result.current.activeTabId).toBe('new-tab');
  });

  it('rejects old native responses without changing the latest snapshot or dirty draft', () => {
    const { result } = renderHook(() => useDocumentSession(empty));
    const latest = { ...empty, activeDocumentSource: 'disk', activeDocumentVersion: { id: 3, revision: 5 } };
    act(() => {
      result.current.applySnapshot(latest);
      result.current.setLocalDraft('unsaved');
      for (const version of [{ id: 2, revision: 99 }, { id: 3, revision: 4 }, null]) {
        expect(result.current.applySnapshot({ ...empty, activeDocumentVersion: version, activeDocumentSource: 'stale' })).toBe(false);
      }
    });
    expect(result.current.snapshot).toEqual(latest);
    expect(result.current.localDraft).toBe('unsaved');
    act(() => result.current.applySnapshot({ ...latest, mode: 'SplitView' }, true));
    expect(result.current.localDraft).toBe('unsaved');
    expect(result.current.snapshot.mode).toBe('SplitView');
  });

  it('clears the active document atomically while retaining closed-tab history and workspace state', () => {
    const { result } = renderHook(() => useDocumentSession({ ...empty, rootDir: '/workspace' }));
    act(() => {
      result.current.setActiveTabId('one');
      result.current.setLocalDraft('draft');
      result.current.clearActiveDocument();
      expect(result.current.localDraftRef.current).toBe('');
      expect(result.current.snapshotRef.current.activeDocumentVersion).toBeNull();
    });
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.tabs).toEqual([]);
    expect(result.current.snapshot.rootDir).toBe('/workspace');
  });
});
