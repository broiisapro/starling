import type {
  AgentEvent,
  AuditVerdict,
  MergeResult,
  NodeInfo,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
} from '@starling/core';
import type { JoinInfo } from './handshake';

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
    connection: 'offline',
  };
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

  switch (event.type) {
    case 'run.created': {
      const run = event.payload.run;
      return { ...next, runs: { ...next.runs, [run.id]: run }, activeRunId: run.id };
    }

    case 'plan.created': {
      const plan = event.payload.plan;
      const owner =
        Object.values(next.runs).find((run) => run.goal.id === plan.goalId) ??
        (next.activeRunId === undefined ? undefined : next.runs[next.activeRunId]);
      if (owner === undefined) return next;
      return { ...next, runs: { ...next.runs, [owner.id]: { ...owner, plan } } };
    }

    case 'task.status': {
      const { taskKey, run } = event.payload;
      const existing = next.runs[run.runId];
      if (existing === undefined) return next;
      return {
        ...next,
        runs: { ...next.runs, [run.runId]: { ...existing, tasks: { ...existing.tasks, [taskKey]: run } } },
      };
    }

    case 'agent.event': {
      const agentEvent = event.payload;
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
      const verdict = event.payload;
      const history = appendCapped(next.verdicts[verdict.taskKey] ?? [], verdict, VERDICT_CAP);
      const taskUpdate = updateTask(next, event.runId, verdict.taskKey, (task) =>
        task.lastVerdict === undefined || verdict.attempt >= task.lastVerdict.attempt
          ? { ...task, lastVerdict: verdict }
          : task,
      );
      return { ...next, ...taskUpdate, verdicts: { ...next.verdicts, [verdict.taskKey]: history } };
    }

    case 'merge.result': {
      return { ...next, merges: appendCapped(next.merges, event.payload, MERGE_CAP) };
    }

    case 'metrics': {
      const sample: MetricsSample = { ts: event.ts, metrics: event.payload };
      const active = next.activeRunId === undefined ? undefined : next.runs[next.activeRunId];
      const runs =
        active === undefined
          ? next.runs
          : { ...next.runs, [active.id]: { ...active, metrics: event.payload } };
      return { ...next, runs, metricsHistory: appendCapped(next.metricsHistory, sample, METRICS_CAP) };
    }

    case 'node.joined':
    case 'node.stats': {
      const node = event.payload.node;
      return { ...next, nodes: { ...next.nodes, [node.id]: node } };
    }

    case 'node.left': {
      const node = next.nodes[event.payload.nodeId];
      if (node === undefined) return next;
      return {
        ...next,
        nodes: { ...next.nodes, [node.id]: { ...node, status: 'offline' } },
      };
    }

    case 'task.migrated': {
      const { taskKey, toNode } = event.payload;
      if (next.activeRunId === undefined) return next;
      const taskUpdate = updateTask(next, next.activeRunId, taskKey, (task) => ({ ...task, nodeId: toNode }));
      return { ...next, ...taskUpdate };
    }

    case 'run.finished': {
      const run = event.payload.run;
      return { ...next, runs: { ...next.runs, [run.id]: run }, activeRunId: run.id };
    }

    // Events the shell keeps for the timeline/log but that change no derived state.
    case 'repomap.ready':
    case 'log':
      return next;

    default: {
      // Exhaustiveness guard: a new StarlingEvent type should fail typecheck, not be silently ignored.
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

/** Convenience for callers holding a batch (SSE backlog, JSONL replay). */
export function applyEvents(state: SkyState, events: readonly StarlingEvent[]): SkyState {
  return events.reduce(applyEvent, state);
}
