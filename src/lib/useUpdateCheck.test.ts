import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from './settings';
import { useUpdateCheck } from './useUpdateCheck';

const checkForUpdateMock = vi.fn();

vi.mock('./updateCheck', async (importOriginal) => {
  const original = await importOriginal<typeof import('./updateCheck')>();
  return {
    ...original,
    checkForUpdate: (...args: unknown[]) => checkForUpdateMock(...args),
  };
});

function settingsWith(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

const HOUR_MS = 60 * 60 * 1000;

describe('useUpdateCheck periodic re-check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkForUpdateMock.mockReset();
    checkForUpdateMock.mockResolvedValue({
      available: false,
      currentVersion: '0.0.0',
      latestVersion: '0.0.0',
      dmgUrl: null,
      releaseUrl: 'https://example.invalid',
      notes: '',
    });
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('re-checks while the app stays running once the 24h throttle elapses', async () => {
    // lastUpdateCheckAt = now → the launch check is throttled away; only the
    // in-app timer can trigger the next check.
    const settings = settingsWith({
      updateCheckEnabled: true,
      lastUpdateCheckAt: Date.now(),
    });
    renderHook(() => useUpdateCheck(settings, vi.fn(), true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(23 * HOUR_MS);
    });
    expect(checkForUpdateMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
    });
    expect(checkForUpdateMock).toHaveBeenCalled();
  });

  it('never checks while the setting is off', async () => {
    const settings = settingsWith({
      updateCheckEnabled: false,
      lastUpdateCheckAt: null,
    });
    renderHook(() => useUpdateCheck(settings, vi.fn(), true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(48 * HOUR_MS);
    });
    expect(checkForUpdateMock).not.toHaveBeenCalled();
  });

  it('tears the timer down when the toggle flips off mid-session', async () => {
    const initial = settingsWith({
      updateCheckEnabled: true,
      lastUpdateCheckAt: Date.now(),
    });
    const { rerender } = renderHook(
      ({ current }: { current: Settings }) => useUpdateCheck(current, vi.fn(), true),
      { initialProps: { current: initial } },
    );

    rerender({ current: settingsWith({ ...initial, updateCheckEnabled: false }) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(72 * HOUR_MS);
    });
    expect(checkForUpdateMock).not.toHaveBeenCalled();
  });
});
