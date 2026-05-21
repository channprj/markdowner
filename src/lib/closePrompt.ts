import { isDocumentTabDirty, type DocumentTab } from './documentTabs';

export type ClosePromptTarget = 'window' | 'app';

type ResolveClosePromptStateInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  activeDraft: string;
  target: ClosePromptTarget;
};

type ResolveActiveClosePromptStateInput = Omit<ResolveClosePromptStateInput, 'target'>;

type ActiveClosePromptState = {
  activeDirty: boolean;
  requiresPrompt: boolean;
};

type ClosePromptState = {
  activeDirty: boolean;
  firstDirtyTabId: string | null;
  requiresPrompt: boolean;
};

type CloseConfirmationDialog = {
  message: string;
  options: {
    title: string;
    kind: 'warning';
    buttons: {
      yes: string;
      no: string;
      cancel: string;
    };
  };
};

export function resolveClosePromptState(
  input: ResolveClosePromptStateInput,
): ClosePromptState {
  const dirtyContext = {
    activeTabId: input.activeTabId,
    localDraft: input.activeDraft,
  };
  const isDirty = (tab: DocumentTab) => isDocumentTabDirty(tab, dirtyContext);
  const activeTab = input.activeTabId
    ? input.tabs.find((tab) => tab.id === input.activeTabId) ?? null
    : null;
  const activeDirty = activeTab ? isDirty(activeTab) : false;
  const firstDirtyTab = input.tabs.find(isDirty) ?? null;

  return {
    activeDirty,
    firstDirtyTabId: firstDirtyTab?.id ?? null,
    requiresPrompt: input.target === 'app' ? firstDirtyTab !== null : activeDirty,
  };
}

export function resolveActiveClosePromptState(
  input: ResolveActiveClosePromptStateInput,
): ActiveClosePromptState {
  const activeState = resolveClosePromptState({
    ...input,
    target: 'window',
  });

  return {
    activeDirty: activeState.activeDirty,
    requiresPrompt: activeState.requiresPrompt,
  };
}

export function buildCloseConfirmationDialog(
  activeDocumentName: string | null | undefined,
  title: string,
): CloseConfirmationDialog {
  return {
    message: `Save changes to '${activeDocumentName ?? 'Untitled.md'}' before closing?`,
    options: {
      title,
      kind: 'warning',
      buttons: {
        yes: 'Save',
        no: "Don't Save",
        cancel: 'Cancel',
      },
    },
  };
}
