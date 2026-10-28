/**
 * One refresh: ask the hub for `/api/runs`, pick the run, render one line, write the cache.
 *
 * This is the only file in the folder that talks to the network, and it is always run in a background
 * process (the shell snippets background it; the CLI exits right after). It therefore never throws and
 * never blocks on anything longer than `timeoutMs`.
 *
 * Dead hub = free prompt: the segment becomes `''` (so the prompt shows nothing) and the next attempt is
 * pushed back exponentially, up to a minute. The `{ updatedAt, failures }` neighbour in the cache is the
 * only state — no daemon, no memory.
 */

import type { Run } from '../../packages/core/src/index.ts';
import { type CacheLocation, locateCache, readSegment, readState, writeCache } from './cache.ts';
import { countTasks, formatSegment, isLandedRunStatus, pickRun, type SegmentStyle } from './segment.ts';

/** The slice of `fetch` this module needs, so tests can pass a function and nothing else. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface RefreshOptions {
  /** Hub base URL, e.g. `http://127.0.0.1:7777`. Trailing slashes are fine. */
  serverUrl: string;
  /** Sent as `x-flock-token` when set (Epic 110 / SEC-01). */
  token?: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Injected clock (epoch ms). */
  now?: () => number;
  /** Overrides `${XDG_CACHE_HOME:-~/.cache}/starling`. */
  cacheDir?: string;
  /** Hard ceiling for the whole HTTP exchange. Default 300 ms — a prompt helper, not a client. */
  timeoutMs?: number;
  ascii?: boolean;
  style?: SegmentStyle;
  /**
   * Minimum age of the last attempt before another one is allowed. The fish snippet passes 2 000 here
   * (fish has no clock builtin, so the throttle lives in this process instead of in the prompt);
   * zsh/bash also pass it as a second line of defence behind `$EPOCHSECONDS`/`$SECONDS`.
   */
  intervalMs?: number;
  env?: Record<string, string | undefined>;
  home?: string;
}

export interface RefreshOutcome {
  segment: string;
  /** The hub answered and the cache holds a fresh line. */
  ok: boolean;
  /** Skipped because of backoff or the throttle window (no request made). */
  skipped: boolean;
  failures: number;
  /** Short, human-readable reason when `ok` is false. Never includes the token. */
  error?: string;
}

/** 1 s, 2 s, 4 s … capped at 60 s. Zero failures means no wait. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(1000 * 2 ** (failures - 1), 60_000);
}

/** `http://host:7777/` → `http://host:7777/api/runs`. */
export function runsUrl(serverUrl: string): string {
  return `${serverUrl.trim().replace(/\/+$/, '')}/api/runs`;
}

/**
 * Validate just enough of a `Run` for the segment (id/status/startedAt/tasks) and drop anything else.
 *
 * Deliberately not `RunSchema`: this process runs for a few hundred milliseconds behind every prompt,
 * and importing `@starling/core` would pull zod, sqlite and the whole contract module into it. The
 * three fields checked here are the three fields the segment reads; everything else is passed through.
 */
function asRun(value: unknown): Run | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.status !== 'string') return undefined;
  if (typeof record.startedAt !== 'number') return undefined;
  if (typeof record.tasks !== 'object' || record.tasks === null) return undefined;
  // reason: the four fields above are the whole contract between the hub and this renderer; the cast
  // only exists because the HTTP body is `unknown` until it is checked.
  return record as unknown as Run;
}

/** `/api/runs` answers `Run[]`; `{ runs: Run[] }` is accepted too, in case the route ever wraps it. */
export function extractRuns(payload: unknown): Run[] {
  const list = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' &&
        payload !== null &&
        Array.isArray((payload as Record<string, unknown>).runs)
      ? ((payload as Record<string, unknown>).runs as unknown[])
      : [];
  const runs: Run[] = [];
  for (const item of list) {
    const run = asRun(item);
    if (run) runs.push(run);
  }
  return runs;
}

function safeWrite(location: CacheLocation, input: { segment: string; failures: number; now: number }): void {
  try {
    writeCache(location, input);
  } catch {
    // A read-only cache directory must not turn into a broken prompt; the segment simply stays empty.
  }
}

/**
 * Perform one refresh. Never throws.
 *
 * Order matters: backoff first (a dead hub must not even be dialled), then the caller's throttle, then
 * the request. On any failure the cached segment is cleared and the failure count incremented.
 */
export async function refresh(options: RefreshOptions): Promise<RefreshOutcome> {
  const now = options.now ?? (() => Date.now());
  const location = locateCache(options.serverUrl, {
    cacheDir: options.cacheDir,
    env: options.env ?? process.env,
    home: options.home,
  });
  const at = now();
  const state = readState(location);

  if (state.failures > 0) {
    const wait = backoffMs(state.failures);
    if (at - state.updatedAt < wait) {
      return { segment: readSegment(location), ok: false, skipped: true, failures: state.failures };
    }
  }
  if (options.intervalMs !== undefined && options.intervalMs > 0 && state.updatedAt > 0) {
    if (at - state.updatedAt < options.intervalMs) {
      return {
        segment: readSegment(location),
        ok: state.failures === 0,
        skipped: true,
        failures: state.failures,
      };
    }
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token) headers['x-flock-token'] = options.token;
  const timeoutMs = options.timeoutMs ?? 300;
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  let payload: unknown;
  try {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const response = await doFetch(runsUrl(options.serverUrl), { headers, signal });
    if (!response.ok) throw new Error(`hub answered ${response.status}`);
    payload = await response.json();
  } catch (error) {
    const failures = state.failures + 1;
    safeWrite(location, { segment: '', failures, now: at });
    return {
      segment: '',
      ok: false,
      skipped: false,
      failures,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const run = pickRun(extractRuns(payload), at);
  const segment = run
    ? formatSegment(countTasks(run), {
        ascii: options.ascii,
        finished: isLandedRunStatus(run.status),
        style: options.style,
      })
    : '';
  safeWrite(location, { segment, failures: 0, now: at });
  return { segment, ok: true, skipped: false, failures: 0 };
}
