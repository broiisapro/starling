import type { NodeInfo, Run, StarlingEvent } from '@starling/core';
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

export function dagProps(state: SkyState, actions: SelectorActions = storeActions): DagViewProps {
  const run = activeRun(state);
  const props: DagViewProps = {
    tasks: run?.tasks ?? {},
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
  if (taskRun !== undefined) props.run = taskRun;
  // Diffs are fetched lazily by the drawer at C1 (the event stream carries summaries, not patches).
  return props;
}

export function queueProps(state: SkyState, actions: SelectorActions = storeActions): MergeQueueProps {
  const run = activeRun(state);
  const props: MergeQueueProps = {
    tasks: run?.tasks ?? {},
    merges: state.merges,
    onSelectTask: actions.selectTask,
  };
  if (run?.plan !== undefined) props.plan = run.plan;
  return props;
}

export function metricsProps(state: SkyState): MetricsPanelProps {
  const run = activeRun(state);
  const latest = state.metricsHistory.at(-1);
  const props: MetricsPanelProps = { history: state.metricsHistory };
  const metrics = latest?.metrics ?? run?.metrics;
  if (metrics !== undefined) props.metrics = metrics;
  return props;
}

export function flockProps(state: SkyState): FlockPanelProps {
  const run = activeRun(state);
  const props: FlockPanelProps = {
    nodes: sortedNodes(state),
    tasks: run?.tasks ?? {},
  };
  if (state.join !== undefined) props.join = state.join;
  return props;
}
