/**
 * The Sky's simulation: every task is a flock of ~12 birds, every machine is a roost, `main` is the
 * wire. Pure TypeScript — no DOM, no React, no timers — so it is deterministic, testable and cheap
 * enough to drive 30 tasks / 360 birds at 60 fps.
 *
 * Inputs are the same props the panel gets (`Run`, `NodeInfo[]`, recent `StarlingEvent[]`). The sim
 * diffs them: status changes pick a behaviour from `behaviour.ts`, `nodeId` changes and
 * `task.migrated` events start a long arc between roosts, `node.joined` grows a roost in, and
 * `node.left` dims it and scatters its birds.
 */
import type { NodeInfo, Plan, Run, StarlingEvent, TaskRun, TaskStatus } from '@starling/core';
import {
  type Behaviour,
  type BehaviourKind,
  behaviourFor,
  migrateBehaviour,
  scatterBehaviour,
} from './behaviour';
import { type BoidBuffers, type BoidFlock, placeStatic, stepBoids, TAU } from './boids';
import { applyCalmLayout } from './calm';
import {
  BEAT_DECAY,
  createSparkPool,
  NOTICE_LIFE,
  RIPPLE_LIFE,
  type RoostNotice,
  type SparkPool,
  spawnSparks,
  stepSparks,
} from './cues';
import {
  layoutRoosts,
  makeWire,
  type Roost,
  roostPerchOffset,
  roostPerchRow,
  type Wire,
  wireSlotX,
} from './layout';
import { TASK_STATUSES } from './palette';

export const BIRDS_PER_FLOCK = 12;
export const MAX_TASKS = 30;
export const MAX_BIRDS = BIRDS_PER_FLOCK * MAX_TASKS;
export const TRAIL_CAP = 48;
/** Agent events this close to "now" make a flock fly harder. */
export const ACTIVITY_WINDOW_MS = 10_000;
/** The final "all landed" wave that runs across the wire once the run finishes. */
export const SWEEP_DURATION = 3.2;
/** How long the bright landing shimmer lasts after a flock reaches the wire. */
export const LANDING_SHIMMER = 1.5;
/** Sparks per `file.edited`. */
export const SPARKS_PER_EDIT = 4;

const MIGRATE = migrateBehaviour();
const SCATTER = scatterBehaviour();

/**
 * Before the first `node.joined` arrives (frame 0 of a replay, or the very start of a live run)
 * there is no node list yet. The Sky still needs a branch for pending birds, and the hub is the
 * only machine that is guaranteed to exist, so we lay out a placeholder roost that the real
 * `hub` node replaces — and grows in — a second later.
 */
const PLACEHOLDER_HUB: NodeInfo = {
  id: 'hub',
  name: 'hub',
  kind: 'local',
  platform: '',
  arch: '',
  cpuCores: 0,
  memGb: 0,
  maxSessions: 1,
  activeSessions: 0,
  localModels: [],
  status: 'online',
  lastSeen: 0,
};

export interface Migration {
  fromNodeId: string;
  toNodeId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  duration: number;
}

export interface Flock extends BoidFlock {
  taskKey: string;
  title: string;
  status: TaskStatus;
  nodeId: string;
  attempts: number;
  alpha: number;
  leaderVx: number;
  leaderVy: number;
  /** Position when the current status began (glide/flicker/fade start from here). */
  enterX: number;
  enterY: number;
  /** Wire slot in merge order, or -1. Assigned when the flock starts merging. */
  mergedSlot: number;
  /** 1-based landing order, or 0 while the flock has not landed yet. */
  landedSeq: number;
  roostSlot: number;
  roostCount: number;
  orbit: number;
  migration: Migration | null;
  scatterUntil: number;
  scatterAngle: number;
  /** A `tool.call` pulse: 1 on the event, decays to 0. Drives the beat ring. */
  beat: number;
  /** Leader breadcrumbs for the migration trail (x, y pairs). */
  trail: Float32Array;
  trailLen: number;
  trailDrain: number;
}

export interface SkyInput {
  /** Changing the run id resets all flocks (used when the Playground loads a new run). */
  runId?: string;
  plan?: Plan;
  tasks?: Record<string, TaskRun>;
  nodes: readonly NodeInfo[];
  recent?: readonly StarlingEvent[];
  /** Run status, so the sim can fire the final "all landed" sweep exactly once. */
  status?: Run['status'];
  /** Wall-clock time of this input in epoch ms. Defaults to the newest event's ts. */
  now?: number;
}

/** Sound cues the sim produced since the last drain (the SkyView feeds them to WebAudio). */
export interface AudioCues {
  landings: number;
  migrations: number;
  joins: number;
  leaves: number;
}

export interface SkySimOptions {
  width: number;
  height: number;
  seed?: number;
  reducedMotion?: boolean;
}

/** Deterministic 32-bit RNG (mulberry32). Only used at spawn time, so settlements are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a string into a stable 32-bit seed, so `seed="sky-todo"` works as well as a number. */
export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function latestTs(events: readonly StarlingEvent[] | undefined): number | undefined {
  if (!events || events.length === 0) return undefined;
  let max = events[0]?.ts ?? 0;
  for (const e of events) if (e.ts > max) max = e.ts;
  return max;
}

export class SkySimulation {
  width: number;
  height: number;
  wire: Wire;
  readonly birds: BoidBuffers;
  readonly sparks: SparkPool;
  readonly seed: number;

  flocks: Flock[] = [];
  roosts: Roost[] = [];
  /** Toast-like captions (join / leave / all-landed), oldest first. */
  notices: RoostNotice[] = [];
  simTime = 0;
  reducedMotion: boolean;
  /** -1 when idle; otherwise seconds into the final all-landed sweep. */
  sweepT = -1;

  private rng: () => number;
  private runId: string | undefined;
  private nodes: readonly NodeInfo[] = [];
  private mergedCounter = 0;
  private landedCounter = 0;
  private pendingCues: AudioCues = { landings: 0, migrations: 0, joins: 0, leaves: 0 };
  private sweepSeen = false;
  private baseNow = 0;
  private baseTime = 0;
  private eventTs = new Map<string, number[]>();
  private lastMigrationTs = new Map<string, number>();
  private lastCueTs = new Map<string, number>();
  private lastNoticeTs = new Map<string, number>();
  private tx = 0;
  private ty = 0;

  constructor(opts: SkySimOptions) {
    this.width = Math.max(320, opts.width);
    this.height = Math.max(220, opts.height);
    this.seed = hashSeed(opts.seed ?? 0x5eed);
    this.rng = mulberry32(this.seed);
    this.reducedMotion = opts.reducedMotion ?? false;
    this.wire = makeWire(this.width, this.height);
    this.sparks = createSparkPool();
    this.birds = {
      x: new Float32Array(MAX_BIRDS),
      y: new Float32Array(MAX_BIRDS),
      vx: new Float32Array(MAX_BIRDS),
      vy: new Float32Array(MAX_BIRDS),
      phase: new Float32Array(MAX_BIRDS),
    };
  }

  // ── inputs ─────────────────────────────────────────────────────────────────────────────────────
  setInput(input: SkyInput): void {
    if (input.runId !== undefined && this.runId !== undefined && input.runId !== this.runId) {
      this.resetFlocks();
    }
    if (input.runId !== undefined) this.runId = input.runId;

    const now = input.now ?? latestTs(input.recent) ?? this.baseNow;
    this.baseNow = now;
    this.baseTime = this.simTime;

    this.nodes = input.nodes;
    this.syncRoosts(input.nodes);
    this.collectEvents(input.recent ?? []);
    this.syncFlocks(input.plan, input.tasks);
    this.collectCues(input.recent ?? []);
    this.assignRoostSlots();
    if (input.status === 'finished' && !this.sweepSeen) {
      this.sweepSeen = true;
      this.startSweep();
    }
    if (this.reducedMotion) this.layoutCalm();
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = Math.max(320, width);
    this.height = Math.max(220, height);
    this.wire = makeWire(this.width, this.height);
    const previous = new Map(this.roosts.map((r) => [r.nodeId, r]));
    this.roosts = layoutRoosts(this.nodes, this.width, this.height).map((r) => {
      const old = previous.get(r.nodeId);
      if (old) {
        r.grow = old.grow;
        r.dim = old.dim;
        r.busy = old.busy;
        r.ripple = old.ripple;
        r.left = old.left;
      }
      return r;
    });
    for (let i = 0; i < MAX_BIRDS; i++) {
      this.birds.x[i] = Math.min(this.width - 6, Math.max(6, this.birds.x[i] ?? 0));
      this.birds.y[i] = Math.min(this.height - 6, Math.max(6, this.birds.y[i] ?? 0));
    }
    if (this.reducedMotion) this.layoutCalm();
  }

  setReducedMotion(on: boolean): void {
    if (this.reducedMotion === on) return;
    this.reducedMotion = on;
    if (on) this.layoutCalm();
  }

  // ── stepping ──────────────────────────────────────────────────────────────────────────────────
  step(dt: number): void {
    const d = Math.min(Math.max(dt, 0), 0.05);
    this.simTime += d;
    this.advanceSweep(d);
    this.animateRoosts(d);
    if (this.reducedMotion) return;
    stepSparks(this.sparks, d);
    for (const flock of this.flocks) this.stepFlock(flock, d);
  }

  // ── queries ───────────────────────────────────────────────────────────────────────────────────
  findFlock(taskKey: string): Flock | undefined {
    return this.flocks.find((f) => f.taskKey === taskKey);
  }

  /** Cues produced since the last call (the SkyView drains these every frame and clears them). */
  drainAudioCues(): AudioCues {
    const out = { ...this.pendingCues };
    this.pendingCues.landings = 0;
    this.pendingCues.migrations = 0;
    this.pendingCues.joins = 0;
    this.pendingCues.leaves = 0;
    return out;
  }

  /** How much of the flock is actually working — the low hum's volume. */
  workingFraction(): number {
    let active = 0;
    for (const flock of this.flocks) {
      if (flock.status === 'running' || flock.status === 'auditing' || flock.status === 'fixing') active++;
    }
    return Math.min(1, active / 8);
  }

  /** Nearest flock leader within `radius` CSS pixels — the click/hover target. */
  hitTest(x: number, y: number, radius = 46): string | undefined {
    let best: Flock | undefined;
    let bestDist = radius * radius;
    for (const f of this.flocks) {
      const dx = f.leaderX - x;
      const dy = f.leaderY - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = f;
      }
    }
    return best?.taskKey;
  }

  countsByStatus(): Record<TaskStatus, number> {
    const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const f of this.flocks) counts[f.status] += 1;
    return counts;
  }

  /** Wall clock extrapolated from the last input, so activity decays between prop updates. */
  wallNow(): number {
    return this.baseNow + (this.simTime - this.baseTime) * 1000;
  }

  // ── input diffing ─────────────────────────────────────────────────────────────────────────────
  private resetFlocks(): void {
    this.flocks = [];
    this.notices = [];
    this.mergedCounter = 0;
    this.landedCounter = 0;
    this.sweepT = -1;
    this.sweepSeen = false;
    this.pendingCues = { landings: 0, migrations: 0, joins: 0, leaves: 0 };
    this.eventTs.clear();
    this.lastMigrationTs.clear();
    this.lastCueTs.clear();
    this.lastNoticeTs.clear();
    this.sparks.life.fill(0);
    this.sparks.head = 0;
  }

  private syncRoosts(nodes: readonly NodeInfo[]): void {
    const layoutNodes = nodes.length === 0 ? [PLACEHOLDER_HUB] : nodes;
    const previous = new Map(this.roosts.map((r) => [r.nodeId, r]));
    const wasDim = new Map<string, number>();
    const seen = new Set<string>();
    const next: Roost[] = [];

    for (const r of layoutRoosts(layoutNodes, this.width, this.height)) {
      const old = previous.get(r.nodeId);
      if (old) {
        r.grow = old.grow;
        r.dim = old.dim;
        r.busy = old.busy;
        r.ripple = old.ripple;
        r.left = old.left;
        wasDim.set(r.nodeId, old.dimTarget);
      } else {
        r.grow = 0;
        wasDim.set(r.nodeId, 1);
      }
      seen.add(r.nodeId);
      next.push(r);
    }
    // Nodes that vanished from the list keep a dimmed roost so the scatter and the caption are visible.
    for (const old of this.roosts) {
      if (seen.has(old.nodeId)) continue;
      wasDim.set(old.nodeId, old.dimTarget);
      old.dimTarget = 0.25;
      if (old.left < 0) old.left = 0;
      next.push(old);
    }

    for (const r of next) {
      const node = layoutNodes.find((n) => n.id === r.nodeId);
      const active = node !== undefined && node.status !== 'offline';
      const was = wasDim.get(r.nodeId) ?? 1;
      if (was > 0.5 && !active) {
        this.scatterFlocksOn(r.nodeId);
        if (r.left < 0) r.left = 0;
      }
      if (was <= 0.5 && active) r.grow = 0;
      r.dimTarget = active ? 1 : 0.25;
      if (node) {
        r.name = node.name;
        r.kind = node.kind;
        r.activeSessions = node.activeSessions;
        r.maxSessions = node.maxSessions;
        if (node.kind === 'local' && node.id === 'hub') r.isHub = true;
      }
    }
    this.roosts = next;
  }

  private scatterFlocksOn(nodeId: string): void {
    for (const f of this.flocks) {
      if (f.nodeId !== nodeId) continue;
      f.scatterUntil = this.simTime + 1.5;
      f.scatterAngle = f.phase * TAU;
    }
  }

  private collectEvents(recent: readonly StarlingEvent[]): void {
    for (const e of recent) {
      if (e.type === 'agent.event') {
        const key = e.payload.taskKey;
        const list = this.eventTs.get(key) ?? [];
        if (list.length === 0 || (list[list.length - 1] ?? 0) !== e.ts) list.push(e.ts);
        if (list.length > 120) list.splice(0, list.length - 120);
        this.eventTs.set(key, list);
      } else if (e.type === 'task.migrated') {
        const { taskKey, fromNode, toNode } = e.payload;
        const last = this.lastMigrationTs.get(taskKey) ?? Number.NEGATIVE_INFINITY;
        if (e.ts > last) {
          this.lastMigrationTs.set(taskKey, e.ts);
          const flock = this.findFlock(taskKey);
          if (flock) this.startMigration(flock, fromNode, toNode);
          this.pendingCues.migrations += 1;
        }
      } else if (e.type === 'node.joined' || e.type === 'node.left') {
        this.collectNodeEvent(e);
      }
    }
  }

  /**
   * Join/leave captions and roost ripples. Events are deduplicated by timestamp and **back-dated**
   * to their wall time, so a replay frame that lands nine seconds after the join shows a settled
   * roost, not a fresh toast.
   */
  private collectNodeEvent(e: Extract<StarlingEvent, { type: 'node.joined' | 'node.left' }>): void {
    const nodeId = e.type === 'node.joined' ? e.payload.node.id : e.payload.nodeId;
    const name =
      e.type === 'node.joined'
        ? e.payload.node.name
        : (this.roosts.find((r) => r.nodeId === nodeId)?.name ?? nodeId);
    const id = `${e.type}:${nodeId}`;
    const last = this.lastNoticeTs.get(id) ?? Number.NEGATIVE_INFINITY;
    if (e.ts <= last) return;
    this.lastNoticeTs.set(id, e.ts);
    const age = Math.max(0, (this.baseNow - e.ts) / 1000);
    const roost = this.roosts.find((r) => r.nodeId === nodeId);
    if (e.type === 'node.joined') {
      if (roost) {
        roost.ripple = age;
        roost.left = -1;
      }
      this.pendingCues.joins += 1;
      this.notices.push({ id, nodeId, name, kind: 'joined', born: this.simTime - age, life: NOTICE_LIFE });
    } else {
      if (roost) roost.left = age;
      this.pendingCues.leaves += 1;
      this.notices.push({ id, nodeId, name, kind: 'left', born: this.simTime - age, life: NOTICE_LIFE });
    }
  }

  /**
   * Work cues: a `file.edited` throws sparks at the flock, a `tool.call` makes it beat. Runs after
   * `syncFlocks`, so a cue that arrives with the very first input still lands on a real flock.
   */
  private collectCues(recent: readonly StarlingEvent[]): void {
    for (const e of recent) {
      if (e.type !== 'agent.event') continue;
      const key = e.payload.taskKey;
      const last = this.lastCueTs.get(key) ?? Number.NEGATIVE_INFINITY;
      if (e.ts <= last) continue;
      this.lastCueTs.set(key, e.ts);
      const flock = this.findFlock(key);
      if (!flock) continue;
      if (e.payload.kind === 'file.edited') {
        spawnSparks(this.sparks, flock.leaderX, flock.leaderY, SPARKS_PER_EDIT, this.rng);
      } else if (e.payload.kind === 'tool.call') {
        flock.beat = 1;
      }
    }
  }

  private syncFlocks(plan: Plan | undefined, tasks: Record<string, TaskRun> | undefined): void {
    const order: string[] = [];
    const titles = new Map<string, string>();
    if (plan) {
      for (const task of plan.tasks) {
        order.push(task.key);
        titles.set(task.key, task.title);
      }
    }
    const runs = tasks ?? {};
    for (const key of Object.keys(runs)) {
      if (titles.has(key)) continue;
      order.push(key);
      titles.set(key, key);
    }

    const existing = new Map(this.flocks.map((f) => [f.taskKey, f]));
    const next: Flock[] = [];
    for (const key of order.slice(0, MAX_TASKS)) {
      const run = runs[key];
      const status: TaskStatus = run?.status ?? 'pending';
      const nodeId = run?.nodeId || this.defaultNodeId();
      const attempts = run?.attempts ?? 0;
      let flock = existing.get(key);
      if (!flock) {
        flock = this.createFlock(key, titles.get(key) ?? key, status, nodeId, this.freeOffset(next));
      }
      flock.title = titles.get(key) ?? key;
      flock.attempts = attempts;
      if (flock.nodeId && flock.nodeId !== nodeId) this.startMigration(flock, flock.nodeId, nodeId);
      flock.nodeId = nodeId;
      this.applyStatus(flock, status);
      flock.activity = this.activityFor(key);
      next.push(flock);
    }
    this.flocks = next;
  }

  private defaultNodeId(): string {
    return this.roosts.find((r) => r.kind === 'local')?.nodeId ?? this.roosts[0]?.nodeId ?? 'hub';
  }

  private freeOffset(inProgress: readonly Flock[]): number {
    const used = new Set([...this.flocks, ...inProgress].map((f) => f.birdOffset));
    for (let i = 0; i < MAX_TASKS; i++) {
      const offset = i * BIRDS_PER_FLOCK;
      if (!used.has(offset)) return offset;
    }
    return 0;
  }

  private createFlock(
    taskKey: string,
    title: string,
    status: TaskStatus,
    nodeId: string,
    birdOffset: number,
  ): Flock {
    const roost = this.roostFor(nodeId) ?? this.roosts[0];
    const rx = roost?.x ?? this.width / 2;
    const ry = (roost?.y ?? this.height - 26) - 8;
    const flock: Flock = {
      taskKey,
      title,
      status,
      nodeId,
      attempts: 0,
      birds: BIRDS_PER_FLOCK,
      birdOffset,
      behaviour: behaviourFor(status),
      activity: 0,
      alpha: 1,
      leaderX: rx,
      leaderY: ry,
      leaderVx: 0,
      leaderVy: 0,
      phase: this.rng(),
      statusTime: 0,
      enterX: rx,
      enterY: ry,
      mergedSlot: -1,
      landedSeq: 0,
      roostSlot: 0,
      roostCount: 1,
      orbit: this.rng() * TAU,
      migration: null,
      scatterUntil: 0,
      scatterAngle: 0,
      beat: 0,
      trail: new Float32Array(TRAIL_CAP * 2),
      trailLen: 0,
      trailDrain: 0,
    };
    for (let j = 0; j < BIRDS_PER_FLOCK; j++) {
      const i = birdOffset + j;
      this.birds.x[i] = rx + (this.rng() - 0.5) * 44;
      this.birds.y[i] = ry + (this.rng() - 0.5) * 18;
      this.birds.vx[i] = 0;
      this.birds.vy[i] = 0;
      this.birds.phase[i] = this.rng();
    }
    return flock;
  }

  private applyStatus(flock: Flock, status: TaskStatus): void {
    // Slots are assigned even when a flock is born mid-merge (a live reconnect, or a scrubbed
    // fixture frame), so the glide always has a wire to aim at.
    if ((status === 'merging' || status === 'merged') && flock.mergedSlot < 0) {
      flock.mergedSlot = this.mergedCounter++;
    }
    if (flock.status === status) return;
    const landed = status === 'merged' && flock.status !== 'merged';
    flock.status = status;
    flock.statusTime = 0;
    flock.behaviour = behaviourFor(status);
    flock.enterX = flock.leaderX;
    flock.enterY = flock.leaderY;
    if (landed) {
      // Landing order is merge order: a flock born already merged on a reconnect does not chime.
      flock.landedSeq = ++this.landedCounter;
      this.pendingCues.landings += 1;
    }
  }

  private assignRoostSlots(): void {
    const groups = new Map<string, Flock[]>();
    for (const flock of this.flocks) {
      const list = groups.get(flock.nodeId) ?? [];
      list.push(flock);
      groups.set(flock.nodeId, list);
    }
    for (const list of groups.values()) {
      list.forEach((flock, i) => {
        flock.roostSlot = i;
        flock.roostCount = list.length;
      });
    }
    this.flocks.forEach((flock, i) => {
      if (flock.orbit === 0) flock.orbit = i * 1.37 + 1;
    });
  }

  /**
   * How many wire slots are in use: the flocks that have landed (or are gliding in). Spacing the
   * wire by this, not by every task in the plan, keeps the merge order legible and gives each
   * landed task key room for its label — the wire reads as a queue filling up.
   */
  private wireSlots(): number {
    let slots = 0;
    for (const flock of this.flocks) {
      if (flock.status === 'merged' || flock.status === 'merging') slots++;
    }
    return Math.max(1, slots);
  }

  private startMigration(flock: Flock, fromNodeId: string, toNodeId: string): void {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
    if (flock.migration && flock.migration.toNodeId === toNodeId) return;
    const target = this.roostFor(toNodeId);
    flock.migration = {
      fromNodeId,
      toNodeId,
      fromX: flock.leaderX,
      fromY: flock.leaderY,
      toX: target?.x ?? this.width / 2,
      // End the arc in the destination roost's working band, so the flock reforms where it will work.
      toY: (target?.y ?? this.height - 26) - this.height * 0.3,
      t: 0,
      duration: 3.4,
    };
    flock.trailLen = 0;
  }

  private roostFor(nodeId: string | undefined): Roost | undefined {
    if (!nodeId) return this.roosts[0];
    return this.roosts.find((r) => r.nodeId === nodeId) ?? this.roosts[0];
  }

  private activityFor(taskKey: string): number {
    const list = this.eventTs.get(taskKey);
    if (!list) return 0;
    const cutoff = this.wallNow() - ACTIVITY_WINDOW_MS;
    let count = 0;
    for (const ts of list) if (ts >= cutoff) count++;
    return Math.min(1, count / 10);
  }

  private animateRoosts(dt: number): void {
    for (const r of this.roosts) {
      r.grow = Math.min(1, r.grow + dt / 1.2);
      r.dim += (r.dimTarget - r.dim) * (1 - Math.exp(-2.5 * dt));
      const target = r.maxSessions > 0 ? Math.min(1, r.activeSessions / r.maxSessions) : 0;
      r.busy += (target - r.busy) * (1 - Math.exp(-2.2 * dt));
      if (r.ripple >= 0) r.ripple = r.ripple + dt > RIPPLE_LIFE ? -1 : r.ripple + dt;
      if (r.left >= 0) r.left += dt;
    }
    for (let i = this.notices.length - 1; i >= 0; i--) {
      const notice = this.notices[i];
      if (!notice || this.simTime - notice.born > notice.life) this.notices.splice(i, 1);
    }
    if (this.notices.length > 4) this.notices.splice(0, this.notices.length - 4);
  }

  // ── the final sweep ──────────────────────────────────────────────────────────────────────────
  private startSweep(): void {
    this.sweepT = 0;
    const landed = this.flocks.filter((flock) => flock.status === 'merged').length;
    const name = landed > 0 ? `All ${landed} ${landed === 1 ? 'bird' : 'birds'} landed` : 'All birds landed';
    this.notices.push({
      id: 'finished',
      nodeId: '*',
      name,
      kind: 'finished',
      born: this.simTime,
      life: NOTICE_LIFE,
    });
  }

  private advanceSweep(dt: number): void {
    if (this.sweepT < 0) return;
    this.sweepT += dt;
    if (this.sweepT > SWEEP_DURATION) this.sweepT = -1;
  }

  /** How far the all-landed wave is through the wire (0..1), or -1 when idle. */
  sweepProgress(): number {
    return this.sweepT < 0 ? -1 : Math.min(1, this.sweepT / SWEEP_DURATION);
  }

  /** Vertical lift for a landed flock, staggered by merge order so the wave travels left → right. */
  private sweepLift(flock: Flock): number {
    if (this.sweepT < 0) return 0;
    const delay = Math.max(0, flock.mergedSlot) * 0.05;
    const local = (this.sweepT - delay) / 1.5;
    if (local <= 0 || local >= 1) return 0;
    return Math.sin(Math.PI * local) * 30;
  }

  // ── one flock ─────────────────────────────────────────────────────────────────────────────────
  private stepFlock(flock: Flock, dt: number): void {
    flock.statusTime += dt;
    flock.activity = this.activityFor(flock.taskKey);
    if (flock.beat > 0) flock.beat *= Math.exp(-BEAT_DECAY * dt);
    if (flock.beat < 0.01) flock.beat = 0;

    const roost = this.roostFor(flock.nodeId);
    const rx = roost?.x ?? this.width / 2;
    const ry = roost?.y ?? this.height - 26;
    const migrating = flock.migration !== null;
    const scatter = this.simTime < flock.scatterUntil;
    const kind: BehaviourKind = migrating ? 'migrate' : scatter ? 'scatter' : flock.behaviour.kind;
    const active: Behaviour = migrating ? MIGRATE : scatter ? SCATTER : flock.behaviour;

    const targetAlpha = kind === 'fade' ? Math.max(0, 1 - flock.statusTime / 4) : active.alpha;
    flock.alpha += (targetAlpha - flock.alpha) * (1 - Math.exp(-3 * dt));

    const prevX = flock.leaderX;
    const prevY = flock.leaderY;

    if (kind === 'migrate') {
      this.advanceMigration(flock, dt);
    } else if (kind === 'glide') {
      this.glideLeader(flock);
    } else if (kind === 'fall') {
      flock.leaderX = flock.enterX + Math.sin(this.simTime * 0.8 + flock.phase * TAU) * 5;
      flock.leaderY = Math.min(this.height - 26, flock.enterY + flock.statusTime * 24);
    } else if (kind === 'perched') {
      flock.leaderX = rx + roostPerchOffset(flock.roostSlot, flock.roostCount);
      flock.leaderY = ry - 8 - roostPerchRow(flock.roostSlot);
    } else if (kind === 'hopping') {
      flock.leaderX =
        rx +
        roostPerchOffset(flock.roostSlot, flock.roostCount) +
        Math.sin(this.simTime * 1.6 + flock.phase * TAU) * 7;
      flock.leaderY =
        ry -
        8 -
        roostPerchRow(flock.roostSlot) -
        Math.abs(Math.sin(this.simTime * 5.2 + flock.phase * TAU)) * 14;
    } else if (kind === 'wirePerch') {
      const slots = this.wireSlots();
      const x = wireSlotX(this.wire, Math.max(0, flock.mergedSlot), slots);
      flock.leaderX = x + Math.sin(this.simTime * 0.9 + flock.phase * TAU) * 2.4;
      flock.leaderY = this.wire.yAt(x) - 5 + Math.sin(this.simTime * 1.7 + flock.phase) * 1.4;
      // The final all-landed wave lifts the wire flocks in merge order.
      flock.leaderY -= this.sweepLift(flock);
    } else {
      this.leaderTarget(flock, kind, rx, ry);
      const rate =
        kind === 'murmur' ? 2.4 : kind === 'fade' ? 1.2 : kind === 'zigzag' || kind === 'flicker' ? 8 : 3.4;
      const k = 1 - Math.exp(-rate * dt);
      flock.leaderX += (this.tx - flock.leaderX) * k;
      flock.leaderY += (this.ty - flock.leaderY) * k;
    }

    const invDt = 1 / Math.max(dt, 1e-4);
    flock.leaderVx = (flock.leaderX - prevX) * invDt;
    flock.leaderVy = (flock.leaderY - prevY) * invDt;

    if (kind === 'perched' || kind === 'hopping' || kind === 'wirePerch' || kind === 'fall') {
      placeStatic(this.birds, flock, kind, this.simTime, dt);
    } else {
      stepBoids(this.birds, flock, kind, this.simTime, dt, this.width, this.height);
    }

    if (kind === 'migrate') this.recordTrail(flock);
    else this.drainTrail(flock, dt);
  }

  private leaderTarget(flock: Flock, kind: BehaviourKind, rx: number, ry: number): void {
    const w = this.width;
    const h = this.height;
    const t = this.simTime;
    const phase = flock.phase;
    // Working flocks loop *above their own roost*, low in the sky. Before Epic 47 they orbited the
    // middle of the canvas, which left the bottom half empty once the roosts emptied; anchoring the
    // band to the roost keeps every bird legible next to the machine that is running it.
    const band = ry - (0.2 + 0.07 * flock.activity) * h + (phase - 0.5) * 0.05 * h;
    switch (kind) {
      case 'murmur': {
        const a = flock.activity;
        const radiusX = 66 + 54 * a;
        const radiusY = 26 + 18 * a;
        const centreX = Math.min(w - radiusX - 70, Math.max(radiusX + 70, rx));
        const angle = t * (0.5 + 0.8 * a) + phase * TAU + flock.orbit * 0.7;
        this.tx = centreX + Math.cos(angle) * radiusX + Math.sin(t * 0.3 + phase) * 12;
        this.ty = band + Math.sin(angle) * radiusY;
        return;
      }
      case 'circle': {
        const angle = t * 1.9 + phase * TAU;
        this.tx = rx + Math.cos(angle) * 28;
        this.ty = band + Math.sin(angle) * 24;
        return;
      }
      case 'zigzag': {
        this.tx = rx + Math.sin(t * 8.2 + phase * TAU) * 52;
        this.ty = band - Math.abs(Math.sin(t * 4.1 + phase)) * 26;
        return;
      }
      case 'flicker': {
        this.tx = rx + Math.sin(t * 9 + phase) * 34;
        this.ty = band + Math.cos(t * 9 + phase) * 12;
        return;
      }
      case 'fade': {
        this.tx = flock.enterX + Math.sin(t * 0.7 + phase) * 14;
        this.ty = flock.enterY + flock.statusTime * 9;
        return;
      }
      case 'scatter': {
        this.tx = rx;
        this.ty = ry - h * 0.3;
        return;
      }
      default: {
        this.tx = flock.leaderX;
        this.ty = flock.leaderY;
        return;
      }
    }
  }

  private advanceMigration(flock: Flock, dt: number): void {
    const migration = flock.migration;
    if (!migration) return;
    migration.t = Math.min(1, migration.t + dt / migration.duration);
    const p = migration.t * migration.t * (3 - 2 * migration.t);
    const controlX = (migration.fromX + migration.toX) / 2;
    const controlY = Math.min(migration.fromY, migration.toY) - this.height * 0.18;
    const a = 1 - p;
    flock.leaderX = a * a * migration.fromX + 2 * a * p * controlX + p * p * migration.toX;
    flock.leaderY = a * a * migration.fromY + 2 * a * p * controlY + p * p * migration.toY;
    if (migration.t >= 1) {
      flock.migration = null;
      flock.trailDrain = 0;
    }
  }

  private glideLeader(flock: Flock): void {
    const slots = this.wireSlots();
    const targetX = wireSlotX(this.wire, Math.max(0, flock.mergedSlot), slots);
    const targetY = this.wire.yAt(targetX) - 5;
    const p = Math.min(1, flock.statusTime / 1.9);
    const e = p * p * (3 - 2 * p);
    const controlX = (flock.enterX + targetX) / 2;
    const controlY = Math.min(flock.enterY, targetY) - 46;
    const a = 1 - e;
    flock.leaderX = a * a * flock.enterX + 2 * a * e * controlX + e * e * targetX;
    flock.leaderY = a * a * flock.enterY + 2 * a * e * controlY + e * e * targetY;
  }

  private recordTrail(flock: Flock): void {
    if (flock.trailLen > 0) {
      const lastX = flock.trail[(flock.trailLen - 1) * 2] ?? 0;
      const lastY = flock.trail[(flock.trailLen - 1) * 2 + 1] ?? 0;
      if (Math.hypot(flock.leaderX - lastX, flock.leaderY - lastY) < 5) return;
    }
    if (flock.trailLen >= TRAIL_CAP) {
      flock.trail.copyWithin(0, 2);
      flock.trailLen = TRAIL_CAP - 1;
    }
    const i = flock.trailLen * 2;
    flock.trail[i] = flock.leaderX;
    flock.trail[i + 1] = flock.leaderY;
    flock.trailLen += 1;
  }

  private drainTrail(flock: Flock, dt: number): void {
    if (flock.trailLen === 0) return;
    flock.trailDrain += dt;
    if (flock.trailDrain < 0.055) return;
    flock.trailDrain = 0;
    flock.trail.copyWithin(0, 2);
    flock.trailLen -= 1;
  }

  // ── reduced motion ───────────────────────────────────────────────────────────────────────────
  /** Calm layout: see `calm.ts`. Every flock parks in its state zone; `step()` then freezes. */
  layoutCalm(): void {
    applyCalmLayout({
      flocks: this.flocks,
      birds: this.birds,
      roosts: this.roosts,
      wire: this.wire,
      width: this.width,
      height: this.height,
    });
  }
}

export function createSky(opts: SkySimOptions): SkySimulation {
  return new SkySimulation(opts);
}
