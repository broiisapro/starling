/**
 * The prompt's on-disk cache — the whole reason the segment can be free.
 *
 * One rendered line per hub in `${XDG_CACHE_HOME:-~/.cache}/starling/`:
 *
 *   prompt-<8 hex of the server URL>.txt   the segment, verbatim, ready to paste into `$PROMPT`
 *   prompt-<8 hex>.json                    { updatedAt, failures } for throttling and backoff
 *
 * Reads never throw: a prompt that errors is worse than a prompt that is empty. Writes are atomic
 * (temp file in the same directory, then rename) so a reader never sees a half-written line, even
 * while two refreshes race.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PromptState {
  /** Epoch ms of the last attempt (success or failure). */
  updatedAt: number;
  /** Consecutive failures, for exponential backoff. */
  failures: number;
}

export interface CacheLocation {
  dir: string;
  /** 8 lowercase hex characters, stable across processes and runs. */
  key: string;
  segmentPath: string;
  statePath: string;
}

const EMPTY_STATE: PromptState = { updatedAt: 0, failures: 0 };

/**
 * FNV-1a (32-bit) as 8 hex characters.
 *
 * Deliberately not `Bun.hash`: the shell snippets and the CLI must agree on the file name, and a hash
 * that is documented here in ten lines is easier to trust than one that could change with a runtime
 * upgrade. Eight hex characters is 4 billion names; collisions between two local hubs are not a thing.
 */
export function hashServerUrl(serverUrl: string): string {
  let hash = 0x811c9dc5;
  const input = normalizeServerUrl(serverUrl);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** `http://127.0.0.1:7777/` and `HTTP://127.0.0.1:7777` are the same hub for cache purposes. */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '');
}

/** `${XDG_CACHE_HOME:-~/.cache}/starling`. `home`/`env` are injectable so tests never touch `$HOME`. */
export function defaultCacheDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const base = env.XDG_CACHE_HOME?.trim();
  return join(base && base.length > 0 ? base : join(home, '.cache'), 'starling');
}

/** Resolve the two cache paths for one hub. */
export function locateCache(
  serverUrl: string,
  opts: { cacheDir?: string; env?: Record<string, string | undefined>; home?: string } = {},
): CacheLocation {
  const dir = opts.cacheDir ?? defaultCacheDir(opts.env ?? process.env, opts.home ?? homedir());
  const key = hashServerUrl(serverUrl);
  return {
    dir,
    key,
    segmentPath: join(dir, `prompt-${key}.txt`),
    statePath: join(dir, `prompt-${key}.json`),
  };
}

/** The rendered segment, or `''` when there is no cache yet or it cannot be read. */
export function readSegment(location: CacheLocation): string {
  try {
    return readFileSync(location.segmentPath, 'utf8').replace(/\r?\n+$/, '');
  } catch {
    return '';
  }
}

/** `{ updatedAt, failures }`, or zeros when the file is missing or malformed. */
export function readState(location: CacheLocation): PromptState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(location.statePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_STATE };
    const record = parsed as Record<string, unknown>;
    const updatedAt =
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
    const rawFailures =
      typeof record.failures === 'number' && Number.isFinite(record.failures) ? record.failures : 0;
    return { updatedAt, failures: Math.max(0, Math.trunc(rawFailures)) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

let tempCounter = 0;

function atomicWrite(path: string, contents: string): void {
  tempCounter += 1;
  const temp = `${path}.${process.pid}.${tempCounter}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file never landed (directory missing, permissions); the original error is the story.
    }
    throw error;
  }
}

/**
 * Write both halves of the cache. Throws only on real I/O trouble — `refresh()` turns that into a
 * quiet failure so the prompt keeps working.
 *
 * The segment is written before the state: a reader that sees a fresh `updatedAt` can trust the
 * segment next to it.
 */
export function writeCache(
  location: CacheLocation,
  input: { segment: string; failures: number; now: number },
): void {
  mkdirSync(location.dir, { recursive: true });
  atomicWrite(location.segmentPath, input.segment);
  const state: PromptState = { updatedAt: input.now, failures: Math.max(0, Math.trunc(input.failures)) };
  atomicWrite(location.statePath, `${JSON.stringify(state)}\n`);
}
