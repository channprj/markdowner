import { invoke } from '@tauri-apps/api/core';

/** Update status returned by the Rust `check_for_update` command (camelCase). */
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  dmgUrl: string | null;
  releaseUrl: string;
  notes: string;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Cadence of the in-app re-check timer. The app is a long-running editor —
 * launch-only checks miss every release shipped while it stays open. The tick
 * itself is cheap and local; `shouldCheckNow` still gates the actual network
 * call to once per 24h via `lastUpdateCheckAt`.
 */
export const UPDATE_RECHECK_TICK_MS = 60 * 60 * 1000;

/** Pure throttle gate: should the launch check hit the network now? */
export function shouldCheckNow(
  enabled: boolean,
  lastCheckedAt: number | null,
  now: number,
): boolean {
  if (!enabled) {
    return false;
  }
  if (lastCheckedAt === null) {
    return true;
  }
  return now - lastCheckedAt >= TWENTY_FOUR_HOURS_MS;
}

/** Pure: should the launch banner show for this update + dismissal state? */
export function isUpdateBannerVisible(
  info: UpdateInfo | null,
  sessionDismissed: boolean,
  dismissedVersion: string | null,
): boolean {
  if (!info || !info.available || sessionDismissed) {
    return false;
  }
  return dismissedVersion !== info.latestVersion;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>('check_for_update');
}

export async function downloadAndInstallUpdate(dmgUrl: string): Promise<void> {
  await invoke('download_and_install_update', { dmgUrl });
}
