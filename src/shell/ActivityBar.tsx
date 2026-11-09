import { cn } from '@/lib/utils';
import { Files, ListTree, Search, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ActivityBarProps {
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onOpenOutline?: () => void;
  onOpenAi?: () => void;
  className?: string;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  isSettingsOpen?: boolean;
  isSearchOpen?: boolean;
  isOutlineOpen?: boolean;
  isAiOpen?: boolean;
}

export function ActivityBar({
  className,
  onToggleSidebar,
  isSidebarOpen,
  onOpenSettings,
  onOpenSearch,
  onOpenOutline,
  onOpenAi,
  isSettingsOpen,
  isSearchOpen,
  isOutlineOpen,
  isAiOpen,
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
          title="Explorer (Cmd+Shift+E)"
          aria-label="Explorer (Cmd+Shift+E)"
          aria-keyshortcuts="Meta+Shift+E Control+Shift+E"
          aria-pressed={Boolean(isSidebarOpen)}
        >
          <Files className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('w-8 h-8 rounded-md', isSearchOpen ? activeClass : inactiveClass)}
          title="Search (Cmd+Shift+F)"
          aria-label="Search (Cmd+Shift+F)"
          aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
          aria-pressed={Boolean(isSearchOpen)}
          onClick={onOpenSearch}
        >
          <Search className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('w-8 h-8 rounded-md', isOutlineOpen ? activeClass : inactiveClass)}
          title="Outline (Cmd+Shift+D)"
          aria-label="Outline (Cmd+Shift+D)"
          aria-keyshortcuts="Meta+Shift+D Control+Shift+D"
          aria-pressed={Boolean(isOutlineOpen)}
          onClick={onOpenOutline}
        >
          <ListTree className="w-5 h-5" />
        </Button>
        {onOpenAi ? (
          <Button
            variant="ghost"
            size="icon"
            className={cn('w-8 h-8 rounded-md', isAiOpen ? activeClass : inactiveClass)}
            title="AI Feature (Cmd+Shift+A)"
            aria-label="AI Feature (Cmd+Shift+A)"
            aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
            aria-pressed={Boolean(isAiOpen)}
            onClick={onOpenAi}
          >
            <Sparkles className="w-5 h-5" />
          </Button>
        ) : null}
      </div>
      <div className="mt-auto flex flex-col gap-2 w-full px-2 mb-0.5">
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
