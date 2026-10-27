import type { AgentEvent } from '@starling/core';

/** How many events `/perch/events` can replay after a dropped stream (ARCHITECTURE §1). */
export const EVENT_REPLAY_LIMIT = 500;

export interface LoggedEvent {
  /** Monotonic id, sent as the SSE `id:` field and resumed through `Last-Event-ID`. */
  id: number;
  event: AgentEvent;
}

export interface EventLog {
  /** Append an event and return its id. Ids start at 1 and never repeat. */
  append(event: AgentEvent): LoggedEvent;
  /** The first buffered event whose id is greater than `lastId`, or `undefined` when none is left. */
  since(lastId: number): LoggedEvent | undefined;
  /** Notified after every append, so a waiting SSE loop can wake up. Returns an unsubscribe. */
  onChange(fn: () => void): () => void;
  /** Number of buffered events (never more than the limit). */
  size(): number;
  /** The id the next appended event will get. */
  nextId(): number;
}

/**
 * The perch's SSE backlog: a bounded ring of recent `AgentEvent`s.
 *
 * Why it exists: `/perch/events` is a live stream, so a Wi-Fi blip at the exact moment a session goes
 * idle would lose the `session.idle` event that tells the hub to collect. Ids plus a bounded history
 * let a reconnecting client ask for "everything after 41" without the perch growing without bound.
 *
 * The buffer is bounded but never blocks: the oldest event is dropped, which is the right tradeoff for
 * a 500-event window on a LAN — a client that falls further behind than that has bigger problems.
 */
export function createEventLog(limit: number = EVENT_REPLAY_LIMIT): EventLog {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`event log limit must be a positive integer, got ${limit}`);
  }
  const buffer: LoggedEvent[] = [];
  const listeners = new Set<() => void>();
  let next = 1;

  return {
    append(event) {
      const entry: LoggedEvent = { id: next, event };
      next += 1;
      buffer.push(entry);
      if (buffer.length > limit) buffer.shift();
      for (const listener of [...listeners]) listener();
      return entry;
    },

    since(lastId) {
      // Ids are contiguous inside the buffer, so the first greater id is either the answer or proves
      // the gap. `findIndex` over ≤ 500 entries is cheaper than maintaining a parallel index map.
      const index = buffer.findIndex((entry) => entry.id > lastId);
      return index === -1 ? undefined : buffer[index];
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    size() {
      return buffer.length;
    },

    nextId() {
      return next;
    },
  };
}
