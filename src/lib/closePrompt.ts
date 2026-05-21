import { isDocumentTabDirty, type DocumentTab } from './documentTabs';

export type ClosePromptTarget = 'window' | 'app';

type ResolveClosePromptStateInput = {
  tabs: readonly DocumentTab[];
  activeTabId: string | null;
  activeDraft: string;
  target: ClosePromptTarget;
};

type ClosePromptState = {
  activeDirty: boolean;
  firstDirtyTabId: string | null;
  requiresPrompt: boolean;
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
