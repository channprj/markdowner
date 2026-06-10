import type { OpenTabsPayload } from './desktop';
import type { DocumentTab } from './documentTabs';
import type { SourceCursorLocation } from './modeCursor';

type BuildOpenTabsPayloadInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  cursorPositions: ReadonlyMap<string, SourceCursorLocation>;
};

type LoadOpenTabsWithEmptyRetryInput = {
  load: () => Promise<OpenTabsPayload>;
  waitForRetry: () => Promise<void>;
  shouldAbort?: () => boolean;
};

type LoadOpenTabsWithEmptyRetryResult =
  | { kind: 'ready'; payload: OpenTabsPayload }
  | { kind: 'aborted' };

type StartupCursorRestoreTarget = {
  path: string;
  location: SourceCursorLocation | null;
};

type LoadStartupCursorRestoreStateInput = {
  load: () => Promise<OpenTabsPayload>;
  activePath: string | null;
  shouldAbort?: () => boolean;
};

type LoadStartupCursorRestoreStateResult =
  | {
      kind: 'ready';
      cursorPositions: Map<string, SourceCursorLocation>;
      restoreTarget: StartupCursorRestoreTarget | null;
    }
  | { kind: 'aborted' }
  | { kind: 'failed' };

export function buildOpenTabsPayload(
  input: BuildOpenTabsPayloadInput,
): OpenTabsPayload {
  const openTabs = input.tabs
    .filter((tab): tab is DocumentTab & { kind: 'document'; path: string } => {
      return tab.kind === 'document' && tab.path !== null;
    })
    .map((tab) => tab.path);
  const openTabSet = new Set(openTabs);
  const activeTabPath =
    input.activeTabId === null
      ? null
      : input.tabs.find(
          (tab) =>
            tab.id === input.activeTabId &&
            tab.kind === 'document' &&
            tab.path !== null,
        )?.path ?? null;
  const cursorPositions: OpenTabsPayload['cursorPositions'] = {};

  for (const [path, location] of input.cursorPositions.entries()) {
    if (!openTabSet.has(path)) continue;
    cursorPositions[path] = {
      line: location.line,
      column: location.column,
    };
  }

  return {
    openTabs,
    activeTabPath,
    cursorPositions,
  };
}

export function cursorPositionsMapFromOpenTabsPayload(
  payload: OpenTabsPayload,
): Map<string, SourceCursorLocation> {
  // Tolerate payloads without the map (older session files, partial mocks) —
  // the startup restore path treats "no cursor data" as non-fatal everywhere
  // else, so a missing field must not throw mid-bootstrap.
  return new Map(Object.entries(payload.cursorPositions ?? {}));
}

export async function loadStartupCursorRestoreState(
  input: LoadStartupCursorRestoreStateInput,
): Promise<LoadStartupCursorRestoreStateResult> {
  let payload: OpenTabsPayload;
  try {
    payload = await input.load();
  } catch {
    return input.shouldAbort?.() ? { kind: 'aborted' } : { kind: 'failed' };
  }

  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  const cursorPositions = cursorPositionsMapFromOpenTabsPayload(payload);
  return {
    kind: 'ready',
    cursorPositions,
    restoreTarget: input.activePath
      ? {
          path: input.activePath,
          location: payload.cursorPositions?.[input.activePath] ?? null,
        }
      : null,
  };
}

export async function loadOpenTabsWithEmptyRetry(
  input: LoadOpenTabsWithEmptyRetryInput,
): Promise<LoadOpenTabsWithEmptyRetryResult> {
  const first = await input.load();
  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  if (first.openTabs.length > 0) {
    return { kind: 'ready', payload: first };
  }

  await input.waitForRetry();
  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  const retried = await input.load();
  if (input.shouldAbort?.()) {
    return { kind: 'aborted' };
  }

  return {
    kind: 'ready',
    payload: retried.openTabs.length > 0 ? retried : first,
  };
}
