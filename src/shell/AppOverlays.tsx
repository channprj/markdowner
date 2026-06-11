import type { DocumentStats } from '@/lib/documentStats';

import { CommandPalette, type CommandPaletteCommand } from './CommandPalette';
import { DefaultAppPromptDialog } from './DefaultAppPromptDialog';
import { DocumentStatsDialog } from './DocumentStatsDialog';
import { QuickOpen, type QuickOpenItem } from './QuickOpen';
import { ShortcutsDialog } from './ShortcutsDialog';

export interface AppOverlaysProps {
  quickOpenOpen: boolean;
  onQuickOpenOpenChange: (open: boolean) => void;
  quickOpenItems: QuickOpenItem[];
  onQuickOpenSelect: (path: string) => void;
  commandPaletteOpen: boolean;
  onCommandPaletteOpenChange: (open: boolean) => void;
  commandPaletteCommands: CommandPaletteCommand[];
  documentStatsOpen: boolean;
  onDocumentStatsOpenChange: (open: boolean) => void;
  documentName: string | null;
  documentPath: string | null;
  stats: DocumentStats;
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
  defaultAppPromptOpen: boolean;
  defaultAppPromptBusy?: boolean;
  onDefaultAppPromptOpenChange: (open: boolean) => void;
  onMakeDefaultApp: () => void;
  onSkipDefaultAppPrompt: () => void;
}

export function AppOverlays({
  quickOpenOpen,
  onQuickOpenOpenChange,
  quickOpenItems,
  onQuickOpenSelect,
  commandPaletteOpen,
  onCommandPaletteOpenChange,
  commandPaletteCommands,
  documentStatsOpen,
  onDocumentStatsOpenChange,
  documentName,
  documentPath,
  stats,
  shortcutsOpen,
  onShortcutsOpenChange,
  defaultAppPromptOpen,
  defaultAppPromptBusy,
  onDefaultAppPromptOpenChange,
  onMakeDefaultApp,
  onSkipDefaultAppPrompt,
}: AppOverlaysProps) {
  return (
    <>
      <DefaultAppPromptDialog
        open={defaultAppPromptOpen}
        busy={defaultAppPromptBusy}
        onOpenChange={onDefaultAppPromptOpenChange}
        onMakeDefault={onMakeDefaultApp}
        onSkip={onSkipDefaultAppPrompt}
      />
      <QuickOpen
        open={quickOpenOpen}
        onOpenChange={onQuickOpenOpenChange}
        items={quickOpenItems}
        onSelect={onQuickOpenSelect}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={onCommandPaletteOpenChange}
        commands={commandPaletteCommands}
      />
      <DocumentStatsDialog
        open={documentStatsOpen}
        onOpenChange={onDocumentStatsOpenChange}
        documentName={documentName}
        documentPath={documentPath}
        stats={stats}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={onShortcutsOpenChange}
      />
    </>
  );
}
