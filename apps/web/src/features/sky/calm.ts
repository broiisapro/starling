/**
 * Reduced-motion layout: a calm, static status map instead of a murmuration.
 *
 * Every flock parks in a zone for its status (see `calmZone`), or on its roost / wire slot for the
 * two states that already have a home. Birds sit in a neat 4 × 3 block — no flocking, no motion —
 * and `SkySimulation.step()` leaves them exactly where this function put them.
 */
import type { TaskStatus } from '@starling/core';
import type { BoidBuffers } from './boids';
import { calmZone, type Roost, roostPerchOffset, roostPerchRow, type Wire, wireSlotX } from './layout';

/** The subset of `Flock` the calm layout reads and writes (kept structural to avoid a cycle). */
export interface CalmFlock {
  taskKey: string;
  status: TaskStatus;
  nodeId: string;
  birdOffset: number;
  birds: number;
  roostSlot: number;
  roostCount: number;
  mergedSlot: number;
  leaderX: number;
  leaderY: number;
  alpha: number;
  behaviour: { alpha: number };
}

export interface CalmOptions {
  flocks: CalmFlock[];
  birds: BoidBuffers;
  roosts: readonly Roost[];
  wire: Wire;
  width: number;
  height: number;
}

export function applyCalmLayout({ flocks, birds, roosts, wire, width, height }: CalmOptions): void {
  const groups = new Map<TaskStatus, CalmFlock[]>();
  for (const flock of flocks) {
    const list = groups.get(flock.status) ?? [];
    list.push(flock);
    groups.set(flock.status, list);
  }

  for (const [status, list] of groups) {
    if (status === 'pending') {
      for (const flock of list) {
        const roost = roosts.find((candidate) => candidate.nodeId === flock.nodeId) ?? roosts[0];
        const rx = roost?.x ?? width / 2;
        const ry = (roost?.y ?? height - 26) - 8;
        flock.leaderX = rx + roostPerchOffset(flock.roostSlot, Math.max(1, flock.roostCount));
        flock.leaderY = ry - roostPerchRow(flock.roostSlot);
        placeBlock(flock, birds);
      }
      continue;
    }
    if (status === 'merged') {
      const slots = Math.max(1, flocks.length);
      for (const flock of list) {
        const x = wireSlotX(wire, Math.max(0, flock.mergedSlot), slots);
        flock.leaderX = x;
        flock.leaderY = wire.yAt(x) - 5;
        placeBlock(flock, birds);
      }
      continue;
    }

    const zone = calmZone(status, width, height);
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const cellW = (zone.x1 - zone.x0) / cols;
    const cellH = (zone.y1 - zone.y0) / rows;
    list.forEach((flock, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      flock.leaderX = zone.x0 + (col + 0.5) * cellW;
      flock.leaderY = zone.y0 + (row + 0.5) * cellH;
      placeBlock(flock, birds);
    });
  }
}

/** A 4 × 3 block of birds centred on the flock leader, all velocities zeroed. */
function placeBlock(flock: CalmFlock, birds: BoidBuffers): void {
  const { x, y, vx, vy } = birds;
  const base = flock.birdOffset;
  for (let j = 0; j < flock.birds; j++) {
    const i = base + j;
    const col = j % 4;
    const row = Math.floor(j / 4);
    x[i] = flock.leaderX + (col - 1.5) * 7;
    y[i] = flock.leaderY + (row - 1) * 5;
    vx[i] = 0;
    vy[i] = 0;
  }
  flock.alpha = flock.behaviour.alpha;
}
