/**
 * Geometry for the Sky: the `main` wire, the roosts and the calm (reduced-motion) zones.
 *
 * Pure functions, no DOM: `sim.ts` uses them for behaviour targets, `render.ts` for drawing, and the
 * tests use them directly. Everything is in CSS pixels; the canvas applies the devicePixelRatio.
 */
import type { NodeInfo, TaskStatus } from '@starling/core';

export interface Wire {
  left: number;
  right: number;
  /** Height of the wire where it is pinned, near the top of the sky. */
  anchorY: number;
  /** How far the middle of the wire hangs below the anchors. */
  sag: number;
  /** Catenary height at `x`, in CSS pixels. */
  yAt(x: number): number;
}

export interface Roost {
  nodeId: string;
  name: string;
  kind: NodeInfo['kind'];
  /** Centre of the branch, at the bottom of the sky. */
  x: number;
  y: number;
  width: number;
  side: 'left' | 'right';
  /** Animates to 1 when the node is online, 0.25 when it has left. */
  dim: number;
  dimTarget: number;
  /** 0 → 1 as a newly joined roost grows in and glows. */
  grow: number;
}

const WIRE_SLOTS_MARGIN = 52;

/**
 * The wire is a real catenary: `y = anchorY + sag · (cosh(k) − cosh(k·u)) / (cosh(k) − 1)` with
 * `u ∈ [−1, 1]` across the span. It is lowest in the middle and pinned at both ends, exactly like a
 * cable between two poles, and computed once per resize.
 */
export function makeWire(width: number, height: number): Wire {
  const left = 36;
  const right = Math.max(left + 40, width - 36);
  const anchorY = Math.max(30, height * 0.14);
  const sag = Math.max(14, height * 0.055);
  const k = 1.7;
  const denominator = Math.cosh(k) - 1;
  return {
    left,
    right,
    anchorY,
    sag,
    yAt(x: number): number {
      const span = right - left;
      const u = span <= 0 ? 0 : Math.max(-1, Math.min(1, ((x - left) / span) * 2 - 1));
      return anchorY + (sag * (Math.cosh(k) - Math.cosh(k * u))) / denominator;
    },
  };
}

/** Where wire slot `slot` of `slots` sits. Merged flocks fill the wire left → right in merge order. */
export function wireSlotX(wire: Wire, slot: number, slots: number): number {
  const usable = Math.max(20, wire.right - wire.left - WIRE_SLOTS_MARGIN * 2);
  const step = usable / Math.max(1, slots);
  return wire.left + WIRE_SLOTS_MARGIN + (slot + 0.5) * step;
}

/**
 * Roost layout: locals (the hub) grow inward from the bottom-left, remotes (perches) inward from the
 * bottom-right. With the usual one hub + one perch that puts the hub at the left branch and the Air
 * at the right branch; more machines share each side evenly.
 */
export function layoutRoosts(nodes: readonly NodeInfo[], width: number, height: number): Roost[] {
  const margin = Math.min(120, Math.max(72, width * 0.09));
  const y = height - 26;
  const locals = nodes.filter((n) => n.kind === 'local');
  const remotes = nodes.filter((n) => n.kind !== 'local');
  const spacing = Math.min(178, Math.max(96, ((width - margin * 2) * 0.86) / Math.max(2, nodes.length)));
  const roostWidth = Math.min(158, spacing * 0.94);
  const out: Roost[] = [];
  locals.forEach((node, i) => {
    out.push(roost(node, margin + i * spacing, y, roostWidth, 'left'));
  });
  remotes.forEach((node, i) => {
    out.push(roost(node, width - margin - i * spacing, y, roostWidth, 'right'));
  });
  return out;
}

function roost(node: NodeInfo, x: number, y: number, width: number, side: 'left' | 'right'): Roost {
  const active = node.status !== 'offline';
  return {
    nodeId: node.id,
    name: node.name,
    kind: node.kind,
    x,
    y,
    width,
    side,
    dim: active ? 1 : 0.25,
    dimTarget: active ? 1 : 0.25,
    grow: 1,
  };
}

/** Horizontal offset for a flock perched on a roost: spread the perches across the branch. */
export function roostPerchOffset(index: number, count: number): number {
  const n = Math.max(1, count);
  return (index - (n - 1) / 2) * 30;
}

/** Perches alternate between two heights so seven flocks read as a perched crowd, not one line. */
export function roostPerchRow(index: number): number {
  return index % 2 === 0 ? 0 : 11;
}

export interface Zone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type ZoneFractions = { x0: number; y0: number; x1: number; y1: number };

/**
 * Where each state parks its birds when reduced motion is on. Deliberately disjoint bands so the
 * calm layout is readable as a status map: active work in the upper sky, the queue in the middle,
 * failures and cancellations low and dim. `pending` and `merged` use their roost/wire instead.
 */
const ZONE_FRACTIONS: Record<TaskStatus, ZoneFractions> = {
  pending: { x0: 0.02, y0: 0.86, x1: 0.98, y1: 0.94 },
  ready: { x0: 0.1, y0: 0.75, x1: 0.9, y1: 0.82 },
  running: { x0: 0.06, y0: 0.3, x1: 0.94, y1: 0.42 },
  auditing: { x0: 0.06, y0: 0.44, x1: 0.46, y1: 0.5 },
  fixing: { x0: 0.54, y0: 0.44, x1: 0.94, y1: 0.5 },
  merging: { x0: 0.06, y0: 0.52, x1: 0.46, y1: 0.58 },
  conflict: { x0: 0.54, y0: 0.52, x1: 0.94, y1: 0.58 },
  merged: { x0: 0.06, y0: 0.15, x1: 0.94, y1: 0.2 },
  failed: { x0: 0.06, y0: 0.62, x1: 0.46, y1: 0.7 },
  cancelled: { x0: 0.54, y0: 0.62, x1: 0.94, y1: 0.7 },
};

export function calmZone(status: TaskStatus, width: number, height: number): Zone {
  const f = ZONE_FRACTIONS[status];
  return { x0: f.x0 * width, y0: f.y0 * height, x1: f.x1 * width, y1: f.y1 * height };
}
