import { invoke } from '@tauri-apps/api/core';

/**
 * Default-app registration for Markdown files. macOS-only — the Rust side
 * reports `supported: false` elsewhere, which hides the UI affordances.
 */
export interface DefaultMdHandlerStatus {
  supported: boolean;
  isDefault: boolean;
  /** Path of the app currently handling .md, when resolvable. */
  currentHandlerPath: string | null;
}

export async function defaultMdHandlerStatus(): Promise<DefaultMdHandlerStatus | null> {
  try {
    return await invoke<DefaultMdHandlerStatus>('default_md_handler_status');
  } catch (error) {
    console.error('Failed to query default .md handler status:', error);
    return null;
  }
}

export async function setDefaultMdHandler(): Promise<void> {
  await invoke('set_default_md_handler');
}

/**
 * The one-time first-launch prompt shows only when it could change anything:
 * never re-asks, never asks when already default, never asks where the
 * platform cannot apply it, and stays quiet if the status query failed.
 */
export function shouldShowDefaultAppPrompt(input: {
  promptSeen: boolean;
  status: DefaultMdHandlerStatus | null;
}): boolean {
  if (input.promptSeen || !input.status) return false;
  return input.status.supported && !input.status.isDefault;
}
