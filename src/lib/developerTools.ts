import type { ReactGrabAPI } from 'react-grab';

import { setDevtoolsOpen } from './desktop';

type ReactGrabWindow = Window & {
  __REACT_GRAB_DISABLED__?: boolean;
  __REACT_GRAB__?: ReactGrabAPI | null;
};

let activeApi: ReactGrabAPI | null = null;
let generation = 0;
let shortcutListener: ((event: KeyboardEvent) => void) | null = null;

/**
 * Opt+C activates React Grab. Checking `code` as well as `key` matters on
 * macOS: Option+C reports "ç" as the key value.
 */
export function isReactGrabShortcut(event: KeyboardEvent): boolean {
  return (
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (event.code === 'KeyC' || event.key.toLowerCase() === 'c')
  );
}

/** Keeps DevTools and React Grab in sync with Settings → Developer Mode. */
export async function applyDeveloperMode(enabled: boolean): Promise<void> {
  const current = ++generation;

  if (!enabled) {
    disposeReactGrab();
    try {
      await setDevtoolsOpen(false);
    } catch {
      // The web preview and unit tests have no Tauri command.
    }
    return;
  }

  try {
    await setDevtoolsOpen(true);
  } catch (error) {
    console.error('Could not open DevTools:', error);
  }
  if (current !== generation || typeof window === 'undefined') return;

  try {
    // react-grab initializes itself on import. Disable that pass so the first
    // instance uses our Opt+C shortcut instead of its ⌘C default.
    (window as ReactGrabWindow).__REACT_GRAB_DISABLED__ = true;
    const grab = await import('react-grab');
    if (current !== generation) return;
    disposeReactGrab();
    activeApi = grab.init({
      // React Grab adds a 400–600ms hold delay inside editable surfaces. Opt+C
      // is handled by our immediate toggle below instead.
      activationKey: () => false,
      activationMode: 'toggle',
      allowActivationInsideInput: true,
      telemetry: false,
    });
    (window as ReactGrabWindow).__REACT_GRAB__ = activeApi;
    installShortcutListener();
  } catch (error) {
    activeApi = null;
    console.error('Could not start React Grab:', error);
  }
}

function isOverlayTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[data-react-grab], [data-react-grab-ignore-events], [data-react-grab-ignore]',
      ),
    )
  );
}

function installShortcutListener() {
  if (shortcutListener || typeof window === 'undefined') return;
  shortcutListener = (event: KeyboardEvent) => {
    if (!isReactGrabShortcut(event) || event.repeat) return;
    if (isOverlayTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    activeApi?.toggle();
  };
  window.addEventListener('keydown', shortcutListener, true);
}

function removeShortcutListener() {
  if (shortcutListener && typeof window !== 'undefined') {
    window.removeEventListener('keydown', shortcutListener, true);
  }
  shortcutListener = null;
}

function disposeReactGrab() {
  removeShortcutListener();
  try {
    activeApi?.dispose();
  } catch {
    // A partially initialized renderer may already be gone.
  }
  activeApi = null;
  if (typeof window !== 'undefined') {
    (window as ReactGrabWindow).__REACT_GRAB__ = undefined;
  }
}
