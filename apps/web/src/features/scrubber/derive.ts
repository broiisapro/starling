import type { Run, StarlingEvent, TaskRun } from '@starling/core/browser';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';

/**
 * The scrubber's preview derivation.
 *
 * In preview mode the component owns a local head instead of the store, and shows what the dashboard
 * *would* look like at that event: how many tasks have landed, how many are flying, what it has cost
 * so far and which event is on the head. This is deliberately the same `applyEvents` reducer the
 * store uses — a preview that told a different story from the live view would be a bug, not a
 * feature.
 *
 * It is a pure function of `(events, index)` so it can be tested without a DOM and memoised by index
 * in the component.
 */

export interface ScrubPreview {
  index: number;
  /** Envelope timestamp on the head, epoch ms. */
  ts: number;
  /** Events applied to reach this frame (index + 1, clamped). */
  applied: number;
  /** From the plan when one has been created; otherwise the run's task map. */
  tasks: number;
  landed: number;
  /** running + auditing + fixing + merging: the tasks the flock is actively working. */
  flying: number;
  failed: number;
  waiting: number;
  costUsd: number;
  /** `input + output`; `cached` is a subset of `input`, so it must not be added again. */
  tokens: number;
  runStatus?: string;
  lastEvent?: { type: string; summary: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function payloadOf(event: StarlingEvent): Record<string, unknown> {
  const payload = (event as { payload?: unknown }).payload;
  return isRecord(payload) ? payload : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const FLYING = new Set(['running', 'auditing', 'fixing', 'merging']);
const FAILED = new Set(['failed', 'conflict', 'cancelled']);
const WAITING = new Set(['pending', 'ready']);

function activeRun(state: SkyState): Run | undefined {
  if (state.activeRunId !== undefined) return state.runs[state.activeRunId];
  return Object.values(state.runs).sort((a, b) => b.startedAt - a.startedAt)[0];
}

function taskCounts(
  run: Run | undefined,
): Pick<ScrubPreview, 'tasks' | 'landed' | 'flying' | 'failed' | 'waiting'> {
  if (run === undefined) return { tasks: 0, landed: 0, flying: 0, failed: 0, waiting: 0 };
  const planTasks = run.plan?.tasks.length;
  const tasks = planTasks ?? Object.keys(run.tasks).length;
  let landed = 0;
  let flying = 0;
  let failed = 0;
  let waiting = 0;
  for (const task of Object.values(run.tasks)) {
    if (task.status === 'merged') landed += 1;
    else if (FLYING.has(task.status)) flying += 1;
    else if (FAILED.has(task.status)) failed += 1;
    else if (WAITING.has(task.status)) waiting += 1;
  }
  // A plan exists before the first task row does; report the remaining ones as waiting rather than
  // letting 7 planned tasks read as 0.
  const known = landed + flying + failed + waiting;
  if (tasks > known) waiting += tasks - known;
  return { tasks, landed, flying, failed, waiting };
}

function sumUsage(tasks: Iterable<TaskRun>): { costUsd: number; tokens: number } {
  let costUsd = 0;
  let tokens = 0;
  for (const task of tasks) {
    costUsd += Number.isFinite(task.costUsd) ? task.costUsd : 0;
    // `cached` is a subset of `input` (see the TokenUsage contract), so a total is input + output.
    tokens += task.usage.input + task.usage.output;
  }
  return { costUsd, tokens };
}

/**
 * A one-line English summary of any event. Used by the preview card and by the "last event" row in
 * the playground. Unknown additive events (a newer hub) fall through to their type name instead of
 * throwing, which is the same forward-compatibility rule the reducer follows.
 */
export function describeEvent(event: StarlingEvent): string {
  const type = (event as { type?: unknown }).type;
  const payload = payloadOf(event);
  const taskKey = stringField(payload, 'taskKey');

  switch (type) {
    case 'run.created':
      return 'run started';
    case 'run.status': {
      const from = stringField(payload, 'from');
      const to = stringField(payload, 'to');
      return from === undefined || to === undefined ? 'run status changed' : `run ${from} → ${to}`;
    }
    case 'repomap.ready': {
      const files = numberField(payload, 'files');
      return files === undefined ? 'repository mapped' : `repository mapped · ${files} files`;
    }
    case 'plan.created': {
      const plan = payload.plan;
      const count = isRecord(plan) && Array.isArray(plan.tasks) ? plan.tasks.length : undefined;
      return count === undefined ? 'plan created' : `plan created · ${count} tasks`;
    }
    case 'task.status': {
      const from = stringField(payload, 'from');
      const to = stringField(payload, 'to') ?? '?';
      return `${taskKey ?? 'task'} ${from ?? '?'} → ${to}`;
    }
    case 'agent.event': {
      const kind = stringField(payload, 'kind') ?? 'event';
      return `${taskKey ?? 'agent'} ${kind}`;
    }
    case 'audit.verdict': {
      const passed = payload.pass === true;
      return `${taskKey ?? 'task'} audit ${passed ? 'passed' : 'failed'}`;
    }
    case 'merge.result': {
      const status = stringField(payload, 'status') ?? 'finished';
      return `${taskKey ?? 'task'} merge ${status}`;
    }
    case 'metrics': {
      const merged = numberField(payload, 'tasksMerged');
      return merged === undefined ? 'metrics tick' : `metrics tick · ${merged} merged`;
    }
    case 'log': {
      const level = stringField(payload, 'level') ?? 'info';
      const message = stringField(payload, 'msg') ?? 'log line';
      return `${level}: ${message}`;
    }
    case 'node.joined': {
      const node = payload.node;
      const name = isRecord(node) ? (stringField(node, 'name') ?? stringField(node, 'id')) : undefined;
      return `${name ?? 'a perch'} joined the flock`;
    }
    case 'node.stats': {
      const node = payload.node;
      const name = isRecord(node) ? (stringField(node, 'name') ?? stringField(node, 'id')) : undefined;
      return `${name ?? 'a perch'} sent stats`;
    }
    case 'node.left': {
      const nodeId = stringField(payload, 'nodeId') ?? 'a perch';
      const reason = stringField(payload, 'reason');
      return reason === undefined ? `${nodeId} left the flock` : `${nodeId} left · ${reason}`;
    }
    case 'task.migrated': {
      const from = stringField(payload, 'fromNode') ?? '?';
      const to = stringField(payload, 'toNode') ?? '?';
      return `${taskKey ?? 'task'} migrated ${from} → ${to}`;
    }
    case 'run.finished':
      return 'run finished';
    default:
      return typeof type === 'string' ? type : 'event';
  }
}

/**
 * What the dashboard would look like with the first `index + 1` events applied.
 *
 * Returns `undefined` for an empty log so the component can render its empty state. The reducer is
 * fed a slice of the *same* array the live view uses, and the result is never mutated.
 */
export function previewAt(events: readonly StarlingEvent[], index: number): ScrubPreview | undefined {
  if (events.length === 0) return undefined;
  const head = Math.min(events.length - 1, Math.max(0, Math.round(index)));
  const applied = events.slice(0, head + 1);
  const state = applyEvents(createInitialState(), applied);
  const run = activeRun(state);
  const counts = taskCounts(run);
  const usage = run === undefined ? { costUsd: 0, tokens: 0 } : sumUsage(Object.values(run.tasks));
  const event = events[head];
  const preview: ScrubPreview = {
    index: head,
    ts: event?.ts ?? 0,
    applied: applied.length,
    ...counts,
    costUsd: usage.costUsd,
    tokens: usage.tokens,
  };
  if (run !== undefined) {
    const terminal = run.status === 'finished' || run.status === 'failed' || run.status === 'cancelled';
    // The recorded fixture carries one `run.created` snapshot whose `status` stays `mapping`; derive a
    // truthful intermediate label from the tasks that have actually landed or started.
    preview.runStatus = terminal || counts.landed + counts.flying === 0 ? run.status : 'running';
  }
  if (event !== undefined) {
    preview.lastEvent = {
      type: String((event as { type?: unknown }).type),
      summary: describeEvent(event),
    };
  }
  return preview;
}

/**
 * Cache previews by index for one event array. The component call site uses `useMemo`, but the
 * playground also asks at the same index on every render; a small cache keeps that O(1) while still
 * keying on the array identity, so a new recording can never see a stale frame.
 */
export function createPreviewCache(
  events: readonly StarlingEvent[],
): (index: number) => ScrubPreview | undefined {
  const cache = new Map<number, ScrubPreview | undefined>();
  return (index: number) => {
    const key = Math.min(Math.max(0, events.length - 1), Math.max(0, Math.round(index)));
    if (cache.has(key)) return cache.get(key);
    const value = previewAt(events, key);
    cache.set(key, value);
    return value;
  };
}
