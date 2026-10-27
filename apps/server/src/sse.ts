/**
 * SSE plumbing for the two event streams in ARCHITECTURE §6.
 *
 * The contract the dashboard relies on: **backlog first, then live, in order, once each**. To keep
 * that true while a run is still publishing, the live subscription is opened *before* the backlog is
 * read. Events that arrive during the backlog are buffered and then flushed, minus the ones that the
 * backlog already covered (deduplicated by `runId|type|ts`). A dropped or duplicated frame is the one
 * thing an event-sourced UI cannot tolerate, so the extra bookkeeping is worth it.
 */
import type { StarlingEvent } from '@starling/core';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

/** ARCHITECTURE §6: a keep-alive comment every 15 s. */
export const DEFAULT_KEEP_ALIVE_MS = 15_000;

export interface SseSource {
  /** Read the persisted backlog. Called *after* `subscribe`, so nothing slips through the gap. */
  loadBacklog(): StarlingEvent[];
  subscribe(fn: (event: StarlingEvent) => void): () => void;
}

export interface StreamEventsOptions {
  /** Only forward events with `ts >= since`. Absent means everything. */
  since?: number;
  keepAliveMs?: number;
  /** Non-fatal stream failures (a write after the client vanished). Never thrown into Hono. */
  onError?: (err: unknown) => void;
}

export function matchesSince(event: StarlingEvent, since?: number): boolean {
  return since === undefined || event.ts >= since;
}

function eventKey(event: StarlingEvent): string {
  return `${event.runId}|${event.type}|${event.ts}`;
}

/**
 * Stream a backlog and then the live bus as `text/event-stream`.
 *
 * Each `data:` line is one `StarlingEvent` JSON, exactly as the store persists it. The stream stays
 * open until the client disconnects (or the run is cancelled and the UI closes it); cleanup runs on
 * disconnect so a closed tab never leaves a bus subscriber behind.
 */
export function streamEvents(c: Context, source: SseSource, options: StreamEventsOptions = {}): Response {
  const keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;

  return streamSSE(c, async (stream) => {
    let closed = false;
    // One promise chain keeps ordering even when two events are published in the same tick.
    let chain: Promise<unknown> = Promise.resolve();

    const write = (chunk: string): void => {
      chain = chain
        .then(() => (closed ? undefined : stream.write(chunk)))
        .catch((err: unknown) => {
          if (!closed) options.onError?.(err);
        });
    };
    const send = (event: StarlingEvent): void => {
      write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const buffered: StarlingEvent[] = [];
    let buffering = true;

    // Flush the response headers straight away (`fetch` does not resolve until the first byte), and
    // tell the client the stream is live. SSE parsers ignore comments.
    write(': connected\n\n');

    const unsubscribe = source.subscribe((event) => {
      if (!matchesSince(event, options.since)) return;
      if (buffering) {
        buffered.push(event);
        return;
      }
      send(event);
    });

    const backlog = source.loadBacklog();
    const accounted = new Map<string, number>();
    for (const event of backlog) {
      const key = eventKey(event);
      accounted.set(key, (accounted.get(key) ?? 0) + 1);
    }
    for (const event of backlog) send(event);

    buffering = false;
    for (const event of buffered) {
      const key = eventKey(event);
      const remaining = accounted.get(key) ?? 0;
      if (remaining > 0) {
        accounted.set(key, remaining - 1);
        continue;
      }
      send(event);
    }
    buffered.length = 0;

    const timer = setInterval(() => write(': keep-alive\n\n'), keepAliveMs);
    timer.unref?.();

    const stop = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
    };

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        stop();
        resolve();
      });
      c.req.raw.signal.addEventListener(
        'abort',
        () => {
          stop();
          resolve();
        },
        { once: true },
      );
      if (stream.aborted) resolve();
    });

    // Let already-queued frames drain before Hono closes the stream.
    await chain;
  });
}
