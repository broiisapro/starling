import type { NodeInfo, Run, StarlingEvent, TaskRun } from '@starling/core/browser';
import { taskFlightMs, taskKeys } from './math';
import type { NodeContribution } from './types';

/**
 * Which roost did what.
 *
 * Grouping is by `TaskRun.nodeId` — after a migration the reducer has already rewritten that field
 * to the *destination* node (see `data/reducer.ts`), so the migration is counted separately from the
 * `task.migrated` events. That is deliberate: a task belongs to the node that finished it, while
 * `migratedOut`/`migratedIn` carry the story of who lost it.
 */
export function nodeContributions(
  run: Run,
  events: readonly StarlingEvent[],
  nodes: Record<string, NodeInfo>,
): NodeContribution[] {
  const keys = new Set(taskKeys(run));
  const byNode = new Map<string, NodeContribution>();

  const contribution = (nodeId: string): NodeContribution => {
    const existing = byNode.get(nodeId);
    if (existing !== undefined) return existing;
    const created: NodeContribution = {
      nodeId,
      name: nodes[nodeId]?.name ?? nodeId,
      tasks: 0,
      merged: 0,
      flightMs: 0,
      costUsd: 0,
      migratedIn: 0,
      migratedOut: 0,
    };
    byNode.set(nodeId, created);
    return created;
  };

  for (const task of Object.values(run.tasks)) {
    if (!keys.has(task.taskKey)) continue;
    const entry = contribution(task.nodeId ?? 'unassigned');
    entry.tasks += 1;
    if (task.status === 'merged') entry.merged += 1;
    entry.flightMs += taskFlightMs(task) ?? 0;
    entry.costUsd += task.costUsd;
  }

  for (const event of events) {
    if (event.type !== 'task.migrated') continue;
    if (event.runId !== '*' && event.runId !== run.id) continue;
    const { taskKey, fromNode, toNode } = event.payload;
    if (!keys.has(taskKey)) continue;
    // A node that only appears through a migration still earns a row: it did hold the branch.
    contribution(fromNode).migratedOut += 1;
    contribution(toNode).migratedIn += 1;
  }

  return [...byNode.values()].sort((a, b) => {
    if (a.nodeId === 'hub') return -1;
    if (b.nodeId === 'hub') return 1;
    if (a.tasks !== b.tasks) return b.tasks - a.tasks;
    if (a.flightMs !== b.flightMs) return b.flightMs - a.flightMs;
    return a.name.localeCompare(b.name);
  });
}

/** Sum of a node's measured task time, used for bar widths; never negative. */
export function maxFlightMs(nodes: readonly NodeContribution[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.flightMs), 0);
}

/** Tasks per node including the `unassigned` bucket, for the "who did what" caption. */
export function tasksOnNode(tasks: Record<string, TaskRun>, nodeId: string): TaskRun[] {
  return Object.values(tasks).filter((task) => (task.nodeId ?? 'unassigned') === nodeId);
}
