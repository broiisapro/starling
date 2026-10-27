import type { NodeInfo } from '@starling/core';

/** The hub's node id is fixed by ARCHITECTURE §8 (`registry` includes the hub LocalNode as 'hub'). */
export const HUB_NODE_ID = 'hub';

export function isHub(node: NodeInfo): boolean {
  return node.id === HUB_NODE_ID || node.kind === 'local';
}

/**
 * Hub first (the reference roost), then by name so cards never shuffle between renders just because
 * a heartbeat arrived. `sortRoosts` is stable for equal names and falls back to the id.
 */
export function sortRoosts(nodes: readonly NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => {
    const hubDelta = Number(isHub(b)) - Number(isHub(a));
    if (hubDelta !== 0) return hubDelta;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

/**
 * Human "last seen" copy. Deliberately unit-simple: 1s, 12s, 2m, 3h, 4d. A future tick can call it
 * every second and the labels will stay readable.
 */
export function relativeTime(ts: number, now: number): string {
  const delta = now - ts;
  if (!Number.isFinite(delta) || delta < 1_000) return 'just now';
  const seconds = Math.floor(delta / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatLatency(latencyMs: number | undefined): string {
  if (latencyMs === undefined || !Number.isFinite(latencyMs)) return 'no ping';
  if (latencyMs < 2) return '<2 ms';
  return `${Math.round(latencyMs)} ms`;
}

export function formatMemory(memGb: number): string {
  return Number.isInteger(memGb) ? `${memGb} GB` : `${memGb.toFixed(1)} GB`;
}

/**
 * The hardware line split into atoms that must not break internally: `['darwin · arm64',
 * '8 cores · 16 GB']`.
 *
 * The 15 rem rail is too narrow for one line, and letting the browser break anywhere split the
 * memory size across lines — the first browser pass rendered "… 12 cores · 32" / "GB". Wrapping
 * between these two atoms is the only break that reads correctly.
 */
export function formatHardwareParts(node: NodeInfo): string[] {
  return [`${node.platform} · ${node.arch}`, `${node.cpuCores} cores · ${formatMemory(node.memGb)}`];
}

/** "darwin · arm64 · 8 cores · 16 GB" — the hardware line under the roost name. */
export function formatHardware(node: NodeInfo): string {
  return formatHardwareParts(node).join(' · ');
}

export function freeSessions(node: NodeInfo): number {
  return Math.max(0, node.maxSessions - node.activeSessions);
}

export interface SessionTotals {
  active: number;
  max: number;
  free: number;
}

/** Fleet-wide session totals, clamping a node that over-reports so the header never shows -1 free. */
export function sessionTotals(nodes: readonly NodeInfo[]): SessionTotals {
  let active = 0;
  let max = 0;
  for (const node of nodes) {
    max += node.maxSessions;
    active += Math.min(node.activeSessions, node.maxSessions);
  }
  return { active, max, free: Math.max(0, max - active) };
}

export function modelLabel(model: string): string {
  return `lends ${model}`;
}
