import { describe, expect, it } from 'vitest';

import { clearActiveDocumentSnapshot } from './snapshotState';
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
