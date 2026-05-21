import type { AppSnapshot } from './desktop';

export function clearActiveDocumentSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    activeDocumentName: null,
    activeDocumentPath: null,
    activeDocumentSource: null,
    activeDocumentDirty: false,
    lastError: null,
  };
}
