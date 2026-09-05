import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { aiCancel } from '@/lib/desktop';
import { AiActivityTab } from './AiActivityTab';
import { useAiRuntime, type AiRuntimeServices } from './useAiRuntime';

export function AiRunProgress({ requestId, services, cancelService = aiCancel }: {
  requestId: string;
  services?: AiRuntimeServices;
  cancelService?: (requestId: string) => Promise<boolean>;
}) {
  const runtime = useAiRuntime({ historyEnabled: false, services });
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const run = runtime.activeRuns.find((run) => run.requestId === requestId);
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      if (!await cancelService(requestId)) {
        setCancelError('The request is no longer active. Waiting for its final status.');
      }
      await runtime.reloadActivity();
    } catch {
      setCancelError('Could not cancel the request. Try again.');
    } finally { setCancelling(false); }
  };
  return (
    <section aria-label="Live AI progress" className="rounded-md border border-border bg-muted/20">
      {run ? (
        <AiActivityTab runs={[{ ...run, cancelable: run.cancelable && !cancelling }]}
          onCancel={() => void cancel()} error={cancelError ?? runtime.activityError} />
      ) : (
        <p role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          AI request in progress… Waiting for live status.
        </p>
      )}
    </section>
  );
}
