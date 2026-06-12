import { normalizeFinalNewline } from './sourceText';

export type DocumentTabKind = 'document' | 'settings';

export type DocumentTab = {
  id: string;
  kind: DocumentTabKind;
  path: string | null;
  name: string;
  source: string;
  draft: string;
  missing: boolean;
};

export const SETTINGS_TAB_ID = '__markdowner_settings__';
export const SETTINGS_TAB_NAME = 'Settings';

type TabIdEntropy = {
  randomUUID?: (() => string) | null;
  now?: () => number;
  random?: () => number;
};

type CreateDocumentTabInput = {
  id: string;
  path: string | null;
  name?: string | null;
  source?: string | null;
  draft?: string | null;
  missing?: boolean;
};

type CreateDocumentTabFromSnapshotInput = {
  id: string;
  snapshot: DocumentTabSnapshotMetadataInput;
  fallbackPath: string | null;
  fallbackName?: string | null;
};

type CreateMissingDocumentTabInput = {
  id: string;
  path: string;
  name: string;
};

type DocumentTabSnapshotMetadataInput = {
  activeDocumentPath: string | null;
  activeDocumentName: string | null;
  activeDocumentSource: string | null;
};

type DocumentTabSnapshotMetadata = {
  path: string | null;
  name: string;
  source: string;
};

type TabDirtyContext = {
  activeTabId: string | null;
  localDraft: string;
};

type ResolveDocumentTabViewStateInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  localDraft: string;
};

export type DocumentTabViewState = {
  activeTab: DocumentTab | null;
  dirtyTabIds: ReadonlySet<string>;
  isSettingsTabActive: boolean;
  hasActiveTabEdits: boolean;
  hasAnyTabEdits: boolean;
  hasUnsavedChanges: boolean;
};

type MergeRestoredDocumentTabsInput = {
  currentTabs: readonly DocumentTab[];
  restoredTabs: readonly DocumentTab[];
  currentActiveId: string | null;
  activePath: string | null;
};

type MergeRestoredDocumentTabsResult = {
  mergedTabs: DocumentTab[];
  nextActiveId: string | null;
  nextActiveTab: DocumentTab | null;
};

type RestorePersistedDocumentTabsInput = {
  paths: readonly string[];
  openPath: (path: string) => Promise<DocumentTabSnapshotMetadataInput>;
  createTabId: () => string;
  displayNameForPath: (path: string) => string;
  shouldAbort?: () => boolean;
};

type RestorePersistedDocumentTabsResult =
  | { kind: 'ready'; tabs: DocumentTab[] }
  | { kind: 'aborted' };

type HydrateRestoredActiveDocumentTabInput<Snapshot extends DocumentTabSnapshotMetadataInput> = {
  tabs: readonly DocumentTab[];
  activeTab: DocumentTab | null;
  openPath: (path: string) => Promise<Snapshot>;
  shouldAbort?: () => boolean;
};

type HydrateRestoredActiveDocumentTabResult<Snapshot extends DocumentTabSnapshotMetadataInput> =
  | {
      kind: 'ready';
      tabs: DocumentTab[];
      activeTab: DocumentTab | null;
      snapshot: Snapshot | null;
      localDraft: string | null;
    }
  | { kind: 'aborted' };

type StartupRestoreTarget<Location> = {
  path: string;
  location: Location | null;
};

type UpsertDocumentTabInput = {
  currentTabs: readonly DocumentTab[];
  currentActiveId: string | null;
  path: string | null;
  name: string;
  source: string;
  reuseTabId?: string | null;
  preserveSettingsActive?: boolean;
  generateId?: () => string;
};

type UpsertDocumentTabFromSnapshotInput = Omit<
  UpsertDocumentTabInput,
  'path' | 'name' | 'source'
> & {
  snapshot: DocumentTabSnapshotMetadataInput;
};

type UpsertDocumentTabResult = {
  tabs: DocumentTab[];
  activeTabId: string | null;
};

type ResolveCloseTabTransitionInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  targetId: string;
  preSettingsDocTabId: string | null;
};

type RememberClosedDocumentTabInput = {
  closedTabs: readonly DocumentTab[];
  closedTab: DocumentTab;
  limit?: number;
};

type PopClosedDocumentTabResult = {
  closedTab: DocumentTab | null;
  remainingClosedTabs: DocumentTab[];
};

type ResolveSettingsTabToggleInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
};

type ResolveSwitchTabTransitionInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  targetId: string;
};

type RefreshActiveDocumentTabInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  path: string | null;
  name: string;
  source: string;
};

type RefreshActiveDocumentTabFromSnapshotInput = Omit<
  RefreshActiveDocumentTabInput,
  'path' | 'name' | 'source'
> & {
  snapshot: DocumentTabSnapshotMetadataInput;
};

type RefreshSwitchedDocumentTabInput = {
  tabs: readonly DocumentTab[];
  targetId: string;
  path: string | null;
  name: string | null;
  source: string | null;
};

type RefreshSwitchedDocumentTabFromSnapshotInput = {
  tabs: readonly DocumentTab[];
  targetId: string;
  snapshot: DocumentTabSnapshotMetadataInput;
};

type CloseTabTransition =
  | { kind: 'missing' }
  | { kind: 'clearSurface' }
  | { kind: 'closeOnlyRemainingDocument' }
  | {
      kind: 'setTabs';
      tabs: DocumentTab[];
      activeTabId: string | null;
      clearPreSettingsDocTabId: boolean;
    }
  | {
      kind: 'switchThenRemove';
      switchToTabId: string;
      targetId: string;
    };

type SettingsTabToggleTransition =
  | { kind: 'closeExisting'; targetId: string }
  | {
      kind: 'activateExisting';
      activeTabId: string;
      preSettingsDocTabId: string | null;
    }
  | {
      kind: 'appendSettings';
      tabs: DocumentTab[];
      activeTabId: string;
      preSettingsDocTabId: string | null;
    };

type SwitchTabTransition =
  | { kind: 'noop' }
  | { kind: 'activateSettings'; target: DocumentTab }
  | { kind: 'activateMissing'; target: DocumentTab }
  | { kind: 'openPath'; target: DocumentTab; path: string }
  | { kind: 'newDocument'; target: DocumentTab };

export function generateDocumentTabId(entropy: TabIdEntropy = {}): string {
  const randomUUID =
    'randomUUID' in entropy
      ? entropy.randomUUID
      : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID.bind(crypto)
        : undefined;

  if (randomUUID) {
    return randomUUID();
  }

  const now = entropy.now ?? Date.now;
  const random = entropy.random ?? Math.random;
  return `tab-${now()}-${random().toString(36).slice(2)}`;
}

export function createDocumentTab(input: CreateDocumentTabInput): DocumentTab {
  const source = input.source ?? '';
  return {
    id: input.id,
    kind: 'document',
    path: input.path,
    name: input.name ?? 'Untitled',
    source,
    draft: input.draft ?? source,
    missing: input.missing ?? false,
  };
}

export function createDocumentTabFromSnapshot(
  input: CreateDocumentTabFromSnapshotInput,
): DocumentTab {
  return createDocumentTab({
    id: input.id,
    path: input.snapshot.activeDocumentPath ?? input.fallbackPath,
    name: input.snapshot.activeDocumentName ?? input.fallbackName ?? 'Untitled',
    source: input.snapshot.activeDocumentSource ?? '',
  });
}

export function createMissingDocumentTab(input: CreateMissingDocumentTabInput): DocumentTab {
  return createDocumentTab({
    id: input.id,
    path: input.path,
    name: input.name,
    missing: true,
  });
}

export function rememberClosedDocumentTab({
  closedTabs,
  closedTab,
  limit = 20,
}: RememberClosedDocumentTabInput): DocumentTab[] {
  if (closedTab.kind !== 'document') {
    return [...closedTabs];
  }

  return [
    closedTab,
    ...closedTabs.filter((tab) => tab.id !== closedTab.id),
  ].slice(0, Math.max(1, limit));
}

export function popClosedDocumentTab(
  closedTabs: readonly DocumentTab[],
): PopClosedDocumentTabResult {
  const [closedTab, ...remainingClosedTabs] = closedTabs;

  return {
    closedTab: closedTab ?? null,
    remainingClosedTabs,
  };
}

export function createSettingsTab(): DocumentTab {
  return {
    id: SETTINGS_TAB_ID,
    kind: 'settings',
    path: null,
    name: SETTINGS_TAB_NAME,
    source: '',
    draft: '',
    missing: false,
  };
}

export function documentTabMetadataFromSnapshot(
  snapshot: DocumentTabSnapshotMetadataInput,
): DocumentTabSnapshotMetadata {
  return {
    path: snapshot.activeDocumentPath ?? null,
    name: snapshot.activeDocumentName ?? 'Untitled',
    source: snapshot.activeDocumentSource ?? '',
  };
}

export function findDocumentTabByPath(
  tabs: readonly DocumentTab[],
  path: string | null,
): DocumentTab | undefined {
  return tabs.find((tab) => tab.kind === 'document' && tab.path === path);
}

export function isDocumentTabDirty(tab: DocumentTab, context: TabDirtyContext): boolean {
  if (tab.kind !== 'document') return false;

  // Close/quit prompts need a strict live-content comparison, not Rust's
  // sticky "document changed since load" flag. Normalizing one final newline
  // also ignores the WYSIWYG trailing paragraph that is not written to disk.
  const live = tab.id === context.activeTabId ? context.localDraft : tab.draft;
  return normalizeFinalNewline(live) !== normalizeFinalNewline(tab.source);
}

export function resolveDocumentTabViewState({
  tabs,
  activeTabId,
  localDraft,
}: ResolveDocumentTabViewStateInput): DocumentTabViewState {
  let activeTab: DocumentTab | null = null;
  const dirtyTabIds = new Set<string>();

  for (const tab of tabs) {
    if (tab.id === activeTabId) {
      activeTab = tab;
    }
    if (isDocumentTabDirty(tab, { activeTabId, localDraft })) {
      dirtyTabIds.add(tab.id);
    }
  }

  const hasActiveTabEdits = activeTab ? dirtyTabIds.has(activeTab.id) : false;

  return {
    activeTab,
    dirtyTabIds,
    isSettingsTabActive: activeTab?.kind === 'settings',
    hasActiveTabEdits,
    hasAnyTabEdits: dirtyTabIds.size > 0,
    hasUnsavedChanges: hasActiveTabEdits,
  };
}

export function mergeRestoredDocumentTabs(
  input: MergeRestoredDocumentTabsInput,
): MergeRestoredDocumentTabsResult {
  const currentDocumentTabs = input.currentTabs.filter((tab) => tab.kind === 'document');
  const currentUiTabs = input.currentTabs.filter((tab) => tab.kind !== 'document');
  const currentDocumentPaths = new Set(currentDocumentTabs.map((tab) => tab.path));
  const restoredAdditions = input.restoredTabs.filter(
    (tab) => !currentDocumentPaths.has(tab.path),
  );
  const mergedTabs = [...currentDocumentTabs, ...restoredAdditions, ...currentUiTabs];
  const target = input.activePath
    ? input.restoredTabs.find((tab) => tab.path === input.activePath)
    : input.restoredTabs[0];
  const currentActiveStillExists =
    input.currentActiveId !== null &&
    mergedTabs.some((tab) => tab.id === input.currentActiveId);
  const nextActiveId = currentActiveStillExists
    ? input.currentActiveId
    : target?.id ?? mergedTabs[0]?.id ?? null;
  const nextActiveTab = nextActiveId
    ? mergedTabs.find((tab) => tab.id === nextActiveId) ?? null
    : null;

  return { mergedTabs, nextActiveId, nextActiveTab };
}

export async function restorePersistedDocumentTabs(
  input: RestorePersistedDocumentTabsInput,
): Promise<RestorePersistedDocumentTabsResult> {
  const tabs: DocumentTab[] = [];

  for (const path of input.paths) {
    if (input.shouldAbort?.()) {
      return { kind: 'aborted' };
    }

    try {
      const snapshot = await input.openPath(path);
      if (input.shouldAbort?.()) {
        return { kind: 'aborted' };
      }
      tabs.push(
        createDocumentTabFromSnapshot({
          id: input.createTabId(),
          snapshot,
          fallbackPath: path,
          fallbackName: input.displayNameForPath(path),
        }),
      );
    } catch {
      if (input.shouldAbort?.()) {
        return { kind: 'aborted' };
      }
      tabs.push(
        createMissingDocumentTab({
          id: input.createTabId(),
          path,
          name: input.displayNameForPath(path),
        }),
      );
    }
  }

  return { kind: 'ready', tabs };
}

export async function hydrateRestoredActiveDocumentTab<
  Snapshot extends DocumentTabSnapshotMetadataInput,
>(
  input: HydrateRestoredActiveDocumentTabInput<Snapshot>,
): Promise<HydrateRestoredActiveDocumentTabResult<Snapshot>> {
  const tabs = [...input.tabs];
  const activeTab = input.activeTab;

  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  if (activeTab?.kind !== 'document') {
    return { kind: 'ready', tabs, activeTab, snapshot: null, localDraft: null };
  }

  if (activeTab.missing) {
    return { kind: 'ready', tabs, activeTab, snapshot: null, localDraft: '' };
  }

  if (!activeTab.path) {
    return { kind: 'ready', tabs, activeTab, snapshot: null, localDraft: null };
  }

  try {
    const snapshot = await input.openPath(activeTab.path);
    if (input.shouldAbort?.()) {
      return { kind: 'aborted' };
    }
    return {
      kind: 'ready',
      tabs,
      activeTab,
      snapshot,
      localDraft: snapshot.activeDocumentSource ?? '',
    };
  } catch {
    if (input.shouldAbort?.()) {
      return { kind: 'aborted' };
    }
    const nextTabs = markDocumentTabMissing(tabs, activeTab.id);
    const nextActiveTab = nextTabs.find((tab) => tab.id === activeTab.id) ?? null;
    return {
      kind: 'ready',
      tabs: nextTabs,
      activeTab: nextActiveTab,
      snapshot: null,
      localDraft: '',
    };
  }
}

export function startupRestoreTargetForDocumentTab<Location>(
  tab: DocumentTab | null,
  cursorPositions: Readonly<Record<string, Location>>,
): StartupRestoreTarget<Location> | null {
  if (tab?.kind !== 'document' || !tab.path || tab.missing) {
    return null;
  }

  return {
    path: tab.path,
    location: cursorPositions[tab.path] ?? null,
  };
}

export function upsertDocumentTab(input: UpsertDocumentTabInput): UpsertDocumentTabResult {
  const current = input.currentTabs;
  let tabs = current;
  let documentTabId: string | null = null;

  const replaceAt = (index: number) => {
    tabs = current.map((tab, tabIndex) =>
      tabIndex === index
        ? createDocumentTab({
            id: tab.id,
            path: input.path,
            name: input.name,
            source: input.source,
          })
        : tab,
    );
    documentTabId = tabs[index].id;
  };

  if (input.reuseTabId) {
    const reusedAt = current.findIndex(
      (tab) => tab.kind === 'document' && tab.id === input.reuseTabId,
    );
    if (reusedAt >= 0) replaceAt(reusedAt);
  }

  // Untitled tabs (path === null) are never merged by path: each one is an
  // independent buffer keyed by id, so a new untitled document always appends
  // (Zed-style) instead of replacing another untitled tab's draft.
  if (documentTabId === null && input.path !== null) {
    const matchAt = current.findIndex(
      (tab) => tab.kind === 'document' && tab.path === input.path,
    );
    if (matchAt >= 0) replaceAt(matchAt);
  }

  if (documentTabId === null) {
    const newTab = createDocumentTab({
      id: input.generateId?.() ?? generateDocumentTabId(),
      path: input.path,
      name: input.name,
      source: input.source,
    });
    tabs = [...current, newTab];
    documentTabId = newTab.id;
  }

  const currentActiveIsSettings =
    input.preserveSettingsActive === true &&
    input.currentActiveId !== null &&
    tabs.some((tab) => tab.id === input.currentActiveId && tab.kind === 'settings');

  return {
    tabs: [...tabs],
    activeTabId: currentActiveIsSettings ? input.currentActiveId : documentTabId,
  };
}

export function upsertDocumentTabFromSnapshot(
  input: UpsertDocumentTabFromSnapshotInput,
): UpsertDocumentTabResult {
  const { snapshot, ...rest } = input;
  return upsertDocumentTab({
    ...rest,
    ...documentTabMetadataFromSnapshot(snapshot),
  });
}

export function resolveCloseTabTransition(
  input: ResolveCloseTabTransitionInput,
): CloseTabTransition {
  const targetIndex = input.tabs.findIndex((tab) => tab.id === input.targetId);
  if (targetIndex < 0) return { kind: 'missing' };

  const target = input.tabs[targetIndex];
  const remaining = input.tabs.filter((tab) => tab.id !== input.targetId);

  if (target.kind === 'settings') {
    if (remaining.length === 0) {
      return { kind: 'clearSurface' };
    }

    const activeTabId =
      input.targetId === input.activeTabId
        ? selectTabAfterClose({
            remainingTabs: remaining,
            closedIndex: targetIndex,
            preferredTabId: input.preSettingsDocTabId,
          })?.id ?? null
        : input.activeTabId;

    return {
      kind: 'setTabs',
      tabs: remaining,
      activeTabId,
      clearPreSettingsDocTabId: true,
    };
  }

  if (remaining.length === 0) {
    return { kind: 'closeOnlyRemainingDocument' };
  }

  if (input.targetId === input.activeTabId) {
    const fallback = selectTabAfterClose({
      remainingTabs: remaining,
      closedIndex: targetIndex,
      preferredTabId: null,
    });
    return {
      kind: 'switchThenRemove',
      switchToTabId: fallback?.id ?? remaining[0]?.id ?? '',
      targetId: input.targetId,
    };
  }

  return {
    kind: 'setTabs',
    tabs: remaining,
    activeTabId: input.activeTabId,
    clearPreSettingsDocTabId: false,
  };
}

export function resolveSettingsTabToggle(
  input: ResolveSettingsTabToggleInput,
): SettingsTabToggleTransition {
  const existing = input.tabs.find((tab) => tab.kind === 'settings');

  if (existing) {
    if (existing.id === input.activeTabId) {
      return { kind: 'closeExisting', targetId: existing.id };
    }

    return {
      kind: 'activateExisting',
      activeTabId: existing.id,
      preSettingsDocTabId: input.activeTabId,
    };
  }

  return {
    kind: 'appendSettings',
    tabs: [...input.tabs, createSettingsTab()],
    activeTabId: SETTINGS_TAB_ID,
    preSettingsDocTabId: input.activeTabId,
  };
}

export function resolveSwitchTabTransition(
  input: ResolveSwitchTabTransitionInput,
): SwitchTabTransition {
  if (input.targetId === input.activeTabId) {
    return { kind: 'noop' };
  }

  const target = input.tabs.find((tab) => tab.id === input.targetId);
  if (!target) {
    return { kind: 'noop' };
  }

  if (target.kind === 'settings') {
    return { kind: 'activateSettings', target };
  }

  if (target.missing && target.path) {
    return { kind: 'activateMissing', target };
  }

  if (target.path) {
    return { kind: 'openPath', target, path: target.path };
  }

  return { kind: 'newDocument', target };
}

function selectTabAfterClose(input: {
  remainingTabs: readonly DocumentTab[];
  closedIndex: number;
  preferredTabId: string | null;
}): DocumentTab | null {
  const preferred = input.preferredTabId
    ? input.remainingTabs.find((tab) => tab.id === input.preferredTabId)
    : null;
  return (
    preferred ??
    input.remainingTabs[input.closedIndex] ??
    input.remainingTabs[input.closedIndex - 1] ??
    input.remainingTabs[0] ??
    null
  );
}

export function refreshActiveDocumentTab(
  input: RefreshActiveDocumentTabInput,
): DocumentTab[] {
  if (!input.activeTabId) return [...input.tabs];
  return input.tabs.map((tab) =>
    tab.id === input.activeTabId && tab.kind === 'document'
      ? createDocumentTab({
          id: tab.id,
          path: input.path,
          name: input.name,
          source: input.source,
        })
      : tab,
  );
}

export function refreshActiveDocumentTabFromSnapshot(
  input: RefreshActiveDocumentTabFromSnapshotInput,
): DocumentTab[] {
  const { snapshot, ...rest } = input;
  return refreshActiveDocumentTab({
    ...rest,
    ...documentTabMetadataFromSnapshot(snapshot),
  });
}

export function refreshSwitchedDocumentTab(
  input: RefreshSwitchedDocumentTabInput,
): DocumentTab[] {
  return input.tabs.map((tab) =>
    tab.id === input.targetId && tab.kind === 'document'
      ? {
          ...tab,
          source: input.source ?? tab.source,
          name: input.name ?? tab.name,
          path: input.path ?? tab.path,
          missing: false,
        }
      : tab,
  );
}

export function refreshSwitchedDocumentTabFromSnapshot(
  input: RefreshSwitchedDocumentTabFromSnapshotInput,
): DocumentTab[] {
  return refreshSwitchedDocumentTab({
    tabs: input.tabs,
    targetId: input.targetId,
    path: input.snapshot.activeDocumentPath,
    name: input.snapshot.activeDocumentName,
    source: input.snapshot.activeDocumentSource,
  });
}

export function stashDocumentTabDraft(
  tabs: readonly DocumentTab[],
  activeTabId: string,
  draft: string,
): DocumentTab[] {
  return tabs.map((tab) =>
    tab.id === activeTabId && tab.kind === 'document' ? { ...tab, draft } : tab,
  );
}

export function markDocumentTabMissing(
  tabs: readonly DocumentTab[],
  targetId: string,
): DocumentTab[] {
  return tabs.map((tab) =>
    tab.id === targetId && tab.kind === 'document'
      ? { ...tab, missing: true, source: '', draft: '' }
      : tab,
  );
}
