import { describe, expect, it } from 'vitest';

import {
  clearActiveDocumentSnapshot,
  resolveSyncedDraftSnapshot,
} from './snapshotState';
import type { AppSnapshot } from './desktop';

const snapshot = (overrides: Partial<AppSnapshot> = {}): AppSnapshot => ({
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

describe('resolveSyncedDraftSnapshot', () => {
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
