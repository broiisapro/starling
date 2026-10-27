import type { NodeInfo, Scheduler, TaskSpec } from '@starling/core';

/** Free agent slots on a node. Never negative, even if a perch over-reports activity. */
export function freeSlots(node: NodeInfo): number {
  return Math.max(0, node.maxSessions - node.activeSessions);
}

/** A node can take work when it is reachable and has a free slot. `busy` nodes are still schedulable. */
export function isSchedulable(node: NodeInfo): boolean {
  return node.status !== 'offline' && freeSlots(node) > 0;
}

export interface SchedulerOptions {
  /** The hub's own node id. Ties prefer it, so the local machine is used before shipping a bundle. */
  hubId?: string;
}

/**
 * Order nodes for a task: most free slots, then lowest latency, then the hub, then id.
 *
 * Pure and total: the returned array is a new array of the input objects (no mutation), so callers
 * can render the same ordering in the dashboard.
 */
export function rankNodes(nodes: NodeInfo[], options: SchedulerOptions = {}): NodeInfo[] {
  const hubId = options.hubId ?? 'hub';
  const latencyOf = (node: NodeInfo): number => node.latencyMs ?? Number.POSITIVE_INFINITY;
  return nodes.filter(isSchedulable).sort((a, b) => {
    const bySlots = freeSlots(b) - freeSlots(a);
    if (bySlots !== 0) return bySlots;

    // Compare, don't subtract: `Infinity - Infinity` is NaN, and a NaN comparator silently leaves
    // the array in insertion order — which made "every tie breaks by id" depend on heartbeat order.
    const aLatency = latencyOf(a);
    const bLatency = latencyOf(b);
    if (aLatency !== bLatency) return aLatency < bLatency ? -1 : 1;

    const aHub = a.id === hubId || a.kind === 'local' ? 0 : 1;
    const bHub = b.id === hubId || b.kind === 'local' ? 0 : 1;
    if (aHub !== bHub) return aHub - bHub;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Capacity-aware scheduler (ARCHITECTURE §1): pick the online node with the most free session slots.
 *
 * Perches advertise `maxSessions` themselves (MBP 8, Air 5 in the demo), so a bigger machine
 * naturally attracts more tasks without a central capacity table. Ties prefer the lowest measured
 * latency, then the hub, then a stable id order. No capacity means `undefined` — never an oversubscribed
 * node, because an opencode session per slot is a real memory cost.
 */
export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  return {
    pick(nodes: NodeInfo[], _task: TaskSpec): string | undefined {
      // The scheduler is deliberately task-agnostic: lanes are a plan-level constraint, and any task
      // may run anywhere once its dependencies have merged. The parameter stays for the port's shape
      // and for a future affinity policy (a task pinned to a node with a warm local model).
      return rankNodes(nodes, options)[0]?.id;
    },
  };
}
