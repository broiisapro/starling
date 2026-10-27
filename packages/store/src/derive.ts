/**
 * `deriveRun` — fold a recording back into the latest `Run` snapshot.
 *
 * The engine publishes new snapshots (`run.created`, `task.status`, `run.finished`) rather than
 * diffs, so replaying a recording is a reducer over those snapshots plus the events that carry
 * state without a full run (`plan.created`, `metrics`, `task.migrated`, node.*). This is the
 * reference implementation the web dashboard's reducer is cross-checked against (Epic 23).
 *
 * Flock (`node.*`) events carry `runId: '*'` because they are not run-scoped (ARCHITECTURE §6),
 * so the accumulator never filters by runId: apply it to one run's stream (which may include `'*'`
 * events) and the extra node events only land in `nodes`, never in the `Run`.
 */
import type { NodeInfo, Run, RunStatus, StarlingEvent } from '@starling/core';

/** Everything a recorded stream can tell us about a run. `Run` has no place for the flock, so nodes live here. */
export interface DerivedRunState {
  /** Latest run snapshot, or `undefined` until a `run.created` / `run.finished` event is seen. */
  run: Run | undefined;
  /** Last-known `NodeInfo` per node id, in first-seen order, with `node.left` applied as offline. */
  nodes: NodeInfo[];
  /** Number of events folded in (useful for assertions and replay diagnostics). */
  eventCount: number;
  /** Timestamp of the last folded event. */
  lastTs: number | undefined;
}

/** Incremental form of `deriveRun`; the recorder reuses it instead of re-folding the whole stream. */
export interface RunAccumulator {
  apply(event: StarlingEvent): void;
  /** Snapshot of the current state (deep-cloned, so callers cannot mutate the accumulator). */
  state(): DerivedRunState;
  /** Convenience for `state().run`. */
  run(): Run | undefined;
}

const PRE_RUNNING: readonly RunStatus[] = ['mapping', 'planning', 'planned'];

function advanceStatus(run: Run, next: RunStatus, allowedFrom: readonly RunStatus[]): void {
  if (allowedFrom.includes(run.status)) run.status = next;
}

function setTaskNode(run: Run, taskKey: string, nodeId: string): void {
  const task = run.tasks[taskKey];
  if (task === undefined) return;
  run.tasks[taskKey] = { ...task, nodeId };
}

/** Deep clone so the reducer never aliases (or mutates) an event payload the caller still owns. */
function cloneRun(run: Run): Run {
  return structuredClone(run);
}

export function createRunAccumulator(initialEvents: readonly StarlingEvent[] = []): RunAccumulator {
  let run: Run | undefined;
  let eventCount = 0;
  let lastTs: number | undefined;
  const nodes = new Map<string, NodeInfo>();

  const apply = (event: StarlingEvent): void => {
    eventCount += 1;
    lastTs = event.ts;

    switch (event.type) {
      case 'run.created': {
        run = cloneRun(event.payload.run);
        break;
      }
      case 'plan.created': {
        if (run === undefined) break;
        run.plan = structuredClone(event.payload.plan);
        advanceStatus(run, 'planned', ['mapping', 'planning']);
        break;
      }
      case 'task.status': {
        if (run === undefined) break;
        run.tasks[event.payload.taskKey] = structuredClone(event.payload.run);
        advanceStatus(run, 'running', PRE_RUNNING);
        break;
      }
      case 'audit.verdict': {
        if (run === undefined) break;
        const task = run.tasks[event.payload.taskKey];
        if (task !== undefined) task.lastVerdict = structuredClone(event.payload);
        break;
      }
      case 'merge.result': {
        if (run === undefined) break;
        const task = run.tasks[event.payload.taskKey];
        if (task === undefined) break;
        if (event.payload.status === 'merged') task.status = 'merged';
        else if (event.payload.status === 'conflict') task.status = 'conflict';
        // `tests-failed` and `skipped` are not status transitions of their own: the engine emits a
        // following `task.status` (fixing/failed) that carries the authoritative snapshot.
        break;
      }
      case 'metrics': {
        if (run === undefined) break;
        run.metrics = structuredClone(event.payload);
        break;
      }
      case 'node.joined':
      case 'node.stats': {
        nodes.set(event.payload.node.id, structuredClone(event.payload.node));
        break;
      }
      case 'node.left': {
        const node = nodes.get(event.payload.nodeId);
        if (node === undefined) break;
        nodes.set(node.id, { ...node, status: 'offline', lastSeen: event.ts });
        break;
      }
      case 'task.migrated': {
        if (run === undefined) break;
        setTaskNode(run, event.payload.taskKey, event.payload.toNode);
        break;
      }
      case 'run.finished': {
        // Authoritative final snapshot; it supersedes every inferred transition above.
        run = cloneRun(event.payload.run);
        break;
      }
      case 'repomap.ready':
      case 'agent.event':
      case 'log': {
        break;
      }
    }
  };

  for (const event of initialEvents) apply(event);

  const snapshot = (): DerivedRunState => ({
    run: run === undefined ? undefined : structuredClone(run),
    nodes: [...nodes.values()].map((node) => structuredClone(node)),
    eventCount,
    lastTs,
  });

  return {
    apply,
    state: snapshot,
    run: () => (run === undefined ? undefined : structuredClone(run)),
  };
}

/** Fold an event stream into the latest `Run` snapshot. Pure: the input events are never mutated. */
export function deriveRun(events: readonly StarlingEvent[]): Run | undefined {
  return createRunAccumulator(events).run();
}

/** `deriveRun` plus the flock nodes seen in the stream. `Run` itself has no node field. */
export function deriveRunState(events: readonly StarlingEvent[]): DerivedRunState {
  return createRunAccumulator(events).state();
}
