/**
 * A small, dependency-free boids simulation — the murmuration in the hero.
 *
 * Pure maths over pre-allocated `Float32Array`s: no DOM, no canvas, no allocation in the hot loop.
 * The renderer (`sky.ts`) owns drawing; this file owns where the birds are. Keeping them apart is
 * what lets the behaviour be unit-tested with plain `bun test`.
 *
 * Three local rules (separation, alignment, cohesion) plus a slowly drifting roost target and an
 * optional pointer to scatter from. That is enough for the flock to read as one organism.
 */

export interface Point {
  x: number;
  y: number;
}

export interface BoidsOptions {
  width: number;
  height: number;
  /** Defaults to a size-aware count: phone ~56 birds, desktop ~210. */
  count?: number;
  seed?: number;
}

export interface Flock {
  width: number;
  height: number;
  count: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Per-bird phase, so the flock never moves in lockstep. */
  phase: Float32Array;
  time: number;
}

export interface StepOptions {
  /** The drifting centre of the flock, in canvas pixels. Defaults to the middle. */
  focus?: Point | null;
  /** Cursor position; birds inside the radius scatter away from it. */
  pointer?: Point | null;
}

export const MIN_SPEED = 26;
export const MAX_SPEED = 135;
export const MAX_FORCE = 190;
const NEIGHBOUR_RADIUS = 52;
const NEIGHBOUR_SQ = NEIGHBOUR_RADIUS * NEIGHBOUR_RADIUS;
const SEPARATION_RADIUS = 14;
const SEPARATION_SQ = SEPARATION_RADIUS * SEPARATION_RADIUS;
const POINTER_RADIUS = 120;
const POINTER_SQ = POINTER_RADIUS * POINTER_RADIUS;
const EDGE_MARGIN = 72;
const TAU = Math.PI * 2;

/** mulberry32: tiny, fast, deterministic. A fixed seed gives the same opening frame every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Enough birds to fill the frame on any screen, few enough to stay smooth on a phone. */
export function defaultCount(width: number, height: number): number {
  const area = Math.max(1, width) * Math.max(1, height);
  return Math.round(Math.min(210, Math.max(56, area / 5600)));
}

export function createFlock(options: BoidsOptions): Flock {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const count = Math.max(1, options.count ?? defaultCount(width, height));
  const random = mulberry32(options.seed ?? 0x5eed);

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const phase = new Float32Array(count);

  // Start in a loose ellipse around the middle. A murmuration, not a square grid.
  for (let i = 0; i < count; i += 1) {
    const angle = random() * TAU;
    const radius = Math.sqrt(random()) * Math.min(width, height) * 0.16;
    x[i] = width / 2 + Math.cos(angle) * radius * 1.3;
    y[i] = height / 2 + Math.sin(angle) * radius * 0.8;
    const heading = angle + Math.PI / 2 + (random() - 0.5) * 0.9;
    const speed = MIN_SPEED + random() * (MAX_SPEED - MIN_SPEED) * 0.55;
    vx[i] = Math.cos(heading) * speed;
    vy[i] = Math.sin(heading) * speed;
    phase[i] = random() * TAU;
  }

  return { width, height, count, x, y, vx, vy, phase, time: 0 };
}

function limit(x: number, y: number, max: number): [number, number] {
  const lengthSq = x * x + y * y;
  if (lengthSq <= max * max || lengthSq === 0) return [x, y];
  const scale = max / Math.sqrt(lengthSq);
  return [x * scale, y * scale];
}

/**
 * Advance the flock by `dt` seconds (clamped to 30 fps worth, so a stalled tab cannot explode it).
 * Mutates the buffers in place.
 */
export function stepFlock(flock: Flock, dt: number, options: StepOptions = {}): void {
  const step = Math.min(Math.max(dt, 0), 1 / 30);
  if (step === 0) return;

  flock.time += step;
  const t = flock.time;
  const { count, x, y, vx, vy, phase, width, height } = flock;

  const focus = options.focus ?? { x: width / 2, y: height * 0.46 };
  const reach = Math.min(width, height);
  // A roost that wanders in a slow, small Lissajous: the flock chases it, so the group flows
  // around the frame instead of freezing into a ball.
  const targetX = focus.x + Math.cos(t * 0.37) * reach * 0.075;
  const targetY = focus.y + Math.sin(t * 0.29) * reach * 0.05;
  const pointer = options.pointer ?? null;

  for (let i = 0; i < count; i += 1) {
    const px = x[i] as number;
    const py = y[i] as number;
    const pvx = vx[i] as number;
    const pvy = vy[i] as number;

    let separationX = 0;
    let separationY = 0;
    let separationCount = 0;
    let neighbourVx = 0;
    let neighbourVy = 0;
    let neighbourX = 0;
    let neighbourY = 0;
    let neighbourCount = 0;

    for (let j = 0; j < count; j += 1) {
      if (j === i) continue;
      const dx = (x[j] as number) - px;
      const dy = (y[j] as number) - py;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < 0.0001) continue;

      if (distanceSq < SEPARATION_SQ) {
        const weight = 1 - distanceSq / SEPARATION_SQ;
        separationX -= dx * weight;
        separationY -= dy * weight;
        separationCount += 1;
      }
      if (distanceSq < NEIGHBOUR_SQ) {
        neighbourVx += vx[j] as number;
        neighbourVy += vy[j] as number;
        neighbourX += x[j] as number;
        neighbourY += y[j] as number;
        neighbourCount += 1;
      }
    }

    let ax = 0;
    let ay = 0;

    // 1. Separation — the only rule that must be strict; it is what makes a flock look alive.
    if (separationCount > 0) {
      const [sx, sy] = limit(separationX, separationY, MAX_FORCE);
      ax += sx * 1.35;
      ay += sy * 1.35;
    }

    // 2. Alignment — match the average heading of the neighbours.
    if (neighbourCount > 0) {
      const avgVx = neighbourVx / neighbourCount;
      const avgVy = neighbourVy / neighbourCount;
      const avgSpeed = Math.hypot(avgVx, avgVy) || 1;
      const desiredX = (avgVx / avgSpeed) * MAX_SPEED;
      const desiredY = (avgVy / avgSpeed) * MAX_SPEED;
      const [steerX, steerY] = limit(desiredX - pvx, desiredY - pvy, MAX_FORCE);
      ax += steerX * 0.85;
      ay += steerY * 0.85;

      // 3. Cohesion — drift toward the middle of the neighbours.
      const centreX = neighbourX / neighbourCount;
      const centreY = neighbourY / neighbourCount;
      const [cohX, cohY] = limit(centreX - px, centreY - py, MAX_FORCE);
      ax += cohX * 0.75;
      ay += cohY * 0.75;
    }

    // 4. Seek a personal roost slot on a slowly turning ellipse. Each bird wants its own patch of
    // sky, so the flock spreads into a ribbon instead of collapsing into a knot — and because the
    // ellipse turns, the whole ribbon flows.
    const birdPhase = phase[i] as number;
    const slotAngle = birdPhase + t * 0.4;
    const slotRadius = 48 + ((i * 73) % 118);
    const slotX = targetX + Math.cos(slotAngle) * slotRadius * 1.5;
    const slotY = targetY + Math.sin(slotAngle) * slotRadius * 0.58;
    const toSlotX = slotX - px;
    const toSlotY = slotY - py;
    const slotDistance = Math.hypot(toSlotX, toSlotY) || 1;
    const [seekX, seekY] = limit(
      (toSlotX / slotDistance) * MAX_SPEED - pvx,
      (toSlotY / slotDistance) * MAX_SPEED - pvy,
      MAX_FORCE,
    );
    ax += seekX * 0.62;
    ay += seekY * 0.62;

    // 5. Weather — a slow shared drift and a little per-bird flutter, so the flock is never tidy.
    ax += Math.sin(t * 0.19) * 7 + Math.sin(t * 2.7 + birdPhase * 5) * 3;
    ay += Math.cos(t * 0.23) * 5 + Math.cos(t * 3.1 + birdPhase * 4) * 2.5;

    // 6. Pointer — scatter away from the cursor, quadratically so the middle clears first.
    if (pointer !== null) {
      const awayX = px - pointer.x;
      const awayY = py - pointer.y;
      const distanceSq = awayX * awayX + awayY * awayY;
      if (distanceSq < POINTER_SQ && distanceSq > 1) {
        const distance = Math.sqrt(distanceSq);
        const weight = 1 - distance / POINTER_RADIUS;
        ax += (awayX / distance) * MAX_FORCE * 1.5 * weight * weight;
        ay += (awayY / distance) * MAX_FORCE * 1.5 * weight * weight;
      }
    }

    // 7. Soft edges. Never wrap: a bird that teleports reads as a glitch, not a murmuration.
    if (px < EDGE_MARGIN) ax += (1 - px / EDGE_MARGIN) * 280;
    if (px > width - EDGE_MARGIN) ax -= (1 - (width - px) / EDGE_MARGIN) * 280;
    if (py < EDGE_MARGIN) ay += (1 - py / EDGE_MARGIN) * 280;
    if (py > height - EDGE_MARGIN) ay -= (1 - (height - py) / EDGE_MARGIN) * 280;

    const [forceX, forceY] = limit(ax, ay, MAX_FORCE * 2.2);
    let nextVx = pvx + forceX * step;
    let nextVy = pvy + forceY * step;

    const speed = Math.hypot(nextVx, nextVy);
    if (speed > MAX_SPEED) {
      nextVx = (nextVx / speed) * MAX_SPEED;
      nextVy = (nextVy / speed) * MAX_SPEED;
    } else if (speed < MIN_SPEED) {
      if (speed === 0) {
        nextVx = MIN_SPEED;
        nextVy = 0;
      } else {
        nextVx = (nextVx / speed) * MIN_SPEED;
        nextVy = (nextVy / speed) * MIN_SPEED;
      }
    }

    // Hard rails just outside the canvas: a stray bird would be a visual bug, not a metaphor.
    const nextX = px + nextVx * step;
    const nextY = py + nextVy * step;
    vx[i] = nextVx;
    vy[i] = nextVy;
    x[i] = Math.min(width + 24, Math.max(-24, nextX));
    y[i] = Math.min(height + 24, Math.max(-24, nextY));
  }
}

/** Mean position — handy for framing the flock and for tests. */
export function averagePosition(flock: Flock): Point {
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < flock.count; i += 1) {
    sumX += flock.x[i] as number;
    sumY += flock.y[i] as number;
  }
  return { x: sumX / flock.count, y: sumY / flock.count };
}
