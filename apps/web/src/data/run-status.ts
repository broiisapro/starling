import type { Run, RunStatus, StarlingEvent } from '@starling/core/browser';

/**
 * Forward-compatible `run.status` support.
 *
 * Epic 40 adds `{ type: 'run.status', payload: { from, to, run } }` to core's `StarlingEvent` union so
 * the run picker stops reading `mapping` for the whole run. Epic 41 lands in the same wave, possibly
 * before that core change, so the UI must handle the event **when it is present** and compile cleanly
 * when it is not:
 *
 * - this module declares the shape locally;
 * - `isRunStatusEvent` is a runtime guard, so the reducer does not need `'run.status'` in its switch
 *   (which would not typecheck against today's union);
 * - after core adds the member, the guard is still the same check and `Exclude<StarlingEvent, …>`
 *   keeps the rest of the reducer exhaustive.
 */
export interface RunStatusEvent {
  type: 'run.status';
  runId: string;
  ts: number;
  payload: { from: RunStatus; to: RunStatus; run: Run };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The part of a run the UI needs from a status event, checked structurally. */
function isRunSnapshot(value: unknown): value is Run {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.status === 'string' && isRecord(value.tasks);
}

export function isRunStatusEvent(event: StarlingEvent): event is StarlingEvent & RunStatusEvent {
  const candidate = event as { type: string; payload?: unknown };
  if (candidate.type !== 'run.status' || !isRecord(candidate.payload)) return false;
  const payload = candidate.payload;
  return typeof payload.from === 'string' && typeof payload.to === 'string' && isRunSnapshot(payload.run);
}

/** The rest of the reducer's switch sees this type; it grows automatically when core adds the member. */
export type KnownStarlingEvent = Exclude<StarlingEvent, RunStatusEvent>;
