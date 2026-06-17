import posthog from 'posthog-js';

// Project (write-only) API key — safe to ship in the client bundle.
const POSTHOG_KEY = 'phc_qQ6Rft3mAeStoCsN9t7KDpfhxEhynWy7aFTdDh4ZiECi';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let initialized = false;

/**
 * Analytics is a best-effort, fire-and-forget side channel: it must never throw
 * into the app and must never run under tests (jsdom). Guard once here so the
 * callers can stay trivial.
 */
function analyticsDisabled(): boolean {
  return import.meta.env.MODE === 'test' || typeof window === 'undefined';
}

function initOnce(): void {
  if (initialized) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    defaults: '2026-05-30',
    // Privacy: this is a local Markdown editor, so document text, file names,
    // and paths must never leave the machine. Autocapture (which records the
    // text of clicked elements) and session recording are the two paths that
    // could leak document content — both stay off. We rely on a small set of
    // explicit, content-free events instead.
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    persistence: 'localStorage',
    person_profiles: 'identified_only',
  });
  initialized = true;
  posthog.register({
    app_version: __APP_VERSION__,
    app_env: import.meta.env.PROD ? 'production' : 'development',
  });
  posthog.capture('app_opened');
}

/**
 * Reconcile PostHog with the user's opt-out setting. Idempotent and safe to call
 * on every settings change:
 *  - enabled, first time    → initialize (opted in) and send `app_opened`
 *  - enabled, already init   → opt back in
 *  - disabled, initialized   → opt out (stops all capture/network)
 *  - disabled, never init'd  → no-op (nothing was ever loaded)
 */
export function syncAnalytics(enabled: boolean): void {
  if (analyticsDisabled()) return;
  try {
    if (enabled) {
      if (initialized) {
        posthog.opt_in_capturing();
      } else {
        initOnce();
      }
    } else if (initialized) {
      posthog.opt_out_capturing();
    }
  } catch (error) {
    console.error('Failed to sync analytics:', error);
  }
}

/** Capture a content-free product event. No-op until analytics is initialized. */
export function capture(event: string, properties?: Record<string, unknown>): void {
  if (analyticsDisabled() || !initialized) return;
  try {
    posthog.capture(event, properties);
  } catch (error) {
    console.error('Failed to capture analytics event:', error);
  }
}
