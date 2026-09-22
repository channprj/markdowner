import { describe, expect, it } from 'vitest';

import {
  clearActiveDocumentSnapshot,
  setSnapshotLastError,
  setSnapshotMode,
  resolveSyncedDraftSnapshot,
} from './snapshotState';
import type { AppSnapshot } from './desktop';

const snapshot = (overrides: Partial<AppSnapshot> = {}): AppSnapshot => ({
  activeDocumentVersion: { id: 1, revision: 1 },
  activeDocumentName: 'notes.md',
  activeDocumentPath: '/tmp/notes.md',
  activeDocumentSource: '# Notes',
  activeDocumentDirty: true,
  mode: 'Editor',
  theme: {
    kind: 'BuiltInLight',
    stylesheet: null,
    stylesheetPath: null,
  },
  lastError: 'Previous error',
  recentDocuments: ['/tmp/notes.md'],
  workspaceDocuments: ['/tmp/notes.md'],
  rootDir: '/tmp',
  ...overrides,
});

describe('clearActiveDocumentSnapshot', () => {
  it('clears active document fields and preserves shell context', () => {
    expect(clearActiveDocumentSnapshot(snapshot())).toEqual({
      activeDocumentVersion: null,
      activeDocumentName: null,
      activeDocumentPath: null,
      activeDocumentSource: null,
      activeDocumentDirty: false,
      mode: 'Editor',
      theme: {
        kind: 'BuiltInLight',
        stylesheet: null,
        stylesheetPath: null,
      },
      lastError: null,
      recentDocuments: ['/tmp/notes.md'],
      workspaceDocuments: ['/tmp/notes.md'],
      rootDir: '/tmp',
    });
  });
});

describe('setSnapshotMode', () => {
  it('updates the editor mode without changing document or shell state', () => {
    expect(setSnapshotMode(snapshot(), 'SplitView')).toEqual({
      ...snapshot(),
      mode: 'SplitView',
    });
  });
});

describe('setSnapshotLastError', () => {
  it('updates the last operation error without changing document or shell state', () => {
    expect(setSnapshotLastError(snapshot({ lastError: null }), 'Could not save')).toEqual({
      ...snapshot({ lastError: null }),
      lastError: 'Could not save',
    });
  });
});

describe('resolveSyncedDraftSnapshot', () => {
  it('ignores stale responses for another untitled document or an older revision', () => {
    const current = snapshot({ activeDocumentPath: null, activeDocumentVersion: { id: 3, revision: 8 } });
    for (const version of [{ id: 2, revision: 9 }, { id: 3, revision: 7 }]) {
      const stale = snapshot({ activeDocumentPath: null, activeDocumentVersion: version, activeDocumentSource: 'stale' });
      expect(resolveSyncedDraftSnapshot(current, stale, null)).toBe(current);
    }
  });
  it('applies a fresh synced snapshot while preserving the current mode', () => {
    const current = snapshot({
      activeDocumentPath: '/tmp/notes.md',
      mode: 'SplitView',
    });
    const synced = snapshot({
      activeDocumentPath: '/tmp/notes.md',
      activeDocumentSource: '# Synced',
      mode: 'Wysiwyg',
      lastError: null,
    });

    expect(resolveSyncedDraftSnapshot(current, synced, '/tmp/notes.md')).toEqual({
      ...synced,
      mode: 'SplitView',
    });
  });

  it('ignores stale sync results for a document that is no longer active', () => {
    const current = snapshot({ activeDocumentPath: '/tmp/current.md' });
    const stale = snapshot({
      activeDocumentPath: '/tmp/old.md',
      activeDocumentSource: '# Stale',
      lastError: null,
    });

    expect(resolveSyncedDraftSnapshot(current, stale, '/tmp/old.md')).toBe(current);
  });
});
