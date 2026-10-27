/**
 * Node-capacity maths for the dispatch loop.
 *
 * The registry's `activeSessions` is a remote node's own report and can lag by one heartbeat. The
 * engine therefore treats its own assignments as authoritative when deciding where the next task
 * fits: a slot we just filled must not be handed out twice.
 */
import type { NodeInfo } from '@starling/core';

/** Drop offline nodes and rewrite `activeSessions` from the engine's own bookkeeping. */
export function dispatchableNodes(
  nodes: NodeInfo[],
  activeByNode: Record<string, number>,
  excluded: ReadonlySet<string> = new Set(),
): NodeInfo[] {
  return nodes
    .filter((node) => node.status !== 'offline' && !excluded.has(node.id))
    .map((node) => ({ ...node, activeSessions: activeByNode[node.id] ?? 0 }));
}

/** Total free sessions across the given nodes. */
export function availableSlots(nodes: NodeInfo[], activeByNode: Record<string, number>): number {
  return nodes.reduce((sum, node) => {
    if (node.status === 'offline') return sum;
    const used = activeByNode[node.id] ?? 0;
    return sum + Math.max(0, node.maxSessions - used);
  }, 0);
}
