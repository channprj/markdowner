import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { aiCancel } from '@/lib/desktop';
import { AiActivityTab } from './AiActivityTab';
import { AiHistoryTab, type AiHistoryServices } from './AiHistoryTab';
import {
  AiWorkbenchPanel,
  type AiWorkbenchPanelProps,
} from './AiWorkbenchPanel';
import type { AiFeatureTab } from './types';
import { useAiRuntime, type AiRuntimeServices } from './useAiRuntime';

export interface AiFeaturePanelProps extends Omit<AiWorkbenchPanelProps, 'showHeader'> {
  runtimeServices?: AiRuntimeServices;
  historyServices?: AiHistoryServices;
  cancelService?: (requestId: string) => Promise<boolean>;
}

export function AiFeaturePanel({
  runtimeServices,
  historyServices,
  cancelService = aiCancel,
  ...newRequestProps
}: AiFeaturePanelProps) {
  const [tab, setTab] = useState<AiFeatureTab>('new');
  const [resumeInterview, setResumeInterview] = useState<{
    requestId: string;
    documentId: string;
  } | null>(null);
  const runtime = useAiRuntime({
    historyEnabled: newRequestProps.settings.aiHistoryEnabled,
    services: runtimeServices,
  });

  const cancelRun = async (requestId: string) => {
    await cancelService(requestId);
    await runtime.reloadActivity();
  };

  return (
    <section
      aria-labelledby="ai-feature-heading"
      className="ai-motion-surface flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="ai-feature-panel"
    >
      <header className="shrink-0 border-b border-border px-3 pt-3">
        <h2 id="ai-feature-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4" />
          AI Feature
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Improve, translate, or transform Markdown with explicit review.
        </p>
        <div role="tablist" aria-label="AI Feature views" className="mt-3 flex gap-1">
          {(['new', 'activity', 'history'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={tab === candidate}
              className={
                tab === candidate
                  ? 'border-b-2 border-primary px-2 py-1.5 text-xs font-medium text-foreground'
                  : 'border-b-2 border-transparent px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
              }
              onClick={() => setTab(candidate)}
            >
              {tabLabel(candidate, runtime.activeRuns.length)}
            </button>
          ))}
        </div>
      </header>

        <div hidden={tab !== 'new'} className={tab === 'new' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
          {runtime.activeRuns.length > 0 ? (
            <button
              type="button"
              className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2 text-left text-xs"
              onClick={() => setTab('activity')}
            >
              <span>{runtime.activeRuns.length} AI request{runtime.activeRuns.length === 1 ? '' : 's'} running</span>
              <span className="text-muted-foreground">View activity</span>
            </button>
          ) : null}
          <AiWorkbenchPanel
            {...newRequestProps}
            showHeader={false}
            guidedPrd
            resumeInterviewRequest={resumeInterview}
          />
        </div>
      {tab === 'activity' ? (
        <div role="tabpanel" aria-label="Activity" className="min-h-0 flex-1 overflow-y-auto">
          <AiActivityTab
            runs={runtime.activeRuns}
            loading={runtime.activityLoading}
            error={runtime.activityError}
            onCancel={(requestId) => void cancelRun(requestId)}
          />
        </div>
      ) : tab === 'history' && newRequestProps.settings.aiHistoryEnabled ? (
        <div role="tabpanel" aria-label="History" className="flex min-h-0 flex-1">
          <AiHistoryTab
            history={runtime.history}
            loading={runtime.historyLoading}
            error={runtime.historyError}
            onPageChange={runtime.setHistoryPage}
            onReload={runtime.reloadHistory}
            resumableDocumentIds={[
              newRequestProps.documentId,
              ...(newRequestProps.openDocuments ?? []).map((document) => document.documentId),
            ]}
            onResumeInterview={(requestId, documentId) => {
              setResumeInterview({ requestId, documentId });
              setTab('new');
            }}
            services={historyServices}
          />
        </div>
      ) : tab === 'history' ? (
        <div role="tabpanel" aria-label="History" className="p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Local history is off</p>
          <p className="mt-1 text-xs leading-relaxed">
            Enable Keep local AI history in Settings → AI Feature Settings to retain run metadata.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function tabLabel(tab: AiFeatureTab, activeCount: number): string {
  if (tab === 'new') return 'New';
  if (tab === 'history') return 'History';
  return activeCount > 0 ? `Activity (${activeCount})` : 'Activity';
}
