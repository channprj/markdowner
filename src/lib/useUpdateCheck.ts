import { useCallback, useEffect, useRef, useState } from 'react';

import { openExternalUrl } from './desktop';
import type { Settings } from './settings';
import {
  UPDATE_RECHECK_TICK_MS,
  checkForUpdate,
  downloadAndInstallUpdate,
  isUpdateBannerVisible,
  shouldCheckNow,
  type UpdateInfo,
} from './updateCheck';

/** True only inside the Tauri shell, where the Rust backend exists. */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface UseUpdateCheck {
  info: UpdateInfo | null;
  bannerVisible: boolean;
  checking: boolean;
  installing: boolean;
  checkNow: () => Promise<void>;
  dismissBanner: () => void;
  viewRelease: () => void;
  install: () => Promise<void>;
}

interface UseUpdateCheckOptions {
  onManualCheckComplete?: (info: UpdateInfo) => void;
}

/**
 * Owns the launch update check (24h throttle) and the resulting state.
 * `ready` gates the launch check until persisted settings have loaded, so we
 * never check against the initial defaults.
 */
export function useUpdateCheck(
  settings: Settings,
  onSettingsChange: (next: Settings) => void,
  ready: boolean,
  options: UseUpdateCheckOptions = {},
): UseUpdateCheck {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const launchedRef = useRef(false);

  // Keep the latest settings and change handler in refs so callbacks have a
  // stable identity — otherwise they'd be re-created every render (the parent
  // recreates `onSettingsChange` each render), churning the launch effect.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onSettingsChangeRef = useRef(onSettingsChange);
  onSettingsChangeRef.current = onSettingsChange;
  const onManualCheckCompleteRef = useRef(options.onManualCheckComplete);
  onManualCheckCompleteRef.current = options.onManualCheckComplete;

  const runCheck = useCallback(async (manual = false) => {
    setChecking(true);
    try {
      const result = await checkForUpdate();
      setInfo(result);
      onSettingsChangeRef.current({ ...settingsRef.current, lastUpdateCheckAt: Date.now() });
      if (manual) {
        onManualCheckCompleteRef.current?.(result);
      }
    } catch (error) {
      console.error('Update check failed:', error);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // The launch check needs the Rust backend; skip it outside the Tauri shell
    // (web preview, tests) where there is nothing to call.
    if (!ready || launchedRef.current || !inTauri()) {
      return;
    }
    launchedRef.current = true;
    if (shouldCheckNow(settings.updateCheckEnabled, settings.lastUpdateCheckAt, Date.now())) {
      void runCheck(false);
    }
  }, [ready, runCheck, settings.updateCheckEnabled, settings.lastUpdateCheckAt]);

  // Periodic re-check while the app stays running. The editor commonly lives
  // for days, so a launch-only check misses every release shipped meanwhile.
  // Toggling the setting off tears the timer down immediately (effect
  // cleanup); the hourly tick is local and shouldCheckNow still limits actual
  // network checks to once per 24h.
  useEffect(() => {
    if (!ready || !inTauri() || !settings.updateCheckEnabled) {
      return;
    }
    const timer = window.setInterval(() => {
      const current = settingsRef.current;
      if (shouldCheckNow(current.updateCheckEnabled, current.lastUpdateCheckAt, Date.now())) {
        void runCheck(false);
      }
    }, UPDATE_RECHECK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [ready, runCheck, settings.updateCheckEnabled]);

  const bannerVisible = isUpdateBannerVisible(
    info,
    sessionDismissed,
    settings.dismissedUpdateVersion,
  );

  const dismissBanner = useCallback(() => {
    setSessionDismissed(true);
    if (info) {
      onSettingsChangeRef.current({
        ...settingsRef.current,
        dismissedUpdateVersion: info.latestVersion,
      });
    }
  }, [info]);

  const checkNow = useCallback(() => runCheck(true), [runCheck]);

  const viewRelease = useCallback(() => {
    if (info) {
      void openExternalUrl(info.releaseUrl);
    }
  }, [info]);

  const install = useCallback(async () => {
    if (!info) {
      return;
    }
    if (!info.dmgUrl) {
      void openExternalUrl(info.releaseUrl);
      return;
    }
    setInstalling(true);
    try {
      await downloadAndInstallUpdate(info.dmgUrl);
    } catch (error) {
      console.error('Update install failed:', error);
      setInstalling(false);
    }
    // On success the app exits and relaunches, so we leave `installing` true.
  }, [info]);

  return {
    info,
    bannerVisible,
    checking,
    installing,
    checkNow,
    dismissBanner,
    viewRelease,
    install,
  };
}
