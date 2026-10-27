import type { NodeInfo, StarlingEvent, TaskRun } from '@starling/core';
import { sortRoosts } from './format';

/**
 * Derive the roost list from the event stream.
 *
 * The dashboard normally gets `NodeInfo[]` from `GET /api/nodes` and live `node.*` events. Replay and
 * the fixture playground have neither, so this tiny reducer folds the same events into the same
 * shape: `node.joined`/`node.stats` upsert, `node.left` marks offline while keeping the hardware
 * details, a later `node.joined` brings the node back. Unknown `node.left` ids are ignored — a leave
 * carries no name, platform or capacity, so rendering it would mean inventing facts.
 */
export function deriveNodes(events: readonly StarlingEvent[]): NodeInfo[] {
  const nodes = new Map<string, NodeInfo>();

  for (const event of events) {
    if (event.type === 'node.joined' || event.type === 'node.stats') {
      const node = event.payload.node;
      const previous = nodes.get(node.id);
      nodes.set(node.id, {
        ...node,
        // A heartbeat may omit the optional fields; keep the last known values instead of erasing them.
        url: node.url ?? previous?.url,
        latencyMs: node.latencyMs ?? previous?.latencyMs,
        lastSeen: Math.max(node.lastSeen, event.ts),
      });
      continue;
    }
    if (event.type === 'node.left') {
      const existing = nodes.get(event.payload.nodeId);
      if (!existing) continue;
      // A departed perch has no running sessions; its tasks are migrated by the engine.
      nodes.set(existing.id, {
        ...existing,
        status: 'offline',
        activeSessions: 0,
        lastSeen: Math.max(existing.lastSeen, event.ts),
      });
    }
  }

  return sortRoosts([...nodes.values()]);
}

/**
 * Fold `run.created`, `task.status` and `run.finished` into the `tasks` map the panel renders.
 * Last write wins, which is exactly how the store will build `Run.tasks` at C1. The playground uses
 * this so the Air's migrated task visibly moves to the hub.
 */
export function deriveTasks(events: readonly StarlingEvent[]): Record<string, TaskRun> {
  const tasks: Record<string, TaskRun> = {};

  for (const event of events) {
    if (event.type === 'run.created' || event.type === 'run.finished') {
      for (const [key, run] of Object.entries(event.payload.run.tasks)) {
        tasks[key] = run;
      }
      continue;
    }
    if (event.type === 'task.status') {
      tasks[event.payload.run.taskKey] = event.payload.run;
    }
  }

  return tasks;
}
