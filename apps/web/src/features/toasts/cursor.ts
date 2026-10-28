import type { StarlingEvent } from '@starling/core/browser';

/**
 * A position in the dashboard's event window, used to find "what arrived since the last render".
 *
 * `SkyState.events` is not an append-only log: it is capped at `EVENT_CAP`, re-filtered whenever the
 * shell switches runs (`setActiveRun`) and reset by a demo loop. An array index alone is therefore
 * wrong in three ways — it replays history after a re-filter, it skips events after a cap slice, and
 * it points at a different event after a reset. The cursor anchors on the last event's identity
 * `(ts, type, runId)` plus how many events were visible when it was taken.
 */
export interface Cursor {
  ts: number;
  type: string;
  runId: string;
  /** `events.length` at the time the cursor was taken. */
  count: number;
}

/** Cursor over an empty window. The next batch is treated as a baseline, not as history to replay. */
export const EMPTY_CURSOR: Cursor = { ts: 0, type: '', runId: '', count: 0 };

function sameEvent(event: StarlingEvent, cursor: Cursor): boolean {
  return event.ts === cursor.ts && event.type === cursor.type && event.runId === cursor.runId;
}

/** Cursor pointing just past the last event of `events`. */
export function cursorAt(events: readonly StarlingEvent[]): Cursor {
  const last = events.at(-1);
  if (last === undefined) return { ...EMPTY_CURSOR };
  return { ts: last.ts, type: last.type, runId: last.runId, count: events.length };
}

export interface CursorStep {
  /** Events that arrived after the cursor. Empty when the window moved under us. */
  fresh: StarlingEvent[];
  cursor: Cursor;
}

/**
 * Advance a cursor and return only the events that arrived after it.
 *
 * Rules, in order:
 * 1. **First call** (`prev === undefined`) primes the cursor and returns nothing. Mounting on a
 *    finished run, a demo loop or an SSE backlog must not fire a toast storm.
 * 2. **Empty baseline** (`prev.count === 0`) also returns nothing for the first non-empty batch.
 *    A backlog that arrives right after an empty mount is history, not news. The batch after it is
 *    live.
 * 3. **Unchanged or appended window**: the event at `prev.count - 1` still matches the cursor, so
 *    everything from `prev.count` on is fresh. This is the normal path and it never double-counts
 *    events that share a `(ts, type, runId)` signature.
 * 4. **Shifted window**: the cap dropped the head, or a run switch re-filtered the array. Find the
 *    last occurrence of the cursor signature and take everything after it. If the signature was
 *    evicted entirely, return nothing and reprime — silently dropping a few events is better than
 *    replaying a backlog.
 */
export function newEventsSince(prev: Cursor | undefined, events: readonly StarlingEvent[]): CursorStep {
  const cursor = cursorAt(events);

  if (prev === undefined) return { fresh: [], cursor };
  if (prev.count === 0) return { fresh: [], cursor };
  // A shrinking window with the same length signals a reset (demo loop); the signature check below
  // catches it, but this guard keeps the anchor read in bounds when the window is shorter.
  if (prev.count <= events.length) {
    const anchor = events[prev.count - 1];
    if (anchor !== undefined && sameEvent(anchor, prev)) {
      return { fresh: events.slice(prev.count), cursor };
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && sameEvent(event, prev)) {
      return { fresh: events.slice(index + 1), cursor };
    }
  }

  return { fresh: [], cursor };
}
