import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { UpdateInfo } from '@/lib/updateCheck';

import { SettingsPanel } from './SettingsPanel';

vi.mock('@/lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings')>();
  return {
    ...actual,
    cliBinaryStatus: vi.fn().mockResolvedValue({
      installPath: '',
      targetExecutable: '',
      installed: false,
      inPath: false,
    }),
    ctrlGLauncherStatus: vi.fn().mockResolvedValue({
      shellConfigPath: '',
      snippet: '',
      installed: false,
    }),
  };
});

const availableUpdate: UpdateInfo = {
  available: true,
  currentVersion: '0.260528.2',
  latestVersion: '0.260601.0',
  dmgUrl: 'https://example.com/x.dmg',
  releaseUrl: 'https://example.com/release',
  notes: '',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const props = {
    settings: DEFAULT_SETTINGS,
    onSettingsChange: vi.fn(),
    currentTheme: 'light' as const,
    onThemeChange: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof SettingsPanel>;
  render(<SettingsPanel {...props} />);
  return props;
}

describe('SettingsPanel update section', () => {
  afterEach(() => cleanup());

  it('shows the update action and fires onUpdateAction when available', () => {
    const onUpdateAction = vi.fn();
    renderPanel({ updateInfo: availableUpdate, onUpdateAction });
    expect(screen.getByTestId('settings-update-available')).toHaveTextContent('0.260601.0');
    fireEvent.click(screen.getByTestId('settings-update-action'));
    expect(onUpdateAction).toHaveBeenCalledTimes(1);
  });

  it('shows "Check now" and fires onCheckForUpdate when no update is available', () => {
    const onCheckForUpdate = vi.fn();
    renderPanel({ updateInfo: null, onCheckForUpdate });
    expect(screen.queryByTestId('settings-update-action')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-update-check'));
    expect(onCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it('toggles the launch update-check setting', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });
    fireEvent.click(screen.getByTestId('settings-update-toggle'));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ updateCheckEnabled: false }),
    );
  });
});
