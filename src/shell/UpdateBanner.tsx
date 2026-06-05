import { ArrowUpCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface UpdateBannerProps {
  latestVersion: string;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  latestVersion,
  actionLabel,
  busy,
  onAction,
  onDismiss,
}: UpdateBannerProps) {
  return (
    <div
      data-testid="update-banner"
      className="flex items-center justify-between gap-3 border-b border-border bg-emerald-500/10 px-3 py-2 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ArrowUpCircle className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="truncate">
          A new version <span className="font-semibold">v{latestVersion}</span> is available.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" size="sm" onClick={onAction} disabled={busy}>
          {busy ? 'Working…' : actionLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Dismiss update notification"
          onClick={onDismiss}
          disabled={busy}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
