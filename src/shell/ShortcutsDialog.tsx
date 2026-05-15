import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ShortcutRow = { keys: string; label: string };
type ShortcutSection = { title: string; rows: ShortcutRow[] };

const SECTIONS: ShortcutSection[] = [
  {
    title: 'General',
    rows: [
      { keys: '⌘N', label: 'New file' },
      { keys: '⌘T', label: 'New tab' },
      { keys: '⌘O', label: 'Open file' },
      { keys: '⌘⇧O', label: 'Open workspace' },
      { keys: '⌘S', label: 'Save' },
      { keys: '⌘⇧S', label: 'Save As' },
      { keys: '⌘W', label: 'Close tab' },
      { keys: '⌘Q', label: 'Quit' },
      { keys: '⌘,', label: 'Open Settings' },
      { keys: '⌘/', label: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Navigation',
    rows: [
      { keys: '⌘P', label: 'Quick Open' },
      { keys: '⌘⇧P', label: 'Command Palette' },
      { keys: '⌘⇧I', label: 'Document Stats' },
      { keys: '⌘0', label: 'Toggle Explorer focus' },
      { keys: '⌘1 – ⌘9', label: 'Jump to tab 1–9' },
      { keys: '⌘⇧]', label: 'Next tab' },
      { keys: '⌘⇧[', label: 'Previous tab' },
      { keys: '⌃⇧PgDn', label: 'Move tab right' },
      { keys: '⌃⇧PgUp', label: 'Move tab left' },
    ],
  },
  {
    title: 'Find & Search',
    rows: [
      { keys: '⌘F', label: 'Find in document (or filter Explorer)' },
      { keys: '⌥⌘F', label: 'Find & Replace' },
      { keys: '⌃H', label: 'Find & Replace (alt)' },
      { keys: '⌘⇧F', label: 'Search across workspace' },
      { keys: 'Esc', label: 'Close find bar' },
    ],
  },
  {
    title: 'Editor Modes',
    rows: [
      { keys: '⌥1', label: 'WYSIWYG mode' },
      { keys: '⌥2', label: 'Editor mode' },
      { keys: '⌥3', label: 'Split View' },
      { keys: '⌘K → W', label: 'WYSIWYG mode (chord)' },
      { keys: '⌘K → E', label: 'Editor mode (chord)' },
      { keys: '⌘K → S', label: 'Split View (chord)' },
      { keys: '⌘⇧T', label: 'Toggle Typewriter Mode' },
    ],
  },
  {
    title: 'Sidebar',
    rows: [
      { keys: '⌘⇧E', label: 'Show Explorer panel' },
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Quick reference for Markdowner. Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">⌘/</kbd> any time to reopen.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="grid gap-5 sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <section key={section.title} className="flex min-w-0 flex-col gap-1.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h3>
                <ul className="flex flex-col gap-1">
                  {section.rows.map((row) => (
                    <li
                      key={`${section.title}-${row.keys}-${row.label}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate">{row.label}</span>
                      <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none">
                        {row.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
