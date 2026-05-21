import { describe, expect, it } from 'vitest';

import {
  SETTINGS_TAB_ID,
  SETTINGS_TAB_NAME,
  createDocumentTab,
  createSettingsTab,
  findDocumentTabByPath,
  generateDocumentTabId,
  isDocumentTabDirty,
  mergeRestoredDocumentTabs,
  type DocumentTab,
} from './documentTabs';

function documentTab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  return {
    id: 'doc-1',
    kind: 'document',
    path: '/tmp/notes.md',
    name: 'notes.md',
    source: 'saved\n',
    draft: 'saved\n',
    missing: false,
    ...overrides,
  };
}

describe('generateDocumentTabId', () => {
  it('uses crypto randomUUID when available', () => {
    expect(
      generateDocumentTabId({
        randomUUID: () => 'uuid-1',
      }),
    ).toBe('uuid-1');
  });

  it('falls back to a timestamp and random suffix', () => {
    expect(
      generateDocumentTabId({
        randomUUID: null,
        now: () => 123,
        random: () => 0.5,
      }),
    ).toBe('tab-123-i');
  });
});

describe('createDocumentTab', () => {
  it('creates a document tab with draft defaulting to source', () => {
    expect(
      createDocumentTab({
        id: 'doc-2',
        path: '/tmp/today.md',
        name: 'today.md',
        source: '# Today',
      }),
    ).toEqual({
      id: 'doc-2',
      kind: 'document',
      path: '/tmp/today.md',
      name: 'today.md',
      source: '# Today',
      draft: '# Today',
      missing: false,
    });
  });

  it('creates missing document placeholders', () => {
    expect(
      createDocumentTab({
        id: 'missing-1',
        path: '/tmp/missing.md',
        name: 'missing.md',
        missing: true,
      }),
    ).toEqual({
      id: 'missing-1',
      kind: 'document',
      path: '/tmp/missing.md',
      name: 'missing.md',
      source: '',
      draft: '',
      missing: true,
    });
  });
});

describe('createSettingsTab', () => {
  it('creates the UI-only settings tab', () => {
    expect(createSettingsTab()).toEqual({
      id: SETTINGS_TAB_ID,
      kind: 'settings',
      path: null,
      name: SETTINGS_TAB_NAME,
      source: '',
      draft: '',
      missing: false,
    });
  });
});

describe('findDocumentTabByPath', () => {
  it('finds document tabs by path and ignores the settings tab', () => {
    const settingsTab = createSettingsTab();
    const untitled = documentTab({
      id: 'untitled',
      path: null,
      name: 'Untitled',
    });
    const saved = documentTab({
      id: 'saved',
      path: '/tmp/saved.md',
      name: 'saved.md',
    });

    expect(findDocumentTabByPath([settingsTab, untitled, saved], null)).toBe(untitled);
    expect(findDocumentTabByPath([settingsTab, untitled, saved], '/tmp/saved.md')).toBe(saved);
    expect(findDocumentTabByPath([settingsTab, untitled, saved], '/tmp/missing.md')).toBeUndefined();
  });
});

describe('isDocumentTabDirty', () => {
  it('uses local draft for the active document tab', () => {
    expect(
      isDocumentTabDirty(documentTab(), {
        activeTabId: 'doc-1',
        localDraft: 'changed',
      }),
    ).toBe(true);
  });

  it('uses stashed draft for inactive document tabs', () => {
    expect(
      isDocumentTabDirty(documentTab({ draft: 'changed' }), {
        activeTabId: 'other',
        localDraft: 'saved',
      }),
    ).toBe(true);
  });

  it('normalizes trailing newlines before comparing drafts', () => {
    expect(
      isDocumentTabDirty(documentTab({ source: 'saved\n', draft: 'saved\n\n' }), {
        activeTabId: 'other',
        localDraft: 'ignored',
      }),
    ).toBe(false);
  });

  it('never marks the settings tab dirty', () => {
    expect(
      isDocumentTabDirty(createSettingsTab(), {
        activeTabId: SETTINGS_TAB_ID,
        localDraft: 'changed',
      }),
    ).toBe(false);
  });
});

describe('mergeRestoredDocumentTabs', () => {
  it('keeps current document tabs, appends new restored documents, and keeps UI tabs last', () => {
    const existing = documentTab({
      id: 'existing',
      path: '/tmp/existing.md',
      name: 'existing.md',
    });
    const settings = createSettingsTab();
    const restoredExisting = documentTab({
      id: 'restored-existing',
      path: '/tmp/existing.md',
      name: 'existing.md',
    });
    const restoredNew = documentTab({
      id: 'restored-new',
      path: '/tmp/new.md',
      name: 'new.md',
    });

    const result = mergeRestoredDocumentTabs({
      currentTabs: [existing, settings],
      restoredTabs: [restoredExisting, restoredNew],
      currentActiveId: 'missing-active',
      activePath: '/tmp/new.md',
    });

    expect(result.mergedTabs).toEqual([existing, restoredNew, settings]);
    expect(result.nextActiveId).toBe('restored-new');
    expect(result.nextActiveTab).toBe(restoredNew);
  });

  it('keeps the current active UI tab when it still exists after merging', () => {
    const existing = documentTab({
      id: 'existing',
      path: '/tmp/existing.md',
      name: 'existing.md',
    });
    const settings = createSettingsTab();
    const restoredNew = documentTab({
      id: 'restored-new',
      path: '/tmp/new.md',
      name: 'new.md',
    });

    const result = mergeRestoredDocumentTabs({
      currentTabs: [existing, settings],
      restoredTabs: [restoredNew],
      currentActiveId: SETTINGS_TAB_ID,
      activePath: '/tmp/new.md',
    });

    expect(result.mergedTabs).toEqual([existing, restoredNew, settings]);
    expect(result.nextActiveId).toBe(SETTINGS_TAB_ID);
    expect(result.nextActiveTab).toBe(settings);
  });

  it('falls back to the first merged tab when there is no active path or current active tab', () => {
    const restoredFirst = documentTab({
      id: 'restored-first',
      path: '/tmp/first.md',
      name: 'first.md',
    });
    const restoredSecond = documentTab({
      id: 'restored-second',
      path: '/tmp/second.md',
      name: 'second.md',
    });

    const result = mergeRestoredDocumentTabs({
      currentTabs: [],
      restoredTabs: [restoredFirst, restoredSecond],
      currentActiveId: null,
      activePath: null,
    });

    expect(result.mergedTabs).toEqual([restoredFirst, restoredSecond]);
    expect(result.nextActiveId).toBe('restored-first');
    expect(result.nextActiveTab).toBe(restoredFirst);
  });
});
