/**
 * Recent picks, persisted for the next ⌘K.
 *
 * The palette stores item ids (not labels): a task's title may change between runs, and a run's goal
 * text is long. Ids that no longer exist are dropped when the palette builds its list, so a renamed
 * task cannot resurrect as a ghost row.
 *
 * Storage is guarded exactly like `lib/theme.ts`: Safari private mode and embedded webviews throw on
 * `localStorage` access, and a convenience cache must never break the dashboard.
 */

export const RECENT_KEY = 'starling.palette.recent.v1';
export const RECENT_LIMIT = 8;

/** The minimal storage surface, so tests can pass a fake and SSR can skip it entirely. */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): RecentStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Parse a stored payload defensively: anything unexpected is an empty history, never a crash. */
export function parseRecent(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string' || value === '') continue;
      if (!ids.includes(value)) ids.push(value);
      if (ids.length >= RECENT_LIMIT) break;
    }
    return ids;
  } catch {
    return [];
  }
}

export function readRecent(storage: RecentStorage | undefined = defaultStorage()): string[] {
  try {
    return parseRecent(storage?.getItem(RECENT_KEY) ?? null);
  } catch {
    return [];
  }
}

export function writeRecent(
  ids: readonly string[],
  storage: RecentStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_LIMIT)));
  } catch {
    // Persistence is a convenience; failing to save recents must never break the palette.
  }
}

/** Move `id` to the front, de-duplicated and capped. Pure: the input array is never mutated. */
export function recordRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((value) => value !== id)].slice(0, RECENT_LIMIT);
}

/** Drop ids the current run no longer offers (stale tasks/runs from a previous session). */
export function pruneRecent(ids: readonly string[], valid: ReadonlySet<string>): string[] {
  return ids.filter((id) => valid.has(id)).slice(0, RECENT_LIMIT);
}
