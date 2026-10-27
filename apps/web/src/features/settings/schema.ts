/**
 * The settings contract (Epic 118).
 *
 * One typed object, one storage key, hand-written guards — no zod in `apps/web` (the browser bundle
 * stays small and the rules below are genuinely small). Every field falls back **on its own**, so a
 * single corrupted value can never reset the rest and a corrupted blob can never blank the dashboard.
 *
 * `parseSettings` accepts anything: `null`, a JSON string, an array, a hostile object. That is the
 * point — it is the last line of defence between `localStorage` and the UI.
 */
import { DEFAULT_DEMO_SPEED, type DemoSpeed, isDemoSpeed } from '../../lib/speed';
import { normalizeToken } from './auth';
import { normalizeServerUrl } from './url';

/** Bumped only when a field changes meaning; `parseSettings` discards blobs from another version. */
export const SETTINGS_VERSION = 1 as const;

export const SETTINGS_STORAGE_KEY = 'starling.settings.v1';

export type ThemeSetting = 'dark' | 'light' | 'system';
export type MotionSetting = 'system' | 'reduced' | 'full';
export type Density = 'comfortable' | 'compact';

export interface StarlingSettings {
  version: typeof SETTINGS_VERSION;
  theme: ThemeSetting;
  motion: MotionSetting;
  sound: boolean;
  demoSpeed: DemoSpeed;
  density: Density;
  /** `''` = same origin. Otherwise an absolute `http(s)://` origin, never a path. */
  serverUrl: string;
  /** The flock join code for `x-flock-token`. `''` = no token. */
  token: string;
}

/** What a control sends to `useSettings().update` — `version` is owned by the module. */
export type SettingsPatch = Partial<Omit<StarlingSettings, 'version'>>;

export const THEME_OPTIONS = ['dark', 'light', 'system'] as const;
export const MOTION_OPTIONS = ['system', 'reduced', 'full'] as const;
export const DENSITY_OPTIONS = ['comfortable', 'compact'] as const;

/**
 * Defaults mirror what the dashboard does today: dark (the projector room), motion following the OS,
 * sound off (the Sky's own default), 1× demo playback and a comfortable layout. The connection is
 * same-origin and unauthenticated until the viewer fills it in.
 */
export const DEFAULT_SETTINGS: StarlingSettings = {
  version: SETTINGS_VERSION,
  theme: 'dark',
  motion: 'system',
  sound: false,
  demoSpeed: DEFAULT_DEMO_SPEED,
  density: 'comfortable',
  serverUrl: '',
  token: '',
};

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function isMotionSetting(value: unknown): value is MotionSetting {
  return value === 'system' || value === 'reduced' || value === 'full';
}

export function isDensity(value: unknown): value is Density {
  return value === 'comfortable' || value === 'compact';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

/**
 * Normalise any candidate into a complete, safe settings object.
 *
 * - A JSON string is parsed first (`readSettings` hands us the raw storage value).
 * - A blob whose `version` is present but not 1 is from a schema we do not understand: all defaults.
 * - A missing `version` is treated as v1 so a hand-written object still works in the playground.
 * - Every other field is checked in isolation against its default.
 */
export function parseSettings(raw: unknown): StarlingSettings {
  const candidate = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!isRecord(candidate)) return { ...DEFAULT_SETTINGS };
  if (candidate.version !== undefined && candidate.version !== SETTINGS_VERSION) {
    return { ...DEFAULT_SETTINGS };
  }

  const theme = isThemeSetting(candidate.theme) ? candidate.theme : DEFAULT_SETTINGS.theme;
  const motion = isMotionSetting(candidate.motion) ? candidate.motion : DEFAULT_SETTINGS.motion;
  const sound = typeof candidate.sound === 'boolean' ? candidate.sound : DEFAULT_SETTINGS.sound;
  const demoSpeed = isDemoSpeed(candidate.demoSpeed) ? candidate.demoSpeed : DEFAULT_SETTINGS.demoSpeed;
  const density = isDensity(candidate.density) ? candidate.density : DEFAULT_SETTINGS.density;
  const serverUrl = normalizeServerUrl(candidate.serverUrl);
  const token = normalizeToken(candidate.token);

  return {
    version: SETTINGS_VERSION,
    theme,
    motion,
    sound,
    demoSpeed,
    density,
    serverUrl,
    token,
  };
}

/** A patch applied through the same guards, so no caller can slip an invalid value into state. */
export function mergeSettings(current: StarlingSettings, patch: SettingsPatch): StarlingSettings {
  return parseSettings({ ...current, ...patch, version: SETTINGS_VERSION });
}

export function sameSettings(a: StarlingSettings, b: StarlingSettings): boolean {
  return (
    a.version === b.version &&
    a.theme === b.theme &&
    a.motion === b.motion &&
    a.sound === b.sound &&
    a.demoSpeed === b.demoSpeed &&
    a.density === b.density &&
    a.serverUrl === b.serverUrl &&
    a.token === b.token
  );
}
