import { describe, expect, it } from 'vitest';

import { createDocumentTab, createSettingsTab } from './documentTabs';
import { resolveClosePromptState } from './closePrompt';

describe('resolveClosePromptState', () => {
  it('prompts window closes only for active document edits', () => {
    const activeTab = createDocumentTab({
      id: 'active',
      path: '/tmp/active.md',
      source: 'Saved\n',
      draft: 'Saved\n',
    });
    const inactiveDirtyTab = createDocumentTab({
      id: 'inactive',
      path: '/tmp/inactive.md',
      source: 'Saved\n',
      draft: 'Changed\n',
    });

    expect(
      resolveClosePromptState({
        tabs: [activeTab, inactiveDirtyTab],
        activeTabId: activeTab.id,
        activeDraft: activeTab.draft,
        target: 'window',
      }),
    ).toEqual({
      activeDirty: false,
      firstDirtyTabId: inactiveDirtyTab.id,
      requiresPrompt: false,
    });
  });

  it('prompts app quits for dirty inactive documents and identifies the first dirty tab', () => {
    const activeTab = createDocumentTab({
      id: 'active',
      path: '/tmp/active.md',
      source: 'Saved\n',
      draft: 'Saved\n',
    });
    const inactiveDirtyTab = createDocumentTab({
      id: 'inactive',
      path: '/tmp/inactive.md',
      source: 'Saved\n',
      draft: 'Changed\n',
    });

    expect(
      resolveClosePromptState({
        tabs: [activeTab, inactiveDirtyTab],
        activeTabId: activeTab.id,
        activeDraft: activeTab.draft,
        target: 'app',
      }),
    ).toEqual({
      activeDirty: false,
      firstDirtyTabId: inactiveDirtyTab.id,
      requiresPrompt: true,
    });
  });

  it('uses the flushed active draft and normalizes final newlines', () => {
    const activeTab = createDocumentTab({
      id: 'active',
      path: '/tmp/active.md',
      source: 'Saved',
      draft: 'Stale dirty draft',
    });

    expect(
      resolveClosePromptState({
        tabs: [activeTab],
        activeTabId: activeTab.id,
        activeDraft: 'Saved\n',
        target: 'window',
      }),
    ).toEqual({
      activeDirty: false,
      firstDirtyTabId: null,
      requiresPrompt: false,
    });
  });

  it('treats Settings as not dirty while still finding dirty document tabs on quit', () => {
    const settingsTab = createSettingsTab();
    const dirtyTab = createDocumentTab({
      id: 'dirty',
      path: '/tmp/dirty.md',
      source: 'Saved\n',
      draft: 'Changed\n',
    });

    expect(
      resolveClosePromptState({
        tabs: [settingsTab, dirtyTab],
        activeTabId: settingsTab.id,
        activeDraft: '',
        target: 'app',
      }),
    ).toEqual({
      activeDirty: false,
      firstDirtyTabId: dirtyTab.id,
      requiresPrompt: true,
    });
  });
});
