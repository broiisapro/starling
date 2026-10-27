/**
 * State → behaviour for the Sky. This is the one table that decides what a flock *does*; `sim.ts`
 * only knows how to fly each `BehaviourKind`, and `render.ts` only knows how to draw it.
 *
 * | status     | kind        | what you see                                                          |
 * |------------|-------------|-----------------------------------------------------------------------|
 * | `pending`  | `perched`   | sitting still on its node's roost, a slow bob                          |
 * | `ready`    | `hopping`   | short hops along the branch, wings flicking                             |
 * | `running`  | `murmur`    | a wide loop above its roost; spread & speed scale with agent activity  |
 * | `auditing` | `circle`    | a tight, tense circle, amber-tinted                                     |
 * | `fixing`   | `zigzag`    | fast agitated zig-zags, coral-tinted                                    |
 * | `merging`  | `glide`     | a smooth glide up to its slot on the wire                               |
 * | `merged`   | `wirePerch` | perched on the `main` wire in merge order, gentle sway                  |
 * | `conflict` | `flicker`   | two sub-flocks blinking against each other, magenta                     |
 * | `failed`   | `fall`      | a slow fall out of the sky, greying and thinning                        |
 * | `cancelled`| `fade`      | drifting apart and fading to nothing                                    |
 *
 * Two more kinds are not statuses: `migrate` (a `task.migrated` event, or a `nodeId` change, sends
 * the flock on a long arc between roosts with a fading trail) and `scatter` (a node left; its birds
 * burst outward). Both are overrides in `sim.ts`.
 *
 * The table is deliberately tiny and total (`Record<TaskStatus, …>`) so a new status fails to type
 * check until the Sky knows what to do with it.
 */
import type { TaskStatus } from '@starling/core';
import { statusColor } from './palette';

export type BehaviourKind =
  | 'perched'
  | 'hopping'
  | 'murmur'
  | 'circle'
  | 'zigzag'
  | 'glide'
  | 'wirePerch'
  | 'fall'
  | 'flicker'
  | 'fade'
  // overrides, never reached through `behaviourFor`
  | 'migrate'
  | 'scatter';

export interface Behaviour {
  kind: BehaviourKind;
  /** Leader speed multiplier; 1 is the running baseline. */
  speed: number;
  /** Formation spread multiplier. */
  spread: number;
  /** Whether the flock leaves a comet trail on the sim side (migrations always do). */
  trail: boolean;
  /** Target alpha; `fade`/`fall` animate toward it. */
  alpha: number;
  tint: string;
}

const TABLE: Record<TaskStatus, Behaviour> = {
  pending: {
    kind: 'perched',
    speed: 0,
    spread: 0.5,
    trail: false,
    alpha: 1,
    tint: statusColor('pending'),
  },
  ready: { kind: 'hopping', speed: 0.4, spread: 0.6, trail: false, alpha: 1, tint: statusColor('ready') },
  running: { kind: 'murmur', speed: 1, spread: 1, trail: false, alpha: 1, tint: statusColor('running') },
  auditing: {
    kind: 'circle',
    speed: 1.5,
    spread: 0.45,
    trail: false,
    alpha: 1,
    tint: statusColor('auditing'),
  },
  fixing: { kind: 'zigzag', speed: 1.8, spread: 0.6, trail: false, alpha: 1, tint: statusColor('fixing') },
  merging: { kind: 'glide', speed: 1.2, spread: 0.5, trail: true, alpha: 1, tint: statusColor('merging') },
  merged: {
    kind: 'wirePerch',
    speed: 0,
    spread: 0.5,
    trail: false,
    alpha: 1,
    tint: statusColor('merged'),
  },
  conflict: {
    kind: 'flicker',
    speed: 1.3,
    spread: 0.8,
    trail: false,
    alpha: 1,
    tint: statusColor('conflict'),
  },
  failed: { kind: 'fall', speed: 0.3, spread: 0.3, trail: false, alpha: 0.45, tint: statusColor('failed') },
  cancelled: {
    kind: 'fade',
    speed: 0.5,
    spread: 0.7,
    trail: false,
    alpha: 0,
    tint: statusColor('cancelled'),
  },
};

/**
 * Statuses whose birds are placed directly (no boids). Perched, hopping and wire-perched birds must
 * be *still*; falling birds keep a rigid, collapsed formation. Everything else flies.
 */
export const STATIC_KINDS: ReadonlySet<BehaviourKind> = new Set<BehaviourKind>([
  'perched',
  'hopping',
  'wirePerch',
  'fall',
]);

export function behaviourFor(status: TaskStatus): Behaviour {
  return TABLE[status];
}

/** The override behaviour for a flock that is flying between roosts. */
export function migrateBehaviour(): Behaviour {
  return {
    kind: 'migrate',
    speed: 1.4,
    spread: 0.9,
    trail: true,
    alpha: 1,
    tint: '#9ad9ff',
  };
}

/** The override behaviour for a flock whose node just left. */
export function scatterBehaviour(): Behaviour {
  return {
    kind: 'scatter',
    speed: 1.6,
    spread: 1.5,
    trail: false,
    alpha: 0.9,
    tint: '#ff8fa3',
  };
}

/** Exposed for the Playground legend and tests: the table without the `tint` string churn. */
export function behaviourTable(): Readonly<Record<TaskStatus, Behaviour>> {
  return TABLE;
}
