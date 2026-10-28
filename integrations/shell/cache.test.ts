/**
 * The cache is the contract between the background refresh and the prompt itself: a file whose whole
 * content is one rendered line. These tests pin the path, the hash, the round trip and the atomic write.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultCacheDir,
  hashServerUrl,
  locateCache,
  normalizeServerUrl,
  readSegment,
  readState,
  writeCache,
} from './cache.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'starling-prompt-cache-'));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

let counter = 0;
function freshDir(): string {
  counter += 1;
  const dir = join(ROOT, `case-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('hashServerUrl', () => {
  test('is eight lowercase hex characters', () => {
    expect(hashServerUrl('http://127.0.0.1:7777')).toMatch(/^[0-9a-f]{8}$/);
  });

  test('is stable across calls and processes (FNV-1a, not a runtime hash)', () => {
    expect(hashServerUrl('http://127.0.0.1:7777')).toBe(hashServerUrl('http://127.0.0.1:7777'));
    // Pinned so a future implementation change is a visible test edit rather than silent cache loss.
    expect(hashServerUrl('http://127.0.0.1:7777')).toBe('409ae7be');
  });

  test('different hubs get different names', () => {
    expect(hashServerUrl('http://127.0.0.1:7777')).not.toBe(hashServerUrl('http://127.0.0.1:7778'));
    expect(hashServerUrl('http://macbook.local:7777')).not.toBe(hashServerUrl('http://m2-air.local:7777'));
  });

  test('a trailing slash and stray whitespace are the same hub', () => {
    expect(hashServerUrl('http://127.0.0.1:7777/')).toBe(hashServerUrl('  http://127.0.0.1:7777  '));
    expect(hashServerUrl('http://127.0.0.1:7777///')).toBe(hashServerUrl('http://127.0.0.1:7777'));
  });
});

describe('normalizeServerUrl', () => {
  test('trims and drops trailing slashes', () => {
    expect(normalizeServerUrl(' http://h:1/ ')).toBe('http://h:1');
    expect(normalizeServerUrl('http://h:1')).toBe('http://h:1');
  });
});

describe('defaultCacheDir', () => {
  test('honours XDG_CACHE_HOME', () => {
    expect(defaultCacheDir({ XDG_CACHE_HOME: '/xdg/cache' }, '/home/u')).toBe('/xdg/cache/starling');
  });

  test('falls back to ~/.cache', () => {
    expect(defaultCacheDir({}, '/home/u')).toBe('/home/u/.cache/starling');
    expect(defaultCacheDir({ XDG_CACHE_HOME: '   ' }, '/home/u')).toBe('/home/u/.cache/starling');
  });
});

describe('locateCache', () => {
  test('names the segment and the state file after the hash', () => {
    const location = locateCache('http://127.0.0.1:7777', { cacheDir: '/tmp/cache' });
    expect(location.dir).toBe('/tmp/cache');
    expect(location.key).toBe('409ae7be');
    expect(location.segmentPath).toBe('/tmp/cache/prompt-409ae7be.txt');
    expect(location.statePath).toBe('/tmp/cache/prompt-409ae7be.json');
  });

  test('an explicit cacheDir beats XDG', () => {
    const location = locateCache('http://h:1', { cacheDir: '/explicit', env: { XDG_CACHE_HOME: '/xdg' } });
    expect(location.dir).toBe('/explicit');
  });
});

describe('read helpers never throw', () => {
  test('a cold cache reads as empty / fresh', () => {
    const location = locateCache('http://h:1', { cacheDir: freshDir() });
    expect(readSegment(location)).toBe('');
    expect(readState(location)).toEqual({ updatedAt: 0, failures: 0 });
  });

  test('a directory where a file should be reads as empty', () => {
    const dir = freshDir();
    const location = locateCache('http://h:1', { cacheDir: dir });
    mkdirSync(location.segmentPath);
    mkdirSync(location.statePath);
    expect(readSegment(location)).toBe('');
    expect(readState(location)).toEqual({ updatedAt: 0, failures: 0 });
  });

  test('malformed json, wrong types and negative counters degrade to defaults', () => {
    const dir = freshDir();
    const location = locateCache('http://h:1', { cacheDir: dir });
    writeFileSync(location.statePath, 'not json at all');
    expect(readState(location)).toEqual({ updatedAt: 0, failures: 0 });
    writeFileSync(location.statePath, JSON.stringify({ updatedAt: 'soon', failures: 'lots' }));
    expect(readState(location)).toEqual({ updatedAt: 0, failures: 0 });
    writeFileSync(location.statePath, JSON.stringify({ updatedAt: 5, failures: -3 }));
    expect(readState(location)).toEqual({ updatedAt: 5, failures: 0 });
    writeFileSync(location.statePath, JSON.stringify([1, 2, 3]));
    expect(readState(location)).toEqual({ updatedAt: 0, failures: 0 });
  });
});

describe('writeCache', () => {
  test('round trips the segment and the state', () => {
    const location = locateCache('http://h:1', { cacheDir: freshDir() });
    writeCache(location, { segment: '\u{1F426} 12/30', failures: 0, now: 1_700_000_000_123 });
    expect(readSegment(location)).toBe('\u{1F426} 12/30');
    expect(readState(location)).toEqual({ updatedAt: 1_700_000_000_123, failures: 0 });
    expect(readFileSync(location.segmentPath, 'utf8')).toBe('\u{1F426} 12/30');
    expect(readFileSync(location.statePath, 'utf8')).toMatch(
      /^\{"updatedAt":1700000000123,"failures":0\}\n$/,
    );
  });

  test('creates the directory tree when the cache is cold', () => {
    const location = locateCache('http://h:1', { cacheDir: join(freshDir(), 'deep', 'er') });
    writeCache(location, { segment: 'st 1/2', failures: 2, now: 7 });
    expect(readSegment(location)).toBe('st 1/2');
    expect(readState(location)).toEqual({ updatedAt: 7, failures: 2 });
  });

  test('an empty segment is a real write, not a delete (that is how "hub down" hides)', () => {
    const location = locateCache('http://h:1', { cacheDir: freshDir() });
    writeCache(location, { segment: '\u{1F426} 3/9', failures: 0, now: 10 });
    writeCache(location, { segment: '', failures: 1, now: 20 });
    expect(existsSync(location.segmentPath)).toBe(true);
    expect(readSegment(location)).toBe('');
    expect(readState(location)).toEqual({ updatedAt: 20, failures: 1 });
  });

  test('leaves no temp files behind (atomic temp + rename)', () => {
    const dir = freshDir();
    const location = locateCache('http://h:1', { cacheDir: dir });
    for (let index = 0; index < 5; index += 1) {
      writeCache(location, { segment: `st ${index}/5`, failures: 0, now: index });
    }
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['prompt-be3969f8.json', 'prompt-be3969f8.txt']);
  });

  test('the files are private to the user (mode 600)', () => {
    const location = locateCache('http://h:1', { cacheDir: freshDir() });
    writeCache(location, { segment: 'st 1/1', failures: 0, now: 1 });
    expect(statSync(location.segmentPath).mode & 0o777).toBe(0o600);
    expect(statSync(location.statePath).mode & 0o777).toBe(0o600);
  });

  test('a trailing newline in the segment file is tolerated by the reader', () => {
    const location = locateCache('http://h:1', { cacheDir: freshDir() });
    writeFileSync(location.segmentPath, 'st 4/8\n');
    expect(readSegment(location)).toBe('st 4/8');
  });
});
