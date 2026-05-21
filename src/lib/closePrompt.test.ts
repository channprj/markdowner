import { describe, expect, it } from 'vitest';

import { createDocumentTab, createSettingsTab } from './documentTabs';
import {
  buildCloseConfirmationDialog,
  resolveActiveClosePromptState,
  resolveClosePromptState,
} from './closePrompt';

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

describe('resolveActiveClosePromptState', () => {
  it('requires a prompt only when the active document has real edits', () => {
    const activeTab = createDocumentTab({
      id: 'active',
      path: '/tmp/active.md',
      source: 'Saved',
      draft: 'Stale dirty draft',
    });

    expect(
      resolveActiveClosePromptState({
        tabs: [activeTab],
        activeTabId: activeTab.id,
        activeDraft: 'Saved\n',
      }),
    ).toEqual({
      activeDirty: false,
      requiresPrompt: false,
    });

    expect(
      resolveActiveClosePromptState({
        tabs: [activeTab],
        activeTabId: activeTab.id,
        activeDraft: 'Changed\n',
      }),
    ).toEqual({
      activeDirty: true,
      requiresPrompt: true,
    });
  });

  it('does not prompt when the active tab is not a document', () => {
    const settingsTab = createSettingsTab();

    expect(
      resolveActiveClosePromptState({
        tabs: [settingsTab],
        activeTabId: settingsTab.id,
        activeDraft: 'Changed',
      }),
    ).toEqual({
      activeDirty: false,
      requiresPrompt: false,
    });
  });
});

describe('buildCloseConfirmationDialog', () => {
  it('builds the shared save confirmation message and button options', () => {
    expect(buildCloseConfirmationDialog('notes.md', 'Markdowner')).toEqual({
      message: "Save changes to 'notes.md' before closing?",
      options: {
        title: 'Markdowner',
        kind: 'warning',
        buttons: {
          yes: 'Save',
          no: "Don't Save",
          cancel: 'Cancel',
        },
      },
    });
  });

  it('uses Untitled.md when there is no active document name', () => {
    expect(buildCloseConfirmationDialog(null, 'Markdowner').message).toBe(
      "Save changes to 'Untitled.md' before closing?",
    );
  });
});
