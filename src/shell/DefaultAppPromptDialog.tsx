import { FileCheck2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DefaultAppPromptDialogProps {
  open: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onMakeDefault: () => void;
  onSkip: () => void;
}

export function DefaultAppPromptDialog({
  open,
  busy = false,
  onOpenChange,
  onMakeDefault,
  onSkip,
}: DefaultAppPromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Open Markdown files with Markdowner?</DialogTitle>
          <DialogDescription>
            Finder can use Markdowner whenever you double-click .md and .markdown
            files. You can change this later in Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            disabled={busy}
          >
            Not now
          </Button>
          <Button type="button" onClick={onMakeDefault} disabled={busy}>
            <FileCheck2 />
            {busy ? 'Working...' : 'Make Default'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
