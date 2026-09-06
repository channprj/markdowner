import { useState } from 'react';
import { LoaderCircle, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  const error = cancelError ?? runtime.activityError;
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
          onCancel={() => void cancel()} error={error} />
      ) : (
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
              AI request in progress… Waiting for live status.
            </p>
            <Button type="button" size="sm" variant="outline" aria-label="Cancel AI request"
              disabled={cancelling} onClick={() => void cancel()}>
              <Square className="size-3" />
              Cancel
            </Button>
          </div>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
