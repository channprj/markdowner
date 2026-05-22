import { normalizeFinalNewline } from './sourceText';

type ResolveActiveDraftSyncPlanInput = {
  activeDocumentOpen: boolean;
  activeDocumentSource: string | null;
  localDraft: string;
  flushedDraft: string | null;
  forFinalSave?: boolean;
};

type ActiveDraftSyncPlan = {
  outgoingDraft: string;
  shouldReplaceActiveSource: boolean;
  shouldUpdateLocalDraft: boolean;
};

type ResolveAutoSaveEligibilityInput = {
  autoSave: boolean;
  busy: boolean;
  activeDocumentOpen: boolean;
  activeDocumentPath: string | null | undefined;
  hasUnsavedChanges: boolean;
};

type AutoSaveEligibility = {
  shouldSchedule: boolean;
  shouldRun: boolean;
};

type ResolveDraftMirrorSyncPlanInput = {
  activeDocumentSource: string | null;
  activeDocumentPath: string | null;
  localDraft: string;
};

type DraftMirrorSyncPlan = {
  draft: string;
  activeDocumentPath: string | null;
};

export function resolveActiveDraftSyncPlan(
  input: ResolveActiveDraftSyncPlanInput,
): ActiveDraftSyncPlan | null {
  if (!input.activeDocumentOpen || input.activeDocumentSource === null) {
    return null;
  }

  const draft = input.flushedDraft ?? input.localDraft;
  const outgoingDraft = input.forFinalSave ? normalizeFinalNewline(draft) : draft;

  return {
    outgoingDraft,
    shouldReplaceActiveSource:
      normalizeFinalNewline(outgoingDraft) !== normalizeFinalNewline(input.activeDocumentSource),
    shouldUpdateLocalDraft: outgoingDraft !== draft,
  };
}

export function resolveAutoSaveEligibility({
  autoSave,
  busy,
  activeDocumentOpen,
  activeDocumentPath,
  hasUnsavedChanges,
}: ResolveAutoSaveEligibilityInput): AutoSaveEligibility {
  const shouldSchedule =
    autoSave &&
    activeDocumentOpen &&
    Boolean(activeDocumentPath) &&
    hasUnsavedChanges;

  return {
    shouldSchedule,
    shouldRun: shouldSchedule && !busy,
  };
}

export function resolveDraftMirrorSyncPlan({
  activeDocumentSource,
  activeDocumentPath,
  localDraft,
}: ResolveDraftMirrorSyncPlanInput): DraftMirrorSyncPlan | null {
  if (activeDocumentSource === null) {
    return null;
  }

  if (localDraft === activeDocumentSource) {
    return null;
  }

  return {
    draft: localDraft,
    activeDocumentPath,
  };
}
