/**
 * Persistence for `StarlingSettings` (Epic 118).
 *
 * Two rules shape this file:
 *
 * 1. **The dashboard must never break because of storage.** Every read and write is try/catch-guarded
 *    (Safari private mode, a full quota, a locked-down iframe all throw), and a corrupted blob falls
 *    back to defaults field by field.
 * 2. **Interop with today's shell.** Before C3 wires the drawer, `lib/theme` (`starling.theme`) and the
 *    Sky's sound toggle (`starling.sky.sound`) are the real preferences. Writing settings mirrors the
 *    ones those modules understand, and reading settings honours them when the settings blob has no
 *    usable value — so opening the drawer shows the theme the user actually sees.
 */

import { isDemoSpeed } from '../../lib/speed';
import { readTheme, THEME_STORAGE_KEY, type Theme, writeTheme } from '../../lib/theme';
import {
  readSoundEnabled,
  SOUND_STORAGE_KEY,
  type StorageLike,
  safeStorage,
  writeSoundEnabled,
} from '../sky';
import {
  DEFAULT_SETTINGS,
  isThemeSetting,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  type StarlingSettings,
} from './schema';

/** The slice of `localStorage` the settings need; injected in tests and workers. */
export interface SettingsStorage extends StorageLike {
  removeItem?(key: string): void;
}

export { SETTINGS_STORAGE_KEY, SOUND_STORAGE_KEY, THEME_STORAGE_KEY };

function safeGet(storage: SettingsStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The theme the rest of the shell is using right now. `lib/theme` only knows dark/light; `system` is
 * a settings-only concept, so it is never read from that key.
 */
function legacyTheme(storage: SettingsStorage | undefined): Theme {
  return readTheme(storage);
}

function legacySound(storage: SettingsStorage | undefined): boolean {
  return readSoundEnabled(storage);
}

/**
 * Read the persisted settings, or sane defaults.
 *
 * A blob whose `theme`/`sound` is missing or invalid falls back to the legacy key (when present)
 * before the default, and every other field falls back on its own.
 */
export function readSettings(storage: SettingsStorage | undefined = safeStorage()): StarlingSettings {
  const raw = safeGet(storage, SETTINGS_STORAGE_KEY);
  if (raw === null) {
    return {
      ...DEFAULT_SETTINGS,
      theme: legacyTheme(storage),
      sound: legacySound(storage),
    };
  }

  const parsed = parseSettings(raw);
  const record = parseRecord(raw);
  if (record === undefined) {
    // Corrupted JSON (or a bare string/number): the settings are gone, but the old keys still speak.
    return {
      ...DEFAULT_SETTINGS,
      theme: legacyTheme(storage),
      sound: legacySound(storage),
    };
  }

  return {
    ...parsed,
    theme: isThemeSetting(record.theme) ? parsed.theme : legacyTheme(storage),
    sound: typeof record.sound === 'boolean' ? parsed.sound : legacySound(storage),
  };
}

/**
 * Persist the settings and mirror the halves older modules read.
 *
 * `theme: 'system'` deliberately leaves `starling.theme` untouched: `lib/theme` cannot represent
 * "follow the OS", and writing a resolved value there would silently freeze today's shell when the
 * viewer's OS flips at sunset. The settings blob remains the source of truth.
 */
export function writeSettings(
  next: StarlingSettings,
  storage: SettingsStorage | undefined = safeStorage(),
): void {
  const settings = parseSettings(next);
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or forbidden store costs persistence, not the current session.
  }
  if (settings.theme !== 'system') writeTheme(settings.theme, storage);
  writeSoundEnabled(settings.sound, storage);
}

/** The effective demo speed, defensively checked against `lib/speed` (the URL parser's authority). */
export function readDemoSpeed(
  storage: SettingsStorage | undefined = safeStorage(),
): StarlingSettings['demoSpeed'] {
  const { demoSpeed } = readSettings(storage);
  return isDemoSpeed(demoSpeed) ? demoSpeed : DEFAULT_SETTINGS.demoSpeed;
}

/** Forget the settings blob (the legacy theme/sound keys are left alone). Never throws. */
export function clearSettings(storage: SettingsStorage | undefined = safeStorage()): void {
  try {
    storage?.removeItem?.(SETTINGS_STORAGE_KEY);
  } catch {
    // Nothing to do: the next read treats a missing key as defaults anyway.
  }
}
