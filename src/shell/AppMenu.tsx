import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Check,
  Code,
  Columns2,
  Eye,
  FileUp,
  Menu,
  Monitor,
  Moon,
  Save,
  Settings,
  Sun,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EditorMode, ThemeKind } from '@/lib/desktop';

interface AppMenuProps {
  className?: string;
  busy: boolean;
  activeDocumentOpen: boolean;
  currentMode: EditorMode;
  themeKind: ThemeKind;
  themeMode: 'manual' | 'system';
  onSave: () => void;
  onSaveAs: () => void;
  onImportTheme: () => void;
  onSetMode: (mode: EditorMode) => void;
  onSetTheme: (theme: ThemeKind) => void;
  onFollowSystemTheme: () => void;
  onOpenSettings: () => void;
}

type MenuActionProps = {
  children: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
  shortcut?: string;
  ariaKeyshortcuts?: string;
  onSelect: () => void;
};

type MenuRadioProps = {
  children: ReactNode;
  checked: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  title?: string;
  ariaLabel?: string;
  ariaKeyshortcuts?: string;
  onSelect: () => void;
};

const itemClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-popover-foreground outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50';

function MenuAction({
  children,
  disabled,
  icon,
  title,
  shortcut,
  ariaKeyshortcuts,
  onSelect,
}: MenuActionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      aria-keyshortcuts={ariaKeyshortcuts}
      className={itemClass}
      onClick={onSelect}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <span aria-hidden="true" className="ml-2 shrink-0 text-xs text-muted-foreground">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

function MenuRadio({
  children,
  checked,
  disabled,
  icon,
  title,
  ariaLabel,
  ariaKeyshortcuts,
  onSelect,
}: MenuRadioProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-keyshortcuts={ariaKeyshortcuts}
      disabled={disabled}
      title={title}
      className={itemClass}
      onClick={onSelect}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Check className={cn('size-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
    </button>
  );
}

function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[0.68rem] font-medium uppercase text-muted-foreground">
      {children}
    </div>
  );
}

function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function AppMenu({
  className,
  busy,
  activeDocumentOpen,
  currentMode,
  themeKind,
  themeMode,
  onSave,
  onSaveAs,
  onImportTheme,
  onSetMode,
  onSetTheme,
  onFollowSystemTheme,
  onOpenSettings,
}: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative z-40 shrink-0', className)}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        type="button"
        aria-label="App menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="App menu"
        onClick={() => setOpen((current) => !current)}
      >
        <Menu className="size-4" />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="App menu"
          className="absolute right-0 top-8 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-none"
        >
          <MenuSectionLabel>File</MenuSectionLabel>
          <MenuAction
            disabled={!activeDocumentOpen || busy}
            icon={<Save className="size-4" />}
            title="Save (Cmd+S)"
            shortcut="Cmd+S"
            ariaKeyshortcuts="Meta+S Control+S"
            onSelect={() => run(onSave)}
          >
            Save
          </MenuAction>
          <MenuAction
            disabled={!activeDocumentOpen || busy}
            icon={<Save className="size-4" />}
            title="Save As (Cmd+Shift+S)"
            shortcut="Cmd+Shift+S"
            ariaKeyshortcuts="Meta+Shift+S Control+Shift+S"
            onSelect={() => run(onSaveAs)}
          >
            Save As…
          </MenuAction>
          <MenuAction
            disabled={busy}
            icon={<FileUp className="size-4" />}
            title="Import a custom CSS theme"
            onSelect={() => run(onImportTheme)}
          >
            Import CSS…
          </MenuAction>

          <MenuSeparator />
          <MenuSectionLabel>Mode</MenuSectionLabel>
          <MenuRadio
            checked={currentMode === 'Editor'}
            disabled={busy}
            icon={<Code className="size-4" />}
            title="Editor (Cmd+1)"
            ariaKeyshortcuts="Meta+1 Control+1"
            onSelect={() => run(() => onSetMode('Editor'))}
          >
            Editor
          </MenuRadio>
          <MenuRadio
            checked={currentMode === 'Wysiwyg'}
            disabled={busy}
            icon={<Eye className="size-4" />}
            title="WYSIWYG (Cmd+2)"
            ariaKeyshortcuts="Meta+2 Control+2"
            onSelect={() => run(() => onSetMode('Wysiwyg'))}
          >
            WYSIWYG
          </MenuRadio>
          <MenuRadio
            checked={currentMode === 'SplitView'}
            disabled={busy}
            icon={<Columns2 className="size-4" />}
            title="Split View (Cmd+3)"
            ariaKeyshortcuts="Meta+3 Control+3"
            onSelect={() => run(() => onSetMode('SplitView'))}
          >
            Split View
          </MenuRadio>

          <MenuSeparator />
          <MenuSectionLabel>Theme</MenuSectionLabel>
          <MenuRadio
            checked={themeMode === 'manual' && themeKind === 'BuiltInLight'}
            disabled={busy}
            icon={<Sun className="size-4" />}
            title="Light theme"
            ariaLabel="Light theme"
            onSelect={() => run(() => onSetTheme('BuiltInLight'))}
          >
            Light
          </MenuRadio>
          <MenuRadio
            checked={themeMode === 'manual' && themeKind === 'BuiltInDark'}
            disabled={busy}
            icon={<Moon className="size-4" />}
            title="Dark theme"
            ariaLabel="Dark theme"
            onSelect={() => run(() => onSetTheme('BuiltInDark'))}
          >
            Dark
          </MenuRadio>
          <MenuRadio
            checked={themeMode === 'system'}
            disabled={busy}
            icon={<Monitor className="size-4" />}
            title="Follow system theme"
            ariaLabel="Follow system theme"
            onSelect={() => run(onFollowSystemTheme)}
          >
            System
          </MenuRadio>

          <MenuSeparator />
          <MenuAction
            icon={<Settings className="size-4" />}
            onSelect={() => run(onOpenSettings)}
          >
            Settings
          </MenuAction>
        </div>
      ) : null}
    </div>
  );
}
