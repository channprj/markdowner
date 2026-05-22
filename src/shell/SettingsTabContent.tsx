import type { ThemeKind } from '@/lib/desktop';
import type { Settings } from '@/lib/settings';

import { SettingsPanel, type ThemeChoice } from './SettingsPanel';

interface SettingsTabContentProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  themeKind: ThemeKind;
  onSetTheme: (themeKind: ThemeKind) => void;
  onFollowSystemTheme: () => void;
}

export function SettingsTabContent({
  settings,
  onSettingsChange,
  themeKind,
  onSetTheme,
  onFollowSystemTheme,
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
