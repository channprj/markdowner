/**
 * Lightweight IME diagnostics for the CJK-in-table input bugs that only
 * reproduce in Tauri's real WebKit engine (not Chrome, and not via synthetic
 * composition events — verified). To capture the real event sequence without
 * needing devtools, the events are mirrored into an in-app overlay that is
 * shown automatically in dev (`pnpm tauri dev`) and never in production
 * builds.
 *
 * Enable logging when EITHER:
 *   - the app is running a Vite dev build (`import.meta.env.DEV`), or
 *   - `localStorage['markdowner:imeDebug'] === '1'` (manual opt-in anywhere).
 */
export interface ImeLogEntry {
  seq: number;
  label: string;
  detail: string;
}

let cachedEnabled: boolean | null = null;
let seq = 0;
const ring: ImeLogEntry[] = [];
const RING_MAX = 60;
const listeners = new Set<(entries: ImeLogEntry[]) => void>();

function devMode(): boolean {
  try {
    // import.meta.env.DEV is true under the Vite dev server (pnpm tauri dev),
    // false in production bundles.
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

export function imeDebugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  let flag = false;
  try {
    flag =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('markdowner:imeDebug') === '1';
  } catch {
    flag = false;
  }
  cachedEnabled = flag || devMode();
  return cachedEnabled;
}

export function subscribeImeLog(listener: (entries: ImeLogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(ring.slice());
  return () => {
    listeners.delete(listener);
  };
}

export function getImeLog(): ImeLogEntry[] {
  return ring.slice();
}

export function clearImeLog(): void {
  ring.length = 0;
  for (const l of listeners) l(ring.slice());
}

/** Selection shape we read for diagnostics (loosely typed to avoid PM deps). */
interface ImeViewLike {
  state?: {
    selection?: {
      from?: number;
      to?: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $from?: any;
    };
  };
}

/**
 * Read the text of the textblock the caret sits in, plus whether that block is
 * inside a table cell. This is the single most useful signal for the CJK
 * reversal: it shows the actual character order forming in the cell ("안" →
 * "녕안" → "녕하안"), so one screenshot of the overlay reveals the mechanism.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeBlock($from: any): { cellText?: string; inCell?: boolean } {
  if (!$from || typeof $from.depth !== 'number') return {};
  try {
    const parent = $from.parent;
    const cellText = typeof parent?.textContent === 'string' ? parent.textContent : undefined;
    let inCell = false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const role = $from.node(depth)?.type?.spec?.tableRole;
      if (role === 'cell' || role === 'header_cell') {
        inCell = true;
        break;
      }
    }
    return { cellText, inCell };
  } catch {
    return {};
  }
}

/**
 * Log an IME-related event with the current selection so we can see exactly
 * where each composed syllable lands in WebKit. `extra` carries
 * event-specific fields (composed data, key, etc.).
 */
export function imeLog(
  label: string,
  view: ImeViewLike | null | undefined,
  extra: Record<string, unknown> = {},
): void {
  if (!imeDebugEnabled()) return;
  const sel = view?.state?.selection;
  const detail = JSON.stringify({
    from: sel?.from,
    to: sel?.to,
    ...describeBlock(sel?.$from),
    ...extra,
  });
  // eslint-disable-next-line no-console
  console.log(`[IME] ${label}`, detail);
  ring.push({ seq: (seq += 1), label, detail });
  if (ring.length > RING_MAX) ring.shift();
  for (const l of listeners) l(ring.slice());
}
