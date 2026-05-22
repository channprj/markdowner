import { describe, expect, it, vi } from 'vitest';

import type { AppSnapshot } from './desktop';
import { createDocumentTab } from './documentTabs';
import {
  openSelectedDocumentTabs,
  resolveOpenDocumentPathTransition,
  resolveOpenSelectedDocumentTabsTransition,
} from './openDocumentSelection';

function snapshotFor(path: string, source = `# ${path}`): AppSnapshot {
  return {
    rootDir: null,
    workspaceDocuments: [],
    recentDocuments: [path],
    activeDocumentName: path.split('/').pop() ?? path,
    activeDocumentPath: path,
    activeDocumentSource: source,
    activeDocumentDirty: false,
    mode: 'Wysiwyg',
    theme: {
      kind: 'BuiltInDark',
      stylesheet: null,
      stylesheetPath: null,
    },
    lastError: null,
  };
}

describe('openSelectedDocumentTabs', () => {
  it('opens new paths and keeps the last opened tab active', async () => {
    const openPath = vi.fn(async (path: string) => snapshotFor(path));
    const ids = ['tab-a', 'tab-b'];

    const result = await openSelectedDocumentTabs({
      paths: ['/tmp/a.md', '/tmp/b.md'],
      currentTabs: [],
      openPath,
      createTabId: () => ids.shift() ?? 'extra-tab',
    });

    expect(result).toMatchObject({
      kind: 'ready',
      lastActiveId: 'tab-b',
      lastSnapshot: snapshotFor('/tmp/b.md'),
    });
    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.additions).toEqual([
      createDocumentTab({
        id: 'tab-a',
        path: '/tmp/a.md',
        name: 'a.md',
        source: '# /tmp/a.md',
      }),
      createDocumentTab({
        id: 'tab-b',
        path: '/tmp/b.md',
        name: 'b.md',
        source: '# /tmp/b.md',
      }),
    ]);
  });

  it('reuses existing and newly-added tabs for duplicate selected paths', async () => {
    const existing = createDocumentTab({
      id: 'existing',
      path: '/tmp/open.md',
      source: '# Open',
    });
    const openPath = vi.fn(async (path: string) => snapshotFor(path));

    const result = await openSelectedDocumentTabs({
      paths: ['/tmp/open.md', '/tmp/new.md', '/tmp/new.md'],
      currentTabs: [existing],
      openPath,
      createTabId: () => 'new-tab',
    });

    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith('/tmp/new.md');
    expect(result).toMatchObject({
      kind: 'ready',
      lastActiveId: 'new-tab',
    });
    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.additions).toHaveLength(1);
  });

  it('falls back to the requested path when the snapshot has partial document metadata', async () => {
    const openPath = vi.fn(async () => ({
      ...snapshotFor('/tmp/requested.md'),
      activeDocumentName: null,
      activeDocumentPath: null,
      activeDocumentSource: null,
    }));

    const result = await openSelectedDocumentTabs({
      paths: ['/tmp/requested.md'],
      currentTabs: [],
      openPath,
      createTabId: () => 'tab-requested',
    });

    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.additions[0]).toEqual(
      createDocumentTab({
        id: 'tab-requested',
        path: '/tmp/requested.md',
        name: '/tmp/requested.md',
        source: '',
      }),
    );
  });

  it('uses a provided display-name fallback when snapshot metadata has no document name', async () => {
    const openPath = vi.fn(async () => ({
      ...snapshotFor('/tmp/project/requested.md'),
      activeDocumentName: null,
      activeDocumentPath: null,
      activeDocumentSource: null,
    }));

    const result = await openSelectedDocumentTabs({
      paths: ['/tmp/project/requested.md'],
      currentTabs: [],
      openPath,
      createTabId: () => 'tab-requested',
      displayNameForPath: (path) => path.split('/').pop() ?? path,
    });

    if (result.kind !== 'ready') throw new Error('expected ready result');
    expect(result.additions[0]).toEqual(
      createDocumentTab({
        id: 'tab-requested',
        path: '/tmp/project/requested.md',
        name: 'requested.md',
        source: '',
      }),
    );
  });

  it('aborts without committing additions when the editor operation becomes stale', async () => {
    let stale = false;
    const openPath = vi.fn(async (path: string) => {
      stale = true;
      return snapshotFor(path);
    });

    const result = await openSelectedDocumentTabs({
      paths: ['/tmp/a.md'],
      currentTabs: [],
      openPath,
      createTabId: () => 'tab-a',
      shouldAbort: () => stale,
    });

    expect(result).toEqual({ kind: 'aborted' });
  });
});

describe('resolveOpenSelectedDocumentTabsTransition', () => {
  it('appends newly opened tabs and activates the last opened tab', () => {
    const existing = createDocumentTab({
      id: 'existing',
      path: '/tmp/existing.md',
    });
    const addition = createDocumentTab({
      id: 'new-tab',
      path: '/tmp/new.md',
    });
    const lastSnapshot = snapshotFor('/tmp/new.md');

    expect(
      resolveOpenSelectedDocumentTabsTransition({
        result: {
          kind: 'ready',
          additions: [addition],
          lastSnapshot,
          lastActiveId: 'new-tab',
        },
        currentTabs: [existing],
      }),
    ).toEqual({
      kind: 'appendAdditions',
      tabs: [existing, addition],
      activeTabId: 'new-tab',
      snapshot: lastSnapshot,
    });
  });

  it('switches to the last selected existing tab when there are no additions', () => {
    expect(
      resolveOpenSelectedDocumentTabsTransition({
        result: {
          kind: 'ready',
          additions: [],
          lastSnapshot: null,
          lastActiveId: 'existing',
        },
        currentTabs: [createDocumentTab({ id: 'existing', path: '/tmp/existing.md' })],
      }),
    ).toEqual({
      kind: 'switchExisting',
      activeTabId: 'existing',
    });
  });

  it('returns no-op for aborted or empty selection results', () => {
    expect(
      resolveOpenSelectedDocumentTabsTransition({
        result: { kind: 'aborted' },
        currentTabs: [],
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      resolveOpenSelectedDocumentTabsTransition({
        result: {
          kind: 'ready',
          additions: [],
          lastSnapshot: null,
          lastActiveId: null,
        },
        currentTabs: [],
      }),
    ).toEqual({ kind: 'noop' });
  });
});

describe('resolveOpenDocumentPathTransition', () => {
  it('switches to an existing tab for a known path', () => {
    expect(
      resolveOpenDocumentPathTransition({
        currentTabs: [
          createDocumentTab({ id: 'existing', path: '/tmp/existing.md' }),
          createDocumentTab({ id: 'other', path: '/tmp/other.md' }),
        ],
        path: '/tmp/existing.md',
      }),
    ).toEqual({
      kind: 'switchExisting',
      activeTabId: 'existing',
    });
  });

  it('opens the path when it is not already tabbed', () => {
    expect(
      resolveOpenDocumentPathTransition({
        currentTabs: [createDocumentTab({ id: 'existing', path: '/tmp/existing.md' })],
        path: '/tmp/new.md',
      }),
    ).toEqual({
      kind: 'openPath',
      path: '/tmp/new.md',
    });
  });
});
