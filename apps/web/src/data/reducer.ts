import type {
  AgentEvent,
  AuditVerdict,
  DiffSummary,
  MergeResult,
  NodeInfo,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
} from '@starling/core/browser';
import type { PublicConfig } from './api';
import type { JoinInfo } from './handshake';
import { isRunStatusEvent, type KnownStarlingEvent, type RunStatusEvent } from './run-status';

/** Where the numbers on screen come from. `offline` = neither SSE nor demo is running. */
export type ConnectionState = 'live' | 'demo' | 'offline';

export interface MetricsSample {
  ts: number;
  metrics: RunMetrics;
}

/**
 * The dashboard's entire world. It is produced only by `applyEvent`, which is pure, so the store
 * can be replayed, snapshotted in a test and time-travelled later without touching React.
 */
export interface SkyState {
  runs: Record<string, Run>;
  activeRunId?: string;
  /** Active-run events plus the global `runId === '*'` flock events, oldest first. */
  events: StarlingEvent[];
  nodes: Record<string, NodeInfo>;
  /** Agent transcript per task key, oldest first. */
  agentLog: Record<string, AgentEvent[]>;
  /** Every verdict ever issued for a task, oldest first (attempt 1, then 2…). */
  verdicts: Record<string, AuditVerdict[]>;
  merges: MergeResult[];
  metricsHistory: MetricsSample[];
  /** Diffs fetched lazily from `/api/runs/:id/diff/:taskKey`, keyed by `diffKey(runId, taskKey)`. */
  diffs: Record<string, DiffSummary>;
  /** `/api/config/public` in live mode; absent in demo mode or on a hub that predates the route. */
  publicConfig?: PublicConfig;
  join?: JoinInfo;
  connection: ConnectionState;
  selectedTask?: string;
}

/** Caps stop a long live run from growing the tab's heap without bound. */
export const EVENT_CAP = 5_000;
export const AGENT_LOG_CAP = 500;
export const VERDICT_CAP = 100;
export const MERGE_CAP = 500;
export const METRICS_CAP = 2_000;
/** How many recent events `skyProps` hands to the Sky (birds only need the last few seconds). */
export const RECENT_CAP = 80;

export function createInitialState(): SkyState {
  return {
    runs: {},
    events: [],
    nodes: {},
    agentLog: {},
    verdicts: {},
    merges: [],
    metricsHistory: [],
    diffs: {},
    connection: 'offline',
  };
}

/** Composite key for the lazy-diff cache. A task key alone would leak across runs. */
export function diffKey(runId: string, taskKey: string): string {
  return `${runId}:${taskKey}`;
}

/** Frozen-ish baseline: never mutate it; the store clones the arrays on first write. */
export const initialState: SkyState = createInitialState();

function appendCapped<T>(list: readonly T[], item: T, cap: number): T[] {
  if (cap <= 0) return [];
  const next = list.concat(item);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Which events belong in `state.events`:
 * - global flock events (`runId: '*'`) always do;
 * - the active run's events do;
 * - before a run is known, everything does;
 * - `run.created` always does, because it is what makes a new run active.
 *
 * With several runs in one tab we keep the selected run's story, not a soup of all of them.
 */
function eventBelongs(state: SkyState, event: StarlingEvent): boolean {
  if (event.runId === '*' || event.type === 'run.created') return true;
  if (state.activeRunId === undefined) return true;
  return event.runId === state.activeRunId;
}

function withEvent(state: SkyState, event: StarlingEvent): SkyState {
  if (!eventBelongs(state, event)) return state;
  return { ...state, events: appendCapped(state.events, event, EVENT_CAP) };
}

function updateTask(
  state: SkyState,
  runId: string,
  taskKey: string,
  update: (task: TaskRun) => TaskRun,
): Pick<SkyState, 'runs'> | Record<string, never> {
  const run = state.runs[runId];
  const task = run?.tasks[taskKey];
  if (run === undefined || task === undefined) return {};
  return {
    runs: {
      ...state.runs,
      [runId]: { ...run, tasks: { ...run.tasks, [taskKey]: update(task) } },
    },
  };
}

/**
 * Pure event reducer. Every transition publishes a StarlingEvent; this is the only place the UI
 * learns what happened. Returns the same object when an event changes nothing it tracks.
 */
export function applyEvent(state: SkyState, event: StarlingEvent): SkyState {
  const next = withEvent(state, event);

  // `run.status` is additive in core (Epic 40). Feature-detected here so this file compiles before
  // and after that change, and so an older UI against a newer hub still updates the picker.
  if (isRunStatusEvent(event)) {
    const run = (event as RunStatusEvent).payload.run;
    const activeRunId = next.activeRunId ?? run.id;
    return { ...next, runs: { ...next.runs, [run.id]: run }, activeRunId };
  }

  // Typed as the known union minus the additive event above: the switch below stays exhaustive and
  // `default` can never see a real event type.
  const known = event as KnownStarlingEvent;
  switch (known.type) {
    case 'run.created': {
      const run = known.payload.run;
      // Hydration (`/api/runs`) is fresher than the backlog's original `run.created` snapshot, so an
      // already-known run is not downgraded. A genuinely new run becomes active when it is newer than
      // the one on screen — that is "follow a newly started run automatically".
      const existing = next.runs[run.id];
      const active = next.activeRunId === undefined ? undefined : next.runs[next.activeRunId];
      const follow = active === undefined || run.startedAt >= active.startedAt;
      return {
        ...next,
        runs: { ...next.runs, [run.id]: existing ?? run },
        activeRunId: follow ? run.id : next.activeRunId,
      };
    }

    case 'plan.created': {
      const plan = known.payload.plan;
      const owner =
        Object.values(next.runs).find((run) => run.goal.id === plan.goalId) ??
        (next.activeRunId === undefined ? undefined : next.runs[next.activeRunId]);
      if (owner === undefined) return next;
      return { ...next, runs: { ...next.runs, [owner.id]: { ...owner, plan } } };
    }

    case 'task.status': {
      const { taskKey, run } = known.payload;
      const existing = next.runs[run.runId];
      if (existing === undefined) return next;
      return {
        ...next,
        runs: { ...next.runs, [run.runId]: { ...existing, tasks: { ...existing.tasks, [taskKey]: run } } },
      };
    }

    case 'agent.event': {
      const agentEvent = known.payload;
      const log = next.agentLog[agentEvent.taskKey] ?? [];
      return {
        ...next,
        agentLog: {
          ...next.agentLog,
          [agentEvent.taskKey]: appendCapped(log, agentEvent, AGENT_LOG_CAP),
        },
      };
    }

    case 'audit.verdict': {
      const verdict = known.payload;
      const history = appendCapped(next.verdicts[verdict.taskKey] ?? [], verdict, VERDICT_CAP);
      const taskUpdate = updateTask(next, known.runId, verdict.taskKey, (task) =>
        task.lastVerdict === undefined || verdict.attempt >= task.lastVerdict.attempt
          ? { ...task, lastVerdict: verdict }
          : task,
      );
      return { ...next, ...taskUpdate, verdicts: { ...next.verdicts, [verdict.taskKey]: history } };
    }

    case 'merge.result': {
      return { ...next, merges: appendCapped(next.merges, known.payload, MERGE_CAP) };
    }

    case 'metrics': {
      const sample: MetricsSample = { ts: known.ts, metrics: known.payload };
      const active = next.activeRunId === undefined ? undefined : next.runs[next.activeRunId];
      const runs =
        active === undefined
          ? next.runs
          : { ...next.runs, [active.id]: { ...active, metrics: known.payload } };
      return { ...next, runs, metricsHistory: appendCapped(next.metricsHistory, sample, METRICS_CAP) };
    }

    case 'node.joined':
    case 'node.stats': {
      const node = known.payload.node;
      return { ...next, nodes: { ...next.nodes, [node.id]: node } };
    }

    case 'node.left': {
      const node = next.nodes[known.payload.nodeId];
      if (node === undefined) return next;
      return {
        ...next,
        nodes: { ...next.nodes, [node.id]: { ...node, status: 'offline' } },
      };
    }

    case 'task.migrated': {
      const { taskKey, toNode } = known.payload;
      if (next.activeRunId === undefined) return next;
      const taskUpdate = updateTask(next, next.activeRunId, taskKey, (task) => ({ ...task, nodeId: toNode }));
      return { ...next, ...taskUpdate };
    }

    case 'run.finished': {
      const run = known.payload.run;
      const active = next.activeRunId === undefined ? undefined : next.runs[next.activeRunId];
      const follow = active === undefined || run.startedAt >= active.startedAt;
      return {
        ...next,
        runs: { ...next.runs, [run.id]: run },
        activeRunId: follow ? run.id : next.activeRunId,
      };
    }

    // Wave 2 (Epic 40) added this arm to core; `run.status` reaches the picker through the
    // `isRunStatusEvent` guard above, so the switch over `KnownStarlingEvent` excludes it.

    // Events the shell keeps for the timeline/log but that change no derived state.
    case 'repomap.ready':
    case 'log':
      return next;

    default: {
      // Compile-time exhaustiveness: a new StarlingEvent type must fail typecheck rather than be
      // silently dropped. Runtime-wise an unknown-but-well-formed frame (a newer hub) is ignored, so
      // it can never be mistaken for the next state.
      const neverEvent: never = known;
      void neverEvent;
      return next;
    }
  }
}

/** Convenience for callers holding a batch (SSE backlog, JSONL replay). */
export function applyEvents(state: SkyState, events: readonly StarlingEvent[]): SkyState {
  return events.reduce(applyEvent, state);
}
