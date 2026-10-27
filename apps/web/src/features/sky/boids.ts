/**
 * Boids maths for one flock. Pure functions over pre-allocated `Float32Array`s: no DOM, no
 * allocation in the hot loop, deterministic for a given buffer state and `dt`.
 *
 * A flock is ~12 birds that flock with each other (separation, alignment, cohesion) while being
 * pulled toward `leader + formationOffset`, where the formation is chosen by the behaviour table.
 */
import type { Behaviour, BehaviourKind } from './behaviour';
import { STATIC_KINDS } from './behaviour';

export const TAU = Math.PI * 2;

/** Scratch for formation offsets, reused by every bird in every step. */
export const FORMATION_SCRATCH = new Float32Array(2);

export interface BoidBuffers {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Per-bird phase offset in turns, seeded once at spawn. */
  phase: Float32Array;
}

export interface BoidFlock {
  birds: number;
  birdOffset: number;
  leaderX: number;
  leaderY: number;
  phase: number;
  statusTime: number;
  activity: number;
  behaviour: Behaviour;
  scatterAngle: number;
}

const SEPARATION_RADIUS = 17;
const SEPARATION_RADIUS_SQ = SEPARATION_RADIUS * SEPARATION_RADIUS;

/**
 * Per-bird offset from the leader. Writes `out[0]` (x) and `out[1]` (y) — allocation free.
 *
 * The formations are intentionally distinct per state: a perch row for `perched`/`wirePerch`, a
 * rotating ring for the `murmur`, a tight ring for `circle`, a line for `zigzag`, a V for `glide`
 * and `migrate`, two blinking sub-flocks for `flicker`, an expanding spiral for `fade`.
 */
export function formation(
  kind: BehaviourKind,
  flock: BoidFlock,
  j: number,
  time: number,
  out: Float32Array,
): void {
  const n = flock.birds;
  const spread = flock.behaviour.spread;
  const centre = (n - 1) / 2;
  switch (kind) {
    case 'perched':
    case 'hopping': {
      const col = j % 6;
      const row = Math.floor(j / 6);
      out[0] = (col - 2.5) * 7.4 * spread;
      out[1] = -row * 4.6;
      return;
    }
    case 'wirePerch': {
      out[0] = (j - centre) * 6.2;
      out[1] = 0;
      return;
    }
    case 'fall': {
      out[0] = (j - centre) * 3.2;
      out[1] = (j % 3) * 2.2;
      return;
    }
    case 'murmur': {
      const ang = (j / n) * TAU + time * 0.7 + flock.phase;
      const r = (12 + 9 * Math.sin(time * 0.9 + j * 1.3)) * (0.8 + 0.4 * spread);
      out[0] = Math.cos(ang) * r;
      out[1] = Math.sin(ang) * r * 0.55;
      return;
    }
    case 'circle': {
      const ang = (j / n) * TAU - time * 1.9;
      const r = 8 + j * 0.55;
      out[0] = Math.cos(ang) * r;
      out[1] = Math.sin(ang) * r;
      return;
    }
    case 'zigzag': {
      out[0] = (j - centre) * 4.6;
      out[1] = Math.sin(time * 7 + j * 0.9) * 6.5;
      return;
    }
    case 'glide':
    case 'migrate': {
      const d = j - centre;
      out[0] = d * (kind === 'glide' ? 5.2 : 4.2);
      out[1] = Math.abs(d) * (kind === 'glide' ? 3.4 : 2.6);
      return;
    }
    case 'flicker': {
      const side = j % 2 === 0 ? 1 : -1;
      const blink = Math.sin(time * 9) >= 0 ? 1 : -1;
      out[0] = side * 20 * blink + (j % 3) * 2;
      out[1] = Math.sin(j * 1.7) * 3;
      return;
    }
    case 'fade': {
      const ang = (j / n) * TAU + time * 0.4;
      const r = 9 + j * 1.3 + flock.statusTime * 4;
      out[0] = Math.cos(ang) * r;
      out[1] = Math.sin(ang) * r * 0.6;
      return;
    }
    case 'scatter': {
      const ang = flock.scatterAngle + j * 0.9;
      const r = 26 + j * 2.5;
      out[0] = Math.cos(ang) * r;
      out[1] = Math.sin(ang) * r * 0.6;
      return;
    }
    default: {
      out[0] = 0;
      out[1] = 0;
    }
  }
}

/** Birds sit exactly on their target: used by perched / hopping / wire-perched / falling flocks. */
export function placeStatic(
  buffers: BoidBuffers,
  flock: BoidFlock,
  kind: BehaviourKind,
  time: number,
  dt: number,
): void {
  const { x, y, vx, vy } = buffers;
  const n = flock.birds;
  const base = flock.birdOffset;
  const invDt = 1 / Math.max(dt, 1e-4);
  for (let j = 0; j < n; j++) {
    const i = base + j;
    formation(kind, flock, j, time, FORMATION_SCRATCH);
    const bob =
      kind === 'wirePerch'
        ? Math.sin(time * 1.6 + (flock.phase + j) * 0.9) * 1.1
        : kind === 'hopping'
          ? -Math.abs(Math.sin(time * 5.5 + j * 0.8 + flock.phase)) * 4.5
          : Math.sin(time * 1.1 + j * 0.7 + flock.phase) * 0.7;
    const nx = flock.leaderX + (FORMATION_SCRATCH[0] ?? 0);
    const ny = flock.leaderY + (FORMATION_SCRATCH[1] ?? 0) + bob;
    const oldX = x[i] ?? 0;
    const oldY = y[i] ?? 0;
    x[i] = nx;
    y[i] = ny;
    vx[i] = (nx - oldX) * invDt;
    vy[i] = (ny - oldY) * invDt;
  }
}

/**
 * One boids integration step for a flying flock. `dt` is clamped by the caller (≤ 50 ms).
 *
 * Separation, alignment and cohesion only look at the flock's own 11 flockmates (≈132 pairs for 12
 * birds), so the whole sky is O(tasks · birds²) with a tiny constant: 360 birds stay well inside
 * 60 fps and the 600-step budget in the tests.
 */
export function stepBoids(
  buffers: BoidBuffers,
  flock: BoidFlock,
  kind: BehaviourKind,
  time: number,
  dt: number,
  width: number,
  height: number,
): void {
  const { x, y, vx, vy } = buffers;
  const n = flock.birds;
  const base = flock.birdOffset;
  const statics = STATIC_KINDS.has(kind);
  if (statics) return;

  const speedCap =
    118 *
    (kind === 'migrate' ? 1.8 : 1) *
    (kind === 'murmur' ? 0.85 + flock.activity * 0.9 : 1) *
    (kind === 'scatter' ? 1.9 : 1) *
    Math.max(0.4, flock.behaviour.speed);
  const goalWeight = kind === 'murmur' ? 1.15 : kind === 'scatter' ? 0.4 : kind === 'fade' ? 0.7 : 3.1;
  const damping = Math.exp(-2.4 * dt);
  const margin = 6;

  for (let j = 0; j < n; j++) {
    const i = base + j;
    const px = x[i] ?? 0;
    const py = y[i] ?? 0;
    let pxv = vx[i] ?? 0;
    let pyv = vy[i] ?? 0;

    let sepX = 0;
    let sepY = 0;
    let aliX = 0;
    let aliY = 0;
    let cohX = 0;
    let cohY = 0;
    let mates = 0;

    for (let k = 0; k < n; k++) {
      if (k === j) continue;
      const m = base + k;
      const qx = x[m] ?? 0;
      const qy = y[m] ?? 0;
      const dx = px - qx;
      const dy = py - qy;
      const d2 = dx * dx + dy * dy;
      if (d2 < SEPARATION_RADIUS_SQ && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (1 - d / SEPARATION_RADIUS) / d;
        sepX += dx * push;
        sepY += dy * push;
      }
      aliX += vx[m] ?? 0;
      aliY += vy[m] ?? 0;
      cohX += qx;
      cohY += qy;
      mates++;
    }

    if (mates > 0) {
      aliX /= mates;
      aliY /= mates;
      cohX = cohX / mates - px;
      cohY = cohY / mates - py;
    }

    formation(kind, flock, j, time, FORMATION_SCRATCH);
    const goalX = flock.leaderX + (FORMATION_SCRATCH[0] ?? 0) - px;
    const goalY = flock.leaderY + (FORMATION_SCRATCH[1] ?? 0) - py;

    let fx = sepX * 26 + aliX * 1.6 + cohX * 0.35 + goalX * goalWeight;
    let fy = sepY * 26 + aliY * 1.6 + cohY * 0.35 + goalY * goalWeight;

    if (kind === 'scatter') {
      const ang = flock.scatterAngle + j * 0.7;
      fx += Math.cos(ang) * 95;
      fy += Math.sin(ang) * 72;
    }

    pxv = (pxv + fx * dt) * damping;
    pyv = (pyv + fy * dt) * damping;

    const speed = Math.sqrt(pxv * pxv + pyv * pyv);
    if (speed > speedCap) {
      pxv = (pxv / speed) * speedCap;
      pyv = (pyv / speed) * speedCap;
    }

    let nx = px + pxv * dt;
    let ny = py + pyv * dt;
    if (nx < margin) {
      nx = margin;
      pxv = Math.abs(pxv) * 0.4;
    } else if (nx > width - margin) {
      nx = width - margin;
      pxv = -Math.abs(pxv) * 0.4;
    }
    if (ny < margin) {
      ny = margin;
      pyv = Math.abs(pyv) * 0.4;
    } else if (ny > height - margin) {
      ny = height - margin;
      pyv = -Math.abs(pyv) * 0.4;
    }

    x[i] = nx;
    y[i] = ny;
    vx[i] = pxv;
    vy[i] = pyv;
  }
}
