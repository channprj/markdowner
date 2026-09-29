import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from './settings';
import { useUpdateCheck } from './useUpdateCheck';
import type { UpdateInfo } from './updateCheck';

const checkForUpdateMock = vi.fn();
const downloadAndInstallUpdateMock = vi.fn();

vi.mock('./updateCheck', async (importOriginal) => {
  const original = await importOriginal<typeof import('./updateCheck')>();
  return {
    ...original,
    checkForUpdate: (...args: unknown[]) => checkForUpdateMock(...args),
    downloadAndInstallUpdate: (...args: unknown[]) =>
      downloadAndInstallUpdateMock(...args),
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

describe('useUpdateCheck install', () => {
  beforeEach(() => {
    checkForUpdateMock.mockReset();
    checkForUpdateMock.mockResolvedValue({
      available: true,
      currentVersion: '0.0.0',
      latestVersion: '9.9.9',
      dmgUrl: 'https://example.invalid/markdowner.dmg',
      releaseUrl: 'https://example.invalid',
      notes: '',
    });
    downloadAndInstallUpdateMock.mockReset();
    downloadAndInstallUpdateMock.mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('awaits the onBeforeInstall flush before launching the installer', async () => {
    const callOrder: string[] = [];
    const onBeforeInstall = vi.fn(async () => {
      callOrder.push('flush');
    });
    downloadAndInstallUpdateMock.mockImplementation(async () => {
      callOrder.push('install');
    });

    const settings = settingsWith({
      updateCheckEnabled: true,
      lastUpdateCheckAt: null,
    });
    const { result } = renderHook(() =>
      useUpdateCheck(settings, vi.fn(), true, { onBeforeInstall }),
    );

    await waitFor(() => {
      expect(result.current.info?.available).toBe(true);
    });

    await act(async () => {
      await result.current.install();
    });

    expect(callOrder).toEqual(['flush', 'install']);
  });

  it('keeps documents open when the pre-install flush fails and allows a retry', async () => {
    const onBeforeInstall = vi.fn(async (): Promise<void> => {
      throw new Error('flush failed');
    });

    const settings = settingsWith({
      updateCheckEnabled: true,
      lastUpdateCheckAt: null,
    });
    const { result } = renderHook(() =>
      useUpdateCheck(settings, vi.fn(), true, { onBeforeInstall }),
    );

    await waitFor(() => {
      expect(result.current.info?.available).toBe(true);
    });

    await act(async () => {
      await result.current.install();
    });

    expect(downloadAndInstallUpdateMock).not.toHaveBeenCalled();
    expect(result.current.installing).toBe(false);
    onBeforeInstall.mockResolvedValueOnce(undefined);
    await act(async () => { await result.current.install(); });
    expect(downloadAndInstallUpdateMock).toHaveBeenCalledOnce();
  });

  it('exposes a failed refresh and clears the failure when a retry starts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() =>
        useUpdateCheck(settingsWith({ updateCheckEnabled: false }), vi.fn(), true),
      );
      await act(async () => { await result.current.checkNow(); });
      expect(result.current.info?.latestVersion).toBe('9.9.9');
      expect(result.current.checkFailed).toBe(false);

      checkForUpdateMock.mockRejectedValueOnce(new Error('Offline'));
      await act(async () => { await result.current.checkNow(); });
      expect(result.current.checkFailed).toBe(true);
      expect(result.current.checking).toBe(false);

      let finishCheck!: (info: UpdateInfo) => void;
      checkForUpdateMock.mockReturnValueOnce(new Promise((resolve) => { finishCheck = resolve; }));
      let retry!: Promise<void>;
      act(() => { retry = result.current.checkNow(); });
      expect(result.current.checking).toBe(true);
      expect(result.current.checkFailed).toBe(false);
      await act(async () => {
        finishCheck({
          available: false,
          currentVersion: '9.9.9',
          latestVersion: '9.9.9',
          dmgUrl: null,
          releaseUrl: 'https://example.invalid',
          notes: '',
        });
        await retry;
      });
      expect(result.current.checking).toBe(false);
      expect(result.current.checkFailed).toBe(false);
      expect(result.current.info?.available).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
