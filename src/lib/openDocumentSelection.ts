import type { AppSnapshot } from './desktop';
import {
  createDocumentTabFromSnapshot,
  findDocumentTabByPath,
  type DocumentTab,
} from './documentTabs';

type OpenSelectedDocumentTabsInput = {
  paths: readonly string[];
  currentTabs: readonly DocumentTab[];
  openPath: (path: string) => Promise<AppSnapshot>;
  createTabId: () => string;
  displayNameForPath?: (path: string) => string;
  shouldAbort?: () => boolean;
};

type OpenSelectedDocumentTabsResult =
  | { kind: 'aborted' }
  | {
      kind: 'ready';
      additions: DocumentTab[];
      lastSnapshot: AppSnapshot | null;
      lastActiveId: string | null;
    };

type ResolveOpenSelectedDocumentTabsTransitionInput = {
  result: OpenSelectedDocumentTabsResult;
  currentTabs: readonly DocumentTab[];
};

type ResolveOpenDocumentPathTransitionInput = {
  currentTabs: readonly DocumentTab[];
  path: string;
};

type OpenSelectedDocumentTabsTransition =
  | { kind: 'noop' }
  | {
      kind: 'appendAdditions';
      tabs: DocumentTab[];
      activeTabId: string;
      snapshot: AppSnapshot;
    }
  | {
      kind: 'switchExisting';
      activeTabId: string;
    };

type OpenDocumentPathTransition =
  | {
      kind: 'switchExisting';
      activeTabId: string;
    }
  | {
      kind: 'openPath';
      path: string;
    };

export function resolveOpenDocumentPathTransition(
  input: ResolveOpenDocumentPathTransitionInput,
): OpenDocumentPathTransition {
  const existing = findDocumentTabByPath(input.currentTabs, input.path);
  if (existing) {
    return {
      kind: 'switchExisting',
      activeTabId: existing.id,
    };
  }

  return {
    kind: 'openPath',
    path: input.path,
  };
}

export async function openSelectedDocumentTabs(
  input: OpenSelectedDocumentTabsInput,
): Promise<OpenSelectedDocumentTabsResult> {
  const additions: DocumentTab[] = [];
  let lastSnapshot: AppSnapshot | null = null;
  let lastActiveId: string | null = null;

  for (const path of input.paths) {
    const existing =
      findDocumentTabByPath(input.currentTabs, path) ??
      additions.find((tab) => tab.path === path);
    if (existing) {
      lastActiveId = existing.id;
      continue;
    }

    const next = await input.openPath(path);
    if (input.shouldAbort?.()) {
      return { kind: 'aborted' };
    }

    const tab = createDocumentTabFromSnapshot({
      id: input.createTabId(),
      snapshot: next,
      fallbackPath: path,
      fallbackName: input.displayNameForPath?.(path) ?? path,
    });
    additions.push(tab);
    lastSnapshot = next;
    lastActiveId = tab.id;
  }

  return {
    kind: 'ready',
    additions,
    lastSnapshot,
    lastActiveId,
  };
}

export function resolveOpenSelectedDocumentTabsTransition(
  input: ResolveOpenSelectedDocumentTabsTransitionInput,
): OpenSelectedDocumentTabsTransition {
  if (input.result.kind === 'aborted') {
    return { kind: 'noop' };
  }

  const { additions, lastSnapshot, lastActiveId } = input.result;

  if (additions.length > 0 && lastSnapshot && lastActiveId) {
    return {
      kind: 'appendAdditions',
      tabs: [...input.currentTabs, ...additions],
      activeTabId: lastActiveId,
      snapshot: lastSnapshot,
    };
  }

  if (lastActiveId) {
    return {
      kind: 'switchExisting',
      activeTabId: lastActiveId,
    };
  }

  return { kind: 'noop' };
}
