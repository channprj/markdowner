import type { ThemeKind } from '@/lib/desktop';
import type { DefaultMdHandlerStatus } from '@/lib/defaultApp';
import type { Settings } from '@/lib/settings';
import type { UpdateInfo } from '@/lib/updateCheck';
import { resolveInlineStyleTone } from '@/lib/inlineStylePalette';
import { resolveOsTheme } from '@/lib/themeScope';

import { SettingsPanel, type ThemeChoice } from './SettingsPanel';

interface SettingsTabContentProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  themeKind: ThemeKind;
  onSetTheme: (themeKind: ThemeKind) => void;
  onFollowSystemTheme: () => void;
  updateInfo?: UpdateInfo | null;
  updateActionLabel?: string;
  updateBusy?: boolean;
  updateChecking?: boolean;
  updateCheckFailed?: boolean;
  onUpdateAction?: () => void;
  onCheckForUpdate?: () => void;
  defaultMdHandler?: DefaultMdHandlerStatus | null;
  defaultMdHandlerBusy?: boolean;
  onDefaultMdHandlerChange?: (status: DefaultMdHandlerStatus | null) => void;
}

export function SettingsTabContent({
  settings,
  onSettingsChange,
  themeKind,
  onSetTheme,
  onFollowSystemTheme,
  updateInfo,
  updateActionLabel,
  updateBusy,
  updateChecking,
  updateCheckFailed,
  onUpdateAction,
  onCheckForUpdate,
  defaultMdHandler,
  defaultMdHandlerBusy,
  onDefaultMdHandlerChange,
}: SettingsTabContentProps) {
  const currentTheme = resolveSettingsThemeChoice(settings, themeKind);

  const handleThemeChange = (choice: ThemeChoice) => {
    if (choice === 'system') {
      onFollowSystemTheme();
      return;
    }

    onSetTheme(choice === 'dark' ? 'BuiltInDark' : 'BuiltInLight');
  };

  return (
    <SettingsPanel
      settings={settings}
      onSettingsChange={onSettingsChange}
      currentTheme={currentTheme}
      onThemeChange={handleThemeChange}
      inlineStyleTone={resolveInlineStyleTone(themeKind, resolveOsTheme())}
      updateInfo={updateInfo}
      updateActionLabel={updateActionLabel}
      updateBusy={updateBusy}
      updateChecking={updateChecking}
      updateCheckFailed={updateCheckFailed}
      onUpdateAction={onUpdateAction}
      onCheckForUpdate={onCheckForUpdate}
      defaultMdHandler={defaultMdHandler}
      defaultMdHandlerBusy={defaultMdHandlerBusy}
      onDefaultMdHandlerChange={onDefaultMdHandlerChange}
    />
  );
}

function resolveSettingsThemeChoice(
  settings: Pick<Settings, 'themeFollowSystem'>,
  themeKind: ThemeKind,
): ThemeChoice {
  if (settings.themeFollowSystem) {
    return 'system';
  }

  return themeKind === 'BuiltInDark' ? 'dark' : 'light';
}
