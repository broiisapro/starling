import dagre from '@dagrejs/dagre';
import type { Plan } from '@starling/core';

/**
 * Pure DAG layout. Dagre runs left→right (the "zoom in" reading order: roots on the left, merged
 * features on the right). Kept free of React so tests can assert positions without a DOM.
 */
export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 96;

export interface Point {
  x: number;
  y: number;
}

export interface DagLayout {
  positions: Record<string, Point>;
  width: number;
  height: number;
}

const GRAPH_MARGIN = 16;

/** Layout a plan's tasks. Missing dependency edges are ignored (the planner validator reports them). */
export function layoutPlan(plan: Plan | undefined): DagLayout {
  if (!plan || plan.tasks.length === 0) return { positions: {}, width: 0, height: 0 };

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 72, marginx: GRAPH_MARGIN, marginy: GRAPH_MARGIN });

  const keys = new Set(plan.tasks.map((task) => task.key));
  for (const task of plan.tasks) graph.setNode(task.key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (keys.has(dep)) graph.setEdge(dep, task.key);
    }
  }

  dagre.layout(graph);

  const positions: Record<string, Point> = {};
  for (const task of plan.tasks) {
    const node = graph.node(task.key) as { x: number; y: number } | undefined;
    if (!node) continue;
    positions[task.key] = { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 };
  }

  const graphLabel = graph.graph() as { width?: number; height?: number };
  return {
    positions,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}

/**
 * Plans are immutable once `plan.created` fires, so caching by plan id is safe. A Layout takes ~1ms
 * per task, which is noticeable when the drawer re-renders on every agent event.
 */
const layoutCache = new Map<string, DagLayout>();
const LAYOUT_CACHE_LIMIT = 16;

export function layoutFor(plan: Plan | undefined): DagLayout {
  if (!plan) return { positions: {}, width: 0, height: 0 };
  const hit = layoutCache.get(plan.id);
  if (hit) return hit;
  const layout = layoutPlan(plan);
  if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear();
  layoutCache.set(plan.id, layout);
  return layout;
}

/** Exposed for tests that need to prove memoisation without reaching into module state. */
export function clearLayoutCache(): void {
  layoutCache.clear();
}

export type Direction = 'left' | 'right' | 'up' | 'down';

function primaryDelta(direction: Direction, dx: number, dy: number): number {
  switch (direction) {
    case 'left':
      return -dx;
    case 'right':
      return dx;
    case 'up':
      return -dy;
    case 'down':
      return dy;
  }
}

function crossDelta(direction: Direction, dx: number, dy: number): number {
  return direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
}

/**
 * Keyboard navigation: pick the closest node that actually lies in `direction` from the current one.
 * "Closest" is primary distance plus twice the cross-axis drift, which keeps the cursor on its row.
 * Returns undefined when nothing lies that way (the caller keeps the current selection).
 */
export function pickNeighbour(
  positions: Record<string, Point>,
  current: string | undefined,
  direction: Direction,
): string | undefined {
  const keys = Object.keys(positions).sort();
  if (keys.length === 0) return undefined;
  const origin = current === undefined ? undefined : positions[current];
  if (!origin) return keys[0];

  let best: { key: string; score: number } | undefined;
  for (const key of keys) {
    if (key === current) continue;
    const point = positions[key];
    if (!point) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const primary = primaryDelta(direction, dx, dy);
    if (primary <= 4) continue;
    const score = primary + 2 * crossDelta(direction, dx, dy);
    if (!best || score < best.score || (score === best.score && key < best.key)) best = { key, score };
  }
  return best?.key;
}

/** Row/rank order used when no task is selected yet (top-left first). */
export function firstKey(positions: Record<string, Point>): string | undefined {
  return Object.keys(positions).sort((a, b) => {
    const pa = positions[a];
    const pb = positions[b];
    if (!pa || !pb) return a.localeCompare(b);
    return pa.x - pb.x || pa.y - pb.y || a.localeCompare(b);
  })[0];
}
