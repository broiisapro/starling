/**
 * The Sky's work cues (Epic 47): tiny sparks for `file.edited`, a "beat" pulse for `tool.call`, and
 * the fading captions shown when a machine joins or leaves the flock.
 *
 * Everything here is a fixed-size pool over `Float32Array`s — no allocation in the hot loop and no
 * DOM — so the sim stays deterministic and the renderer can draw 60 fps without the GC joining in.
 */

/** Hard cap on live sparks. Four per edit event decays in under a second, so this is generous. */
export const MAX_SPARKS = 192;
export const SPARK_LIFE = 0.8;
/** How long a roost's join ripple runs, in seconds. */
export const RIPPLE_LIFE = 1.7;
/** How long a join/leave/finish caption stays on screen. */
export const NOTICE_LIFE = 3.8;
/** A `tool.call` beat decays over roughly this long. */
export const BEAT_DECAY = 6;

export interface SparkPool {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Remaining life in seconds; `<= 0` means the slot is free. */
  life: Float32Array;
  /** Next slot to overwrite — the pool is a ring buffer, so old sparks die gracefully. */
  head: number;
}

export function createSparkPool(): SparkPool {
  return {
    x: new Float32Array(MAX_SPARKS),
    y: new Float32Array(MAX_SPARKS),
    vx: new Float32Array(MAX_SPARKS),
    vy: new Float32Array(MAX_SPARKS),
    life: new Float32Array(MAX_SPARKS),
    head: 0,
  };
}

/**
 * Spawn `count` sparks at (x, y) with a deterministic fan. `rng` is the sim's seeded generator, so a
 * replayed cue burst is identical frame for frame.
 */
export function spawnSparks(pool: SparkPool, x: number, y: number, count: number, rng: () => number): void {
  for (let i = 0; i < count; i++) {
    const slot = pool.head;
    pool.head = (pool.head + 1) % MAX_SPARKS;
    const angle = rng() * Math.PI * 2;
    const speed = 18 + rng() * 46;
    pool.x[slot] = x + (rng() - 0.5) * 10;
    pool.y[slot] = y + (rng() - 0.5) * 6;
    pool.vx[slot] = Math.cos(angle) * speed;
    pool.vy[slot] = Math.sin(angle) * speed - 22;
    pool.life[slot] = SPARK_LIFE * (0.6 + rng() * 0.4);
  }
}

/** Advance every live spark: drift, a little gravity, and burn down its life. */
export function stepSparks(pool: SparkPool, dt: number): void {
  for (let i = 0; i < MAX_SPARKS; i++) {
    if ((pool.life[i] ?? 0) <= 0) continue;
    pool.life[i] = (pool.life[i] ?? 0) - dt;
    pool.x[i] = (pool.x[i] ?? 0) + (pool.vx[i] ?? 0) * dt;
    pool.y[i] = (pool.y[i] ?? 0) + (pool.vy[i] ?? 0) * dt;
    pool.vy[i] = (pool.vy[i] ?? 0) + 58 * dt;
  }
}

export function liveSparks(pool: SparkPool): number {
  let live = 0;
  for (let i = 0; i < MAX_SPARKS; i++) if ((pool.life[i] ?? 0) > 0) live++;
  return live;
}

export function resetSparks(pool: SparkPool): void {
  pool.life.fill(0);
  pool.head = 0;
}

// ── captions ────────────────────────────────────────────────────────────────────────────────────

export type NoticeKind = 'joined' | 'left' | 'finished';

/** A toast-like caption anchored to the sky (not to the roost), so it stays readable. */
export interface RoostNotice {
  /** Stable per event, so a replayed frame never doubles a caption. */
  id: string;
  nodeId: string;
  name: string;
  kind: NoticeKind;
  /** Sim time the caption appeared (already back-dated for replayed events). */
  born: number;
  life: number;
}

/** The caption copy. Kept here so the test and the renderer agree word for word. */
export function noticeText(notice: RoostNotice): string {
  if (notice.kind === 'joined') return `🪺 ${notice.name} joined the flock`;
  if (notice.kind === 'left') return `${notice.name} has flown away`;
  return notice.name;
}

/** 0 → 1 → 0 envelope for a notice, used by the renderer to fade the plate in and out. */
export function noticeAlpha(notice: RoostNotice, now: number): number {
  const age = now - notice.born;
  if (age < 0 || age > notice.life) return 0;
  const inT = Math.min(1, age / 0.22);
  const outT = Math.min(1, (notice.life - age) / 0.7);
  return Math.min(inT, outT);
}
