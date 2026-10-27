import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type StarlingSettings } from './schema';
import {
  clearSettings,
  readDemoSpeed,
  readSettings,
  SETTINGS_STORAGE_KEY as STORAGE_KEY,
  writeSettings,
} from './storage';
import { memoryStorage, throwingStorage } from './test-support';

const VALID: StarlingSettings = {
  version: 1,
  theme: 'light',
  motion: 'full',
  sound: true,
  demoSpeed: 16,
  density: 'compact',
  serverUrl: 'https://hub.example:7777',
  token: 'ABCD-1234',
};

describe('settings storage', () => {
  test('an empty store yields defaults, with the legacy theme key honoured', () => {
    expect(readSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(memoryStorage({ 'starling.theme': 'light' })).theme).toBe('light');
    expect(readSettings(memoryStorage({ 'starling.sky.sound': 'on' })).sound).toBe(true);
  });

  test('round-trips every field through one key', () => {
    const storage = memoryStorage();
    writeSettings(VALID, storage);
    expect(JSON.parse(storage.data[STORAGE_KEY] ?? '{}')).toEqual(VALID);
    expect(readSettings(storage)).toEqual(VALID);
  });

  test('mirrors theme and sound into the keys today’s shell reads', () => {
    const storage = memoryStorage();
    writeSettings(VALID, storage);
    expect(storage.data['starling.theme']).toBe('light');
    expect(storage.data['starling.sky.sound']).toBe('on');

    writeSettings({ ...VALID, theme: 'dark', sound: false }, storage);
    expect(storage.data['starling.theme']).toBe('dark');
    expect(storage.data['starling.sky.sound']).toBe('off');
  });

  test('theme "system" leaves the legacy theme key alone', () => {
    const storage = memoryStorage({ 'starling.theme': 'light' });
    writeSettings({ ...VALID, theme: 'system' }, storage);
    expect(storage.data['starling.theme']).toBe('light');
    expect(readSettings(storage).theme).toBe('system');
  });

  test('a valid blob wins over the legacy theme key', () => {
    const storage = memoryStorage({ 'starling.theme': 'light' });
    writeSettings({ ...VALID, theme: 'dark' }, storage);
    storage.data['starling.theme'] = 'light';
    expect(readSettings(storage).theme).toBe('dark');
  });

  test('an invalid field in the blob falls back to the legacy value, then the default', () => {
    const withLegacy = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, theme: 'neon', density: 'compact' }),
      'starling.theme': 'light',
    });
    const parsed = readSettings(withLegacy);
    expect(parsed.theme).toBe('light');
    expect(parsed.density).toBe('compact');

    const withoutLegacy = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, theme: 'neon' }),
    });
    expect(readSettings(withoutLegacy).theme).toBe('dark');
  });

  test('the DoD corruption case: bad theme and sound keep the rest', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: '{"version":1,"theme":"neon","sound":"yes","density":"compact"}',
    });
    const parsed = readSettings(storage);
    expect(parsed.theme).toBe('dark');
    expect(parsed.sound).toBe(false);
    expect(parsed.density).toBe('compact');
    expect(parsed.demoSpeed).toBe(1);
  });

  test('broken JSON falls back to defaults plus the legacy theme/sound', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: '{"version":1,"theme":',
      'starling.theme': 'light',
      'starling.sky.sound': 'on',
    });
    const parsed = readSettings(storage);
    expect(parsed.theme).toBe('light');
    expect(parsed.sound).toBe(true);
    expect(parsed.demoSpeed).toBe(1);
    expect(parsed.token).toBe('');
  });

  test('a wrong version is a full reset', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ ...VALID, version: 2 }),
    });
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  test('a throwing store never throws on read or write', () => {
    expect(readSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
    expect(() => writeSettings(VALID, throwingStorage)).not.toThrow();
    expect(() => clearSettings(throwingStorage)).not.toThrow();
  });

  test('writeSettings normalises whatever it is handed', () => {
    const storage = memoryStorage();
    writeSettings({ ...VALID, theme: 'neon' as StarlingSettings['theme'] }, storage);
    expect(readSettings(storage).theme).toBe('dark');
  });

  test('clearSettings removes only the settings blob', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify(VALID),
      'starling.theme': 'light',
    });
    clearSettings(storage);
    expect(storage.data[SETTINGS_STORAGE_KEY]).toBeUndefined();
    expect(readSettings(storage).theme).toBe('light');
  });

  test('readDemoSpeed returns the stored speed or the safe default', () => {
    expect(readDemoSpeed(memoryStorage())).toBe(1);
    const storage = memoryStorage();
    writeSettings({ ...VALID, demoSpeed: 4 }, storage);
    expect(readDemoSpeed(storage)).toBe(4);
    storage.data[SETTINGS_STORAGE_KEY] = JSON.stringify({ version: 1, demoSpeed: 8 });
    expect(readDemoSpeed(storage)).toBe(1);
  });

  test('the storage key is the versioned one, not the legacy keys', () => {
    expect(STORAGE_KEY).toBe('starling.settings.v1');
  });

  test('reads tolerate a missing removeItem and a bare string blob', () => {
    const noRemove = {
      getItem: () => '"hello"',
      setItem: () => undefined,
    };
    expect(readSettings(noRemove)).toEqual(DEFAULT_SETTINGS);
    expect(() => clearSettings(noRemove)).not.toThrow();
  });
});
