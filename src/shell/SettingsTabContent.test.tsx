import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

import { SettingsTabContent } from './SettingsTabContent';
import type { ThemeChoice } from './SettingsPanel';

type SettingsPanelMockProps = {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  currentTheme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
};

vi.mock('./SettingsPanel', () => ({
  SettingsPanel: ({
    settings,
    onSettingsChange,
    currentTheme,
    onThemeChange,
  }: SettingsPanelMockProps) => (
    <section
      data-testid="settings-panel"
      data-current-theme={currentTheme}
      data-font-size={String(settings.editorFontSize)}
    >
      <button
        type="button"
        onClick={() => onSettingsChange({ ...settings, editorFontSize: 18 })}
      >
        Change settings
      </button>
      <button type="button" onClick={() => onThemeChange('system')}>
        Use system theme
      </button>
      <button type="button" onClick={() => onThemeChange('dark')}>
        Use dark theme
      </button>
      <button type="button" onClick={() => onThemeChange('light')}>
        Use light theme
      </button>
    </section>
  ),
}));

function renderSettingsTab(
  overrides: Partial<React.ComponentProps<typeof SettingsTabContent>> = {},
) {
  const props = {
    settings: DEFAULT_SETTINGS,
    themeKind: 'BuiltInLight',
    onSettingsChange: vi.fn(),
    onSetTheme: vi.fn(),
    onFollowSystemTheme: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof SettingsTabContent>;

  render(<SettingsTabContent {...props} />);

  return props;
}

describe('SettingsTabContent', () => {
  afterEach(() => {
    cleanup();
  });

  it('derives the current theme choice from settings and snapshot theme', () => {
    renderSettingsTab({
      settings: { ...DEFAULT_SETTINGS, themeFollowSystem: true },
      themeKind: 'BuiltInDark',
    });
    expect(screen.getByTestId('settings-panel')).toHaveAttribute(
      'data-current-theme',
      'system',
    );
    cleanup();

    renderSettingsTab({
      settings: { ...DEFAULT_SETTINGS, themeFollowSystem: false },
      themeKind: 'BuiltInDark',
    });
    expect(screen.getByTestId('settings-panel')).toHaveAttribute(
      'data-current-theme',
      'dark',
    );
    cleanup();

    renderSettingsTab({
      settings: { ...DEFAULT_SETTINGS, themeFollowSystem: false },
      themeKind: 'BuiltInLight',
    });
    expect(screen.getByTestId('settings-panel')).toHaveAttribute(
      'data-current-theme',
      'light',
    );
  });

  it('keeps settings updates and theme choice routing owned by App handlers', () => {
    const onSettingsChange = vi.fn();
    const onSetTheme = vi.fn();
    const onFollowSystemTheme = vi.fn();

    renderSettingsTab({
      onSettingsChange,
      onSetTheme,
      onFollowSystemTheme,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use system theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use light theme' }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      editorFontSize: 18,
    });
    expect(onFollowSystemTheme).toHaveBeenCalledTimes(1);
    expect(onSetTheme).toHaveBeenCalledTimes(2);
    expect(onSetTheme).toHaveBeenNthCalledWith(1, 'BuiltInDark');
    expect(onSetTheme).toHaveBeenNthCalledWith(2, 'BuiltInLight');
  });
});
