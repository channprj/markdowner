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

type TabDirtyContext = {
  activeTabId: string | null;
  localDraft: string;
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

type ResolveSettingsTabToggleInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
};

type RefreshActiveDocumentTabInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  path: string | null;
  name: string;
  source: string;
};

type RefreshSwitchedDocumentTabInput = {
  tabs: readonly DocumentTab[];
  targetId: string;
  path: string | null;
  name: string | null;
  source: string | null;
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

export function findDocumentTabByPath(
  tabs: readonly DocumentTab[],
  path: string | null,
): DocumentTab | undefined {
  return tabs.find((tab) => tab.kind === 'document' && tab.path === path);
}

export function isDocumentTabDirty(tab: DocumentTab, context: TabDirtyContext): boolean {
  if (tab.kind !== 'document') return false;
  const live = tab.id === context.activeTabId ? context.localDraft : tab.draft;
  return normalizeFinalNewline(live) !== normalizeFinalNewline(tab.source);
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

  if (documentTabId === null && input.path !== null) {
    const matchAt = current.findIndex(
      (tab) => tab.kind === 'document' && tab.path === input.path,
    );
    if (matchAt >= 0) replaceAt(matchAt);
  }

  if (documentTabId === null && input.path === null) {
    const untitledAt = current.findIndex(
      (tab) => tab.kind === 'document' && tab.path === null,
    );
    if (untitledAt >= 0) replaceAt(untitledAt);
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
