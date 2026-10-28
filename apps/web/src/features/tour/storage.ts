/**
 * Tour persistence and auto-start rules.
 *
 * A judge should see the tour once, unasked; after that it is a menu item. The record is a single
 * localStorage key, written on finish *and* on skip, so "I have seen this" means exactly that.
 *
 * Every storage access is guarded: private windows, disabled storage and a corrupt value all behave
 * like a first visit rather than throwing into React's render.
 */
export const TOUR_STORAGE_KEY = 'starling.tour.v1';

export interface TourSeenRecord {
  seen: true;
  /** Epoch ms; useful for "reset after 30 days" later without inventing a second key. */
  at: number;
}

/** The two methods we need, so tests can pass a plain object. */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Storage for the seen record. `undefined` means "use the browser's"; an explicit `null` means
 * "there is no storage in this environment" (an embedding), which is the one case the helpers can
 * distinguish from the default.
 */
export type TourStorageInput = TourStorage | null | undefined;

/** `localStorage` when it exists and is reachable; access itself can throw in some sandboxes. */
export function browserStorage(): TourStorage | undefined {
  try {
    const storage = globalThis.localStorage as TourStorage | undefined;
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The stored record, or `undefined` for "never seen" / unreadable / wrong shape. */
export function readTourSeen(storage: TourStorageInput = browserStorage()): TourSeenRecord | undefined {
  if (storage === undefined || storage === null) return undefined;
  try {
    const raw = storage.getItem(TOUR_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.seen !== true || typeof parsed.at !== 'number') return undefined;
    return { seen: true, at: parsed.at };
  } catch {
    return undefined;
  }
}

export function hasSeenTour(storage: TourStorageInput = browserStorage()): boolean {
  return readTourSeen(storage) !== undefined;
}

/** Write the "seen" record. Returns false when storage is unavailable — never throws. */
export function recordTourSeen(
  storage: TourStorageInput = browserStorage(),
  at: number = Date.now(),
): boolean {
  if (storage === undefined || storage === null) return false;
  try {
    const record: TourSeenRecord = { seen: true, at };
    storage.setItem(TOUR_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function param(search: string, name: string): string | undefined {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get(name);
  return value === null ? undefined : value.trim().toLowerCase();
}

function isOn(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function isOff(value: string | undefined): boolean {
  return value === '0' || value === 'false' || value === 'no';
}

/**
 * Should the shell open the tour by itself?
 *
 * - `?tour=1` always wins, even after a previous visit: an explicit link in a demo runbook should
 *   work on a laptop that has seen the tour before.
 * - `?tour=0` always suppresses it, for a screenshots-only session.
 * - Otherwise only demo mode auto-starts (`?demo=1`), and only on the first visit.
 *
 * Live mode never auto-opens: an operator watching a real run should not be interrupted mid-audit.
 */
export function shouldAutoStartTour(search: string, storage: TourStorageInput = browserStorage()): boolean {
  const tour = param(search, 'tour');
  if (isOff(tour)) return false;
  if (isOn(tour)) return true;
  if (!isOn(param(search, 'demo'))) return false;
  return !hasSeenTour(storage);
}
