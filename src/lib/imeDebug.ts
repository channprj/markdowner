/**
 * Lightweight IME diagnostics. Off by default; enable from the WebView
 * devtools console with:
 *
 *   localStorage.setItem('markdowner:imeDebug', '1'); location.reload();
 *
 * Then reproduce the bug and copy the `[IME]` lines from the console.
 *
 * This exists because the CJK input bugs only reproduce in Tauri's WKWebView
 * (not Chrome), so we can't observe them with the dev-server playground —
 * we need the actual WebKit composition/keydown/selection event sequence.
 */
let cachedEnabled: boolean | null = null;

export function imeDebugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    cachedEnabled =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('markdowner:imeDebug') === '1';
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

/**
 * Log an IME-related event with the current selection state so we can see
 * exactly where each composed syllable lands in WebKit. `extra` carries
 * event-specific fields (the composed data, the key, etc.).
 */
export function imeLog(
  label: string,
  view: { state?: { selection?: { from?: number; to?: number } } } | null | undefined,
  extra: Record<string, unknown> = {},
): void {
  if (!imeDebugEnabled()) return;
  const sel = view?.state?.selection;
  // eslint-disable-next-line no-console
  console.log(
    `[IME] ${label}`,
    JSON.stringify({ from: sel?.from, to: sel?.to, ...extra }),
  );
}
