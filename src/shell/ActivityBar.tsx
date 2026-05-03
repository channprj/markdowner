import { cn } from '@/lib/utils';
import { Files, ListTree, Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ActivityBarProps {
  onOpenSettings?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenOutline?: () => void;
  className?: string;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  isSettingsOpen?: boolean;
  isQuickOpenOpen?: boolean;
  isOutlineOpen?: boolean;
}

export function ActivityBar({
  className,
  onToggleSidebar,
  isSidebarOpen,
  onOpenSettings,
  onOpenQuickOpen,
  onOpenOutline,
  isSettingsOpen,
  isQuickOpenOpen,
  isOutlineOpen,
}: ActivityBarProps) {
  const activeClass = 'bg-accent text-accent-foreground';
  const inactiveClass = 'text-muted-foreground hover:text-foreground';
  return (
    <div
      role="toolbar"
      aria-label="Activity Bar"
      aria-orientation="vertical"
      className={cn("flex flex-col items-center py-2 bg-muted/50 border-r border-border h-full", className)}
    >
      <div className="flex flex-col gap-2 w-full px-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn('w-8 h-8 rounded-md', isSidebarOpen ? activeClass : inactiveClass)}
          onClick={onToggleSidebar}
          title="Explorer (Cmd+B)"
          aria-label="Explorer (Cmd+B)"
          aria-keyshortcuts="Meta+B Control+B"
          aria-pressed={Boolean(isSidebarOpen)}
        >
          <Files className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('w-8 h-8 rounded-md', isQuickOpenOpen ? activeClass : inactiveClass)}
          title="Quick Open (Cmd+P)"
          aria-label="Quick Open (Cmd+P)"
          aria-keyshortcuts="Meta+P Control+P"
          aria-pressed={Boolean(isQuickOpenOpen)}
          onClick={onOpenQuickOpen}
        >
          <Search className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('w-8 h-8 rounded-md', isOutlineOpen ? activeClass : inactiveClass)}
          title="Outline"
          aria-label="Outline"
          aria-pressed={Boolean(isOutlineOpen)}
          onClick={onOpenOutline}
        >
          <ListTree className="w-5 h-5" />
        </Button>
      </div>
      <div className="mt-auto flex flex-col gap-2 w-full px-2 mb-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn('w-8 h-8 rounded-md', isSettingsOpen ? activeClass : inactiveClass)}
          title="Settings (Cmd+,)"
          aria-label="Settings (Cmd+,)"
          aria-keyshortcuts="Meta+, Control+,"
          aria-pressed={Boolean(isSettingsOpen)}
          onClick={onOpenSettings}
        >
          <Settings className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
