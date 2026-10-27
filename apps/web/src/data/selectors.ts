import type { NodeInfo, Run, StarlingEvent, TaskRun } from '@starling/core';
import type {
  AgentDrawerProps,
  DagViewProps,
  FlockPanelProps,
  MergeQueueProps,
  MetricsPanelProps,
  SkyViewProps,
} from './handshake';
import { RECENT_CAP, type SkyState } from './reducer';
import { skyActions } from './store';

/**
 * Prop builders: the only bridge from the store to the six feature panels (ARCHITECTURE §8).
 *
 * At C1 a region becomes one line:
 *
 *     <SkyView {...skyProps(state)} />
 *
 * Panels stay pure (plain props), selectors stay pure (state in, props out), and the store is only
 * touched through the optional `actions` argument so tests can pass spies.
 */
export interface SelectorActions {
  selectTask: (key: string) => void;
  closeDrawer: () => void;
}

/** Defaults call the real store, which is what makes the C1 one-liners work. */
export const storeActions: SelectorActions = {
  selectTask: (key) => skyActions.selectTask(key),
  closeDrawer: () => skyActions.selectTask(),
};

const SKY_EVENT_TYPES = new Set<StarlingEvent['type']>([
  'run.created',
  'task.status',
  'agent.event',
  'audit.verdict',
  'merge.result',
  'node.joined',
  'node.left',
  'node.stats',
  'task.migrated',
  'run.finished',
]);

function activeRun(state: SkyState): Run | undefined {
  return state.activeRunId === undefined ? undefined : state.runs[state.activeRunId];
}

/** Hub first (it is the roost), then locals before perches, then name. */
export function sortedNodes(state: SkyState): NodeInfo[] {
  return Object.values(state.nodes).sort((a, b) => {
    if (a.id === 'hub') return -1;
    if (b.id === 'hub') return 1;
    if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** All runs, newest first — the run picker's order. */
export function sortedRuns(state: SkyState): Run[] {
  return Object.values(state.runs).sort((a, b) => b.startedAt - a.startedAt);
}

export function activeRunOf(state: SkyState): Run | undefined {
  return activeRun(state);
}

/**
 * SkyView wants a short, juicy tail of events (bird flutters, landings), not the whole log.
 */
export function recentEvents(state: SkyState, cap = RECENT_CAP): StarlingEvent[] {
  const relevant = state.events.filter((event) => SKY_EVENT_TYPES.has(event.type));
  return relevant.slice(-cap);
}

export function skyProps(state: SkyState, actions: SelectorActions = storeActions): SkyViewProps {
  const run = activeRun(state);
  const props: SkyViewProps = {
    nodes: sortedNodes(state),
    recent: recentEvents(state),
    onSelectTask: actions.selectTask,
  };
  if (run !== undefined) props.run = run;
  if (state.selectedTask !== undefined) props.selectedTask = state.selectedTask;
  return props;
}

/** Shared empty map for runs without tasks, so prop identity is stable across renders. */
const EMPTY_TASKS: Record<string, TaskRun> = {};
/** Last display copy per store `tasks` object, so prop identity is stable between renders. */
const displayCache = new WeakMap<
  Record<string, TaskRun>,
  { signature: string; tasks: Record<string, TaskRun> }
>();

/**
 * One run with `nodeId` shown as the roost's name. The §8 prop types carry only `TaskRun`, whose
 * node field is `nodeId`; the DAG badge, the drawer header and the queue card all render it as a
 * *label*. So those three panels get this display copy ("M2 Air", not "air") — the prop types are
 * untouched (a CONTRACT REQUEST asks core for a dedicated `nodeName` in Wave 2).
 *
 * The Sky and the flock panel keep the real ids: the Sky looks roosts up by id, and the flock panel
 * groups tasks per node.
 */
function displayRun(state: SkyState, task: TaskRun): TaskRun {
  if (task.nodeId === undefined) return task;
  const name = state.nodes[task.nodeId]?.name;
  if (name === undefined || name === task.nodeId) return task;
  return { ...task, nodeId: name };
}

/**
 * The task map with every `nodeId` displayed as a node name (see `displayRun`). Results are cached
 * per store `tasks` object + node-name signature, so a re-render that changed nothing keeps prop
 * identity and does not invalidate a panel's memo.
 */
export function displayTasks(state: SkyState, tasks: Record<string, TaskRun>): Record<string, TaskRun> {
  const signature = Object.values(state.nodes)
    .map((node) => `${node.id}=${node.name}`)
    .join('|');
  const cached = displayCache.get(tasks);
  if (cached !== undefined && cached.signature === signature) return cached.tasks;

  let changed = false;
  const next: Record<string, TaskRun> = {};
  for (const [key, task] of Object.entries(tasks)) {
    const display = displayRun(state, task);
    if (display !== task) changed = true;
    next[key] = display;
  }
  const result = changed ? next : tasks;
  displayCache.set(tasks, { signature, tasks: result });
  return result;
}

export function dagProps(state: SkyState, actions: SelectorActions = storeActions): DagViewProps {
  const run = activeRun(state);
  const props: DagViewProps = {
    tasks: displayTasks(state, run?.tasks ?? EMPTY_TASKS),
    onSelectTask: actions.selectTask,
  };
  if (run?.plan !== undefined) props.plan = run.plan;
  if (state.selectedTask !== undefined) props.selectedTask = state.selectedTask;
  return props;
}

export function drawerProps(state: SkyState, actions: SelectorActions = storeActions): AgentDrawerProps {
  const run = activeRun(state);
  const key = state.selectedTask;
  const task = key === undefined ? undefined : run?.plan?.tasks.find((candidate) => candidate.key === key);
  const props: AgentDrawerProps = {
    events: key === undefined ? [] : (state.agentLog[key] ?? []),
    verdicts: key === undefined ? [] : (state.verdicts[key] ?? []),
    onClose: actions.closeDrawer,
  };
  if (task !== undefined) props.task = task;
  const taskRun = key === undefined ? undefined : run?.tasks[key];
  if (taskRun !== undefined) props.run = displayRun(state, taskRun);
  // Diffs are fetched lazily by the drawer at C1 (the event stream carries summaries, not patches).
  return props;
}

export function queueProps(state: SkyState, actions: SelectorActions = storeActions): MergeQueueProps {
  const run = activeRun(state);
  const props: MergeQueueProps = {
    tasks: displayTasks(state, run?.tasks ?? EMPTY_TASKS),
    merges: state.merges,
    onSelectTask: actions.selectTask,
  };
  if (run?.plan !== undefined) props.plan = run.plan;
  return props;
}

/**
 * Additive props Epic 26's panel gained after §8 was frozen. Declared as an intersection of the
 * frozen contract, so this file compiles both before and after core grows the field (C1's core
 * consolidation adds `live?: boolean` to `MetricsPanelProps`).
 */
export type MetricsExtras = { live?: boolean };

export function metricsProps(state: SkyState, extras: MetricsExtras = {}): MetricsPanelProps & MetricsExtras {
  const run = activeRun(state);
  const latest = state.metricsHistory.at(-1);
  const props: MetricsPanelProps & MetricsExtras = { history: state.metricsHistory, ...extras };
  const metrics = latest?.metrics ?? run?.metrics;
  if (metrics !== undefined) props.metrics = metrics;
  return props;
}

/**
 * Additive props Epic 32's panel gained after §8 was frozen (`compact`, `reducedMotion`, `now`,
 * `onSelectTask`). Same trick as `MetricsExtras`: the intersection compiles now and after core's
 * `FlockPanelProps` grows `onSelectTask` at C1 — no call-site change either way.
 */
export type FlockExtras = {
  compact?: boolean;
  reducedMotion?: boolean;
  now?: number;
  onSelectTask?(taskKey: string): void;
};

export function flockProps(
  state: SkyState,
  actions: SelectorActions = storeActions,
  extras: FlockExtras = {},
): FlockPanelProps & FlockExtras {
  const run = activeRun(state);
  const props: FlockPanelProps & FlockExtras = {
    nodes: sortedNodes(state),
    tasks: run?.tasks ?? {},
    // Real node ids here (not display names): the panel groups tasks per roost.
    onSelectTask: actions.selectTask,
    ...extras,
  };
  if (state.join !== undefined) props.join = state.join;
  return props;
}
