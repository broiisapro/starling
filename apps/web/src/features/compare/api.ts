import { useEffect, useState } from 'react';
import {
  type CompareRow,
  compareStats,
  type MetricDirection,
  type MetricFormat,
  type RunStats,
} from './derive';

/**
 * Optional hub enhancement: `GET /api/compare?a=&b=` (Epic 111, landing in parallel).
 *
 * The response shape is not final, so this is deliberately forgiving in two ways:
 * - the page is complete from `SkyState` alone and only asks the hub when `state.connection` is
 *   `live` and the shell supplied a `fetchImpl`;
 * - any error, 404/501, timeout, or shape mismatch is ignored and the local derivation is used.
 *
 * Accepted shapes (see the handback for the request to C3/Epic 111):
 *   { a: RunStats, b: RunStats }            → rows derived locally from the two snapshots
 *   { rows: CompareRow[] }                  → rows used as given
 *   { a, b, rows }                          → rows win
 */
export interface RemoteCompare {
  a?: RunStats;
  b?: RunStats;
  rows?: CompareRow[];
}

export const COMPARE_TIMEOUT_MS = 2_000;

const FORMATS: ReadonlySet<MetricFormat> = new Set(['duration', 'usd', 'count', 'tokens', 'multiplier']);
const DIRECTIONS: ReadonlySet<MetricDirection> = new Set(['lower', 'higher']);
const BETTER: ReadonlySet<CompareRow['better']> = new Set(['a', 'b', 'same']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRunStats(value: unknown): value is RunStats {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.goal === 'string' &&
    typeof value.status === 'string' &&
    finite(value.wallMs) &&
    finite(value.serialMs) &&
    finite(value.speedup) &&
    finite(value.tasks) &&
    finite(value.merged) &&
    finite(value.failed) &&
    finite(value.attempts) &&
    finite(value.apiCostUsd) &&
    finite(value.savedUsd) &&
    finite(value.tokens) &&
    finite(value.peakParallel) &&
    Array.isArray(value.nodes) &&
    value.nodes.every((node) => typeof node === 'string')
  );
}

function parseRow(value: unknown): CompareRow | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.metric !== 'string' || !finite(value.a) || !finite(value.b) || !finite(value.delta)) {
    return undefined;
  }
  if (typeof value.better !== 'string' || !BETTER.has(value.better as CompareRow['better'])) return undefined;
  const format =
    typeof value.format === 'string' && FORMATS.has(value.format as MetricFormat)
      ? (value.format as MetricFormat)
      : 'count';
  const direction =
    typeof value.direction === 'string' && DIRECTIONS.has(value.direction as MetricDirection)
      ? (value.direction as MetricDirection)
      : 'lower';
  const label = typeof value.label === 'string' && value.label !== '' ? value.label : value.metric;
  return {
    metric: value.metric as CompareRow['metric'],
    label,
    format,
    direction,
    a: value.a,
    b: value.b,
    delta: value.delta,
    better: value.better as CompareRow['better'],
  };
}

/** Structural guard. Returns `undefined` for anything that is not a usable compare payload. */
export function parseComparePayload(raw: unknown): RemoteCompare | undefined {
  if (!isRecord(raw)) return undefined;
  const result: RemoteCompare = {};
  if (isRunStats(raw.a)) result.a = raw.a;
  if (isRunStats(raw.b)) result.b = raw.b;
  if (Array.isArray(raw.rows)) {
    const rows = raw.rows.flatMap((row) => {
      const parsed = parseRow(row);
      return parsed === undefined ? [] : [parsed];
    });
    if (rows.length > 0) result.rows = rows;
  }
  if (result.rows === undefined && result.a !== undefined && result.b !== undefined) {
    result.rows = compareStats(result.a, result.b);
  }
  return result.rows === undefined && result.a === undefined && result.b === undefined ? undefined : result;
}

export interface CompareEnhancementOptions {
  aId?: string;
  bId?: string;
  enabled: boolean;
  fetchImpl?: typeof fetch;
  /** Defaults to the same origin (`/api/compare`). */
  baseUrl?: string;
  timeoutMs?: number;
}

interface RemoteState {
  key: string;
  value: RemoteCompare;
}

/**
 * Fetch the optional hub numbers. Never blocks the first render, aborts on unmount or a pair change,
 * gives up after `timeoutMs`, and stays silent on every failure (the local derivation is the truth
 * the page promises to work from).
 */
export function useCompareEnhancement(options: CompareEnhancementOptions): RemoteCompare | undefined {
  const { aId, bId, enabled, fetchImpl, baseUrl = '', timeoutMs = COMPARE_TIMEOUT_MS } = options;
  const [remote, setRemote] = useState<RemoteState | undefined>(undefined);
  const key = `${aId ?? ''}|${bId ?? ''}`;

  useEffect(() => {
    if (!enabled || fetchImpl === undefined || aId === undefined || bId === undefined) return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${baseUrl}/api/compare?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`;

    fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async (response) => (response.ok ? parseComparePayload(await response.json()) : undefined))
      .then((value) => {
        if (!cancelled && value !== undefined) setRemote({ key, value });
      })
      .catch(() => {
        // Optional enhancement: a 404/501, a timeout or a newer hub shape all fall back to local math.
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [aId, bId, enabled, fetchImpl, baseUrl, timeoutMs, key]);

  return remote?.key === key ? remote.value : undefined;
}
