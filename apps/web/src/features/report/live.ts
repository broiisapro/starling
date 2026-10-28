import type { AuditCheck, ModelRef, RunStatus, TokenUsage } from '@starling/core/browser';
import type {
  FlightOutcome,
  FlightReport,
  FlightTaskCounts,
  NodeContribution,
  NotableVerdict,
  StoryBeat,
  StoryKind,
} from './types';

/**
 * Optional enhancement: `GET /api/runs/:id/report` (Epic 111, landing in parallel).
 *
 * The feature is complete from `SkyState` alone, so this route may be missing (404), unimplemented
 * (501) or still changing shape. Everything here is therefore defensive: a 2 s budget, an abort on
 * unmount, a structural guard per field and a silent fall back to the local derivation. The shape
 * coded against is documented in the epic handback so C3 can reconcile it with Epic 111's final one.
 */
export const REPORT_TIMEOUT_MS = 2_000;

export function reportEndpoint(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/report`;
}

type FetchLike = typeof fetch;

/** Fetch the server's report patch. Any error, non-2xx or malformed body returns `undefined`. */
export async function fetchServerReport(
  runId: string,
  fetchImpl: FetchLike | undefined = globalThis.fetch,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown | undefined> {
  if (typeof fetchImpl !== 'function') return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REPORT_TIMEOUT_MS);
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetchImpl(reportEndpoint(runId), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    // 404 (older hub) and 501 (route not wired yet) are expected, not errors.
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    // Timeout, abort, network failure, invalid JSON: the local derivation is the report.
    return undefined;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  'mapping',
  'planning',
  'planned',
  'running',
  'finished',
  'failed',
  'cancelled',
]);

const OUTCOMES: ReadonlySet<string> = new Set<FlightOutcome>([
  'landed',
  'partial',
  'failed',
  'in-flight',
  'cancelled',
]);

const STORY_KINDS: ReadonlySet<string> = new Set<StoryKind>([
  'repomap',
  'plan',
  'node.joined',
  'node.left',
  'running',
  'audit',
  'migrated',
  'merge',
  'conflict',
  'log',
  'finished',
]);

function isUsage(value: unknown): value is TokenUsage {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.input) && isFiniteNumber(value.output) && isFiniteNumber(value.cached);
}

function isTaskCounts(value: unknown): value is FlightTaskCounts {
  if (!isRecord(value)) return false;
  return (['total', 'merged', 'failed', 'conflict', 'cancelled', 'inFlight'] as const).every((key) =>
    isFiniteNumber(value[key]),
  );
}

function isModelRef(value: unknown): value is ModelRef {
  return isRecord(value) && typeof value.provider === 'string' && typeof value.model === 'string';
}

function isCheck(value: unknown): value is AuditCheck {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.ok === 'boolean' &&
    typeof value.detail === 'string'
  );
}

function isContribution(value: unknown): value is NodeContribution {
  if (!isRecord(value)) return false;
  return (
    typeof value.nodeId === 'string' &&
    typeof value.name === 'string' &&
    (['tasks', 'merged', 'flightMs', 'costUsd', 'migratedIn', 'migratedOut'] as const).every((key) =>
      isFiniteNumber(value[key]),
    )
  );
}

function isVerdict(value: unknown): value is NotableVerdict {
  if (!isRecord(value)) return false;
  return (
    typeof value.taskKey === 'string' &&
    isFiniteNumber(value.attempt) &&
    typeof value.pass === 'boolean' &&
    Array.isArray(value.checks) &&
    value.checks.every(isCheck) &&
    Array.isArray(value.laneViolations) &&
    value.laneViolations.every((entry) => typeof entry === 'string') &&
    typeof value.summary === 'string' &&
    isModelRef(value.model) &&
    isFiniteNumber(value.ts)
  );
}

function isBeat(value: unknown): value is StoryBeat {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.at) &&
    typeof value.kind === 'string' &&
    STORY_KINDS.has(value.kind) &&
    typeof value.text === 'string'
  );
}

function arrayOf<T>(value: unknown, guard: (entry: unknown) => entry is T): T[] | undefined {
  return Array.isArray(value) && value.every(guard) ? value : undefined;
}

/**
 * Layer the server's report over the local one, field by field. The server wins only for fields it
 * actually provides and that pass the guard; anything else (`runId` mismatch, unknown shape, an
 * older hub's partial payload) leaves the locally derived value untouched.
 */
export function mergeServerReport(local: FlightReport, remote: unknown): FlightReport {
  if (!isRecord(remote) || remote.runId !== local.runId) return local;

  const next: FlightReport = {
    ...local,
    tasks: { ...local.tasks },
    tokens: { ...local.tokens },
    nodes: local.nodes,
    verdicts: local.verdicts,
    story: local.story,
    estimated: local.estimated,
  };

  if (typeof remote.goal === 'string') next.goal = remote.goal;
  if (typeof remote.status === 'string' && RUN_STATUSES.has(remote.status)) {
    next.status = remote.status as RunStatus;
  }
  if (typeof remote.outcome === 'string' && OUTCOMES.has(remote.outcome)) {
    next.outcome = remote.outcome as FlightOutcome;
  }
  if (isTaskCounts(remote.tasks)) next.tasks = remote.tasks;
  for (const field of [
    'wallMs',
    'flightWindowMs',
    'serialMs',
    'savedMs',
    'speedup',
    'costUsd',
    'savedUsd',
    'localCalls',
  ] as const) {
    const value = remote[field];
    if (isFiniteNumber(value)) next[field] = value;
  }
  if (isRecord(remote.tokens)) {
    if (isUsage(remote.tokens.api)) next.tokens.api = remote.tokens.api;
    if (isUsage(remote.tokens.local)) next.tokens.local = remote.tokens.local;
  }
  const nodes = arrayOf(remote.nodes, isContribution);
  if (nodes !== undefined) next.nodes = nodes;
  const verdicts = arrayOf(remote.verdicts, isVerdict);
  if (verdicts !== undefined) next.verdicts = verdicts;
  const story = arrayOf(remote.story, isBeat);
  if (story !== undefined) next.story = [...story].sort((a, b) => a.at - b.at);
  if (typeof remote.summary === 'string' && remote.summary.trim() !== '') {
    next.summary = remote.summary;
  }
  if (Array.isArray(remote.estimated) && remote.estimated.every((entry) => typeof entry === 'string')) {
    next.estimated = [...new Set(remote.estimated as string[])];
  }
  return next;
}
