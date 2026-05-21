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
  resolveCloseTabTransition,
  upsertDocumentTab,
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

describe('upsertDocumentTab', () => {
  it('reuses an explicit document tab and preserves an active settings tab', () => {
    const draft = documentTab({
      id: 'draft',
      path: null,
      name: 'Untitled',
      draft: 'unsaved',
    });
    const settings = createSettingsTab();

    const result = upsertDocumentTab({
      currentTabs: [draft, settings],
      currentActiveId: SETTINGS_TAB_ID,
      path: '/tmp/restored.md',
      name: 'restored.md',
      source: '# Restored',
      reuseTabId: 'draft',
      preserveSettingsActive: true,
      generateId: () => 'unused',
    });

    expect(result.tabs).toEqual([
      createDocumentTab({
        id: 'draft',
        path: '/tmp/restored.md',
        name: 'restored.md',
        source: '# Restored',
      }),
      settings,
    ]);
    expect(result.activeTabId).toBe(SETTINGS_TAB_ID);
  });

  it('replaces a matching path before appending a new tab', () => {
    const existing = documentTab({
      id: 'existing',
      path: '/tmp/existing.md',
      name: 'existing.md',
    });
    const other = documentTab({
      id: 'other',
      path: '/tmp/other.md',
      name: 'other.md',
    });

    const result = upsertDocumentTab({
      currentTabs: [existing, other],
      currentActiveId: 'other',
      path: '/tmp/existing.md',
      name: 'existing-renamed.md',
      source: '# Reloaded',
      generateId: () => 'unused',
    });

    expect(result.tabs).toEqual([
      createDocumentTab({
        id: 'existing',
        path: '/tmp/existing.md',
        name: 'existing-renamed.md',
        source: '# Reloaded',
      }),
      other,
    ]);
    expect(result.activeTabId).toBe('existing');
  });

  it('appends a generated document tab when no existing tab matches', () => {
    const settings = createSettingsTab();

    const result = upsertDocumentTab({
      currentTabs: [settings],
      currentActiveId: SETTINGS_TAB_ID,
      path: '/tmp/new.md',
      name: 'new.md',
      source: '# New',
      generateId: () => 'generated',
    });

    expect(result.tabs).toEqual([
      settings,
      createDocumentTab({
        id: 'generated',
        path: '/tmp/new.md',
        name: 'new.md',
        source: '# New',
      }),
    ]);
    expect(result.activeTabId).toBe('generated');
  });
});

describe('resolveCloseTabTransition', () => {
  it('removes an active settings tab and restores the remembered document tab', () => {
    const first = documentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
    });
    const second = documentTab({
      id: 'second',
      path: '/tmp/second.md',
      name: 'second.md',
    });
    const settings = createSettingsTab();

    expect(
      resolveCloseTabTransition({
        tabs: [first, second, settings],
        activeTabId: SETTINGS_TAB_ID,
        targetId: SETTINGS_TAB_ID,
        preSettingsDocTabId: 'first',
      }),
    ).toEqual({
      kind: 'setTabs',
      tabs: [first, second],
      activeTabId: 'first',
      clearPreSettingsDocTabId: true,
    });
  });

  it('falls back to the adjacent tab when closing the active settings tab without a remembered document', () => {
    const first = documentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
    });
    const settings = createSettingsTab();
    const second = documentTab({
      id: 'second',
      path: '/tmp/second.md',
      name: 'second.md',
    });

    expect(
      resolveCloseTabTransition({
        tabs: [first, settings, second],
        activeTabId: SETTINGS_TAB_ID,
        targetId: SETTINGS_TAB_ID,
        preSettingsDocTabId: 'missing',
      }),
    ).toEqual({
      kind: 'setTabs',
      tabs: [first, second],
      activeTabId: 'second',
      clearPreSettingsDocTabId: true,
    });
  });

  it('clears the surface when the settings tab is the only remaining tab', () => {
    expect(
      resolveCloseTabTransition({
        tabs: [createSettingsTab()],
        activeTabId: SETTINGS_TAB_ID,
        targetId: SETTINGS_TAB_ID,
        preSettingsDocTabId: null,
      }),
    ).toEqual({ kind: 'clearSurface' });
  });

  it('switches to a neighboring tab before removing the active document tab', () => {
    const first = documentTab({
      id: 'first',
      path: '/tmp/first.md',
      name: 'first.md',
    });
    const second = documentTab({
      id: 'second',
      path: '/tmp/second.md',
      name: 'second.md',
    });

    expect(
      resolveCloseTabTransition({
        tabs: [first, second],
        activeTabId: 'first',
        targetId: 'first',
        preSettingsDocTabId: null,
      }),
    ).toEqual({
      kind: 'switchThenRemove',
      switchToTabId: 'second',
      targetId: 'first',
    });
  });

  it('closes through the final-document path when the last document tab is closed', () => {
    const only = documentTab({
      id: 'only',
      path: '/tmp/only.md',
      name: 'only.md',
    });

    expect(
      resolveCloseTabTransition({
        tabs: [only],
        activeTabId: 'only',
        targetId: 'only',
        preSettingsDocTabId: null,
      }),
    ).toEqual({ kind: 'closeOnlyRemainingDocument' });
  });

  it('removes an inactive document tab without changing the active tab', () => {
    const active = documentTab({
      id: 'active',
      path: '/tmp/active.md',
      name: 'active.md',
    });
    const inactive = documentTab({
      id: 'inactive',
      path: '/tmp/inactive.md',
      name: 'inactive.md',
    });

    expect(
      resolveCloseTabTransition({
        tabs: [active, inactive],
        activeTabId: 'active',
        targetId: 'inactive',
        preSettingsDocTabId: null,
      }),
    ).toEqual({
      kind: 'setTabs',
      tabs: [active],
      activeTabId: 'active',
      clearPreSettingsDocTabId: false,
    });
  });
});
