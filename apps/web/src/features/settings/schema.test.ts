import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SETTINGS,
  isDensity,
  isMotionSetting,
  isThemeSetting,
  mergeSettings,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  type StarlingSettings,
  sameSettings,
} from './schema';

const VALID: StarlingSettings = {
  version: 1,
  theme: 'light',
  motion: 'reduced',
  sound: true,
  demoSpeed: 4,
  density: 'compact',
  serverUrl: 'http://192.168.1.10:7777',
  token: '7QK4-2M9P',
};

describe('settings schema', () => {
  test('defaults match today’s dashboard (dark, system motion, silent, 1×)', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      theme: 'dark',
      motion: 'system',
      sound: false,
      demoSpeed: 1,
      density: 'comfortable',
      serverUrl: '',
      token: '',
    });
    expect(SETTINGS_STORAGE_KEY).toBe('starling.settings.v1');
    expect(SETTINGS_VERSION).toBe(1);
  });

  test('parses a fully specified object without changing it', () => {
    expect(parseSettings(VALID)).toEqual(VALID);
  });

  test('accepts a JSON string, which is what storage hands over', () => {
    expect(parseSettings(JSON.stringify(VALID))).toEqual(VALID);
  });

  test('non-objects and broken JSON fall back to defaults', () => {
    for (const raw of [undefined, null, 42, 'yes', '{"theme":', [], true]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  test('a present but unknown version resets the whole blob', () => {
    expect(parseSettings({ ...VALID, version: 2 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ version: '1', theme: 'light' })).toEqual(DEFAULT_SETTINGS);
  });

  test('a missing version is treated as v1 so hand-written objects still work', () => {
    const { version: _version, ...withoutVersion } = VALID;
    expect(parseSettings(withoutVersion)).toEqual(VALID);
  });

  test('an unknown theme falls back alone — the rest survives', () => {
    const parsed = parseSettings({ ...VALID, theme: 'neon' });
    expect(parsed.theme).toBe('dark');
    expect(parsed.density).toBe('compact');
    expect(parsed.serverUrl).toBe('http://192.168.1.10:7777');
  });

  test('a non-boolean sound falls back alone (the DoD corruption case)', () => {
    const parsed = parseSettings({ version: 1, theme: 'neon', sound: 'yes', density: 'compact' });
    expect(parsed.theme).toBe('dark');
    expect(parsed.sound).toBe(false);
    expect(parsed.density).toBe('compact');
  });

  test('every motion value round-trips, an unknown one becomes system', () => {
    for (const motion of ['system', 'reduced', 'full'] as const) {
      expect(parseSettings({ ...VALID, motion }).motion).toBe(motion);
    }
    expect(parseSettings({ ...VALID, motion: 'slower' }).motion).toBe('system');
  });

  test('demo speed is one of 1 / 4 / 16 and never a string', () => {
    expect(parseSettings({ ...VALID, demoSpeed: 16 }).demoSpeed).toBe(16);
    expect(parseSettings({ ...VALID, demoSpeed: 8 }).demoSpeed).toBe(1);
    expect(parseSettings({ ...VALID, demoSpeed: '4' }).demoSpeed).toBe(1);
    expect(parseSettings({ ...VALID, demoSpeed: Number.NaN }).demoSpeed).toBe(1);
  });

  test('density round-trips and rejects anything else', () => {
    expect(parseSettings({ ...VALID, density: 'comfortable' }).density).toBe('comfortable');
    expect(parseSettings({ ...VALID, density: 'cozy' }).density).toBe('comfortable');
  });

  test('unknown extra fields are ignored, not copied', () => {
    const parsed = parseSettings({ ...VALID, nope: 'x', __proto__: { polluted: true } });
    expect(parsed).toEqual(VALID);
    expect((parsed as unknown as Record<string, unknown>).nope).toBeUndefined();
  });

  test('a dangerous server URL is dropped to same-origin', () => {
    expect(parseSettings({ ...VALID, serverUrl: 'javascript:alert(1)' }).serverUrl).toBe('');
    expect(parseSettings({ ...VALID, serverUrl: 'http://user:pw@host' }).serverUrl).toBe('');
    expect(parseSettings({ ...VALID, serverUrl: 'http://host:7777/api' }).serverUrl).toBe('');
    expect(parseSettings({ ...VALID, serverUrl: 'http://host:7777/' }).serverUrl).toBe('http://host:7777');
  });

  test('the token is trimmed and limited to printable ASCII', () => {
    expect(parseSettings({ ...VALID, token: '  abcd  ' }).token).toBe('abcd');
    expect(parseSettings({ ...VALID, token: 'ab\ncd' }).token).toBe('');
    expect(parseSettings({ ...VALID, token: 12345 }).token).toBe('');
    expect(parseSettings({ ...VALID, token: 'x'.repeat(513) }).token).toBe('');
  });

  test('guards accept exactly the documented values', () => {
    expect(isThemeSetting('system')).toBe(true);
    expect(isThemeSetting('neon')).toBe(false);
    expect(isMotionSetting('reduced')).toBe(true);
    expect(isMotionSetting('none')).toBe(false);
    expect(isDensity('compact')).toBe(true);
    expect(isDensity('tight')).toBe(false);
  });

  test('mergeSettings runs a patch through the same guards', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: 'light', demoSpeed: 16 });
    expect(merged.theme).toBe('light');
    expect(merged.demoSpeed).toBe(16);
    const guarded = mergeSettings(DEFAULT_SETTINGS, {
      theme: 'neon' as unknown as StarlingSettings['theme'],
    });
    expect(guarded.theme).toBe('dark');
  });

  test('sameSettings compares every field', () => {
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(true);
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, token: 'x' })).toBe(false);
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, demoSpeed: 4 })).toBe(false);
  });
});
