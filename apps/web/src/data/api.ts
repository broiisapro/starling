import type { DiffSummary, ModelRole, Run } from '@starling/core/browser';
import type { JoinInfo } from './handshake';

/**
 * The dashboard's REST client — the four calls live mode needs beyond the SSE stream.
 *
 * Every function takes an explicit `fetch` (L26: tests never touch the network) and returns
 * `undefined` instead of throwing for the ordinary "not there" cases (no flock, no diff yet, no
 * config endpoint on an older hub). A networking failure is also `undefined`: the data layer's job is
 * to keep the dashboard standing, not to surface a stack trace over the sky.
 */

export const RUNS_URL = '/api/runs';
export const JOIN_URL = '/api/flock/join';
export const PUBLIC_CONFIG_URL = '/api/config/public';

/** `GET /api/runs/:id/diff/:taskKey`. */
export function taskDiffUrl(runId: string, taskKey: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/diff/${encodeURIComponent(taskKey)}`;
}

/** Mirrors `apps/server`'s `PublicConfig` (server owns the route; the UI only needs these fields). */
export interface PublicConfig {
  version: string;
  profile: string;
  models: Record<ModelRole, string>;
  flockEnabled: boolean;
}

export const MODEL_ROLES: readonly ModelRole[] = [
  'planner',
  'worker',
  'resolver',
  'auditor',
  'summarizer',
  'writer',
];

/** The header's one-line label, e.g. `auditor: deepseek-v4.1-flash (opencode)`. */
export function modelLabel(config: PublicConfig, role: ModelRole): string {
  return `${role}: ${config.models[role]} (${config.profile})`;
}

/** Every role, for the header's tooltip. */
export function modelLabels(config: PublicConfig): string[] {
  return MODEL_ROLES.map((role) => modelLabel(config, role));
}

export interface ApiOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Override the default URL (tests and non-root deployments). */
  url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function getJson(url: string, options: ApiOptions = {}): Promise<{ status: number; body: unknown }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === undefined) return { status: 0, body: undefined };
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) return { status: response.status, body: undefined };
    return { status: response.status, body: (await response.json()) as unknown };
  } catch {
    return { status: 0, body: undefined };
  }
}

/** `GET /api/runs`. The server already sorts newest-first. */
export async function fetchRuns(options: ApiOptions = {}): Promise<Run[] | undefined> {
  const { body } = await getJson(options.url ?? RUNS_URL, options);
  if (!Array.isArray(body)) return undefined;
  return body.filter((run): run is Run => isRecord(run) && typeof run.id === 'string');
}

export function isJoinInfo(value: unknown): value is JoinInfo {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.hubUrl === 'string' &&
    typeof value.command === 'string'
  );
}

/**
 * `GET /api/flock/join`. A hub without a flock answers 503 `FLOCK_DISABLED`; that is not an error, it
 * is single-node mode, and the panel renders "flock off" without a join card.
 */
export async function fetchJoinInfo(options: ApiOptions = {}): Promise<JoinInfo | undefined> {
  const { status, body } = await getJson(options.url ?? JOIN_URL, options);
  if (status === 503) return undefined;
  return isJoinInfo(body) ? body : undefined;
}

export function isPublicConfig(value: unknown): value is PublicConfig {
  if (!isRecord(value)) return false;
  if (typeof value.version !== 'string' || typeof value.profile !== 'string') return false;
  if (typeof value.flockEnabled !== 'boolean' || !isRecord(value.models)) return false;
  const models = value.models;
  return MODEL_ROLES.every((role) => typeof models[role] === 'string');
}

/** `GET /api/config/public` — absent on an older hub, in which case the header simply hides the models. */
export async function fetchPublicConfig(options: ApiOptions = {}): Promise<PublicConfig | undefined> {
  const { body } = await getJson(options.url ?? PUBLIC_CONFIG_URL, options);
  return isPublicConfig(body) ? body : undefined;
}

export function isDiffSummary(value: unknown): value is DiffSummary {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.files) || typeof value.patch !== 'string') return false;
  if (typeof value.truncated !== 'boolean') return false;
  return value.files.every(
    (file) =>
      isRecord(file) &&
      typeof file.path === 'string' &&
      typeof file.added === 'number' &&
      typeof file.removed === 'number',
  );
}

/**
 * `GET /api/runs/:id/diff/:taskKey`. 404 means "nothing recorded for this task yet" — the drawer just
 * shows its empty state, so this resolves `undefined` rather than rejecting.
 */
export async function fetchTaskDiff(
  runId: string,
  taskKey: string,
  options: ApiOptions = {},
): Promise<DiffSummary | undefined> {
  const { status, body } = await getJson(options.url ?? taskDiffUrl(runId, taskKey), options);
  if (status !== 200) return undefined;
  return isDiffSummary(body) ? body : undefined;
}

/**
 * Demo mode has no server to ask, but the flock panel's join card is half of its demo value. This
 * synthesises the same shape the hub would return, pointed at the local port a `starling dash` would
 * use, so the card and its copy button work without a network round-trip.
 */
export function demoJoinInfo(origin?: string): JoinInfo {
  const hubUrl = origin ?? 'http://localhost:7777';
  const code = 'DEMO-7F3A';
  return { code, hubUrl, command: `starling perch --hub ${hubUrl} --code ${code}` };
}
