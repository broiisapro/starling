/** Shared test helpers: event collection with awaited predicates, and small timers. */
import type { AgentEvent, AgentEventKind, AgentRunner, ModelRef } from '@starling/core';

export interface EventCollector {
  events: AgentEvent[];
  waitFor(
    predicate: AgentEventKind | ((event: AgentEvent) => boolean),
    timeoutMs?: number,
  ): Promise<AgentEvent>;
  kinds(): AgentEventKind[];
  close(): void;
}

export function collectEvents(runner: AgentRunner): EventCollector {
  const events: AgentEvent[] = [];
  const waiters = new Set<{
    predicate: (event: AgentEvent) => boolean;
    resolve: (event: AgentEvent) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const unsubscribe = runner.onEvent((event) => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  });

  return {
    events,
    waitFor(predicate, timeoutMs = 3_000) {
      const matches =
        typeof predicate === 'string' ? (event: AgentEvent) => event.kind === predicate : predicate;
      const existing = events.find(matches);
      if (existing !== undefined) return Promise.resolve(existing);

      return new Promise<AgentEvent>((resolve, reject) => {
        const waiter = {
          predicate: matches,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(
                `timed out after ${timeoutMs} ms waiting for an event; saw: ${events
                  .map((event) => event.kind)
                  .join(', ')}`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    kinds() {
      return events.map((event) => event.kind);
    },
    close() {
      unsubscribe();
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('collector closed'));
      }
      waiters.clear();
    },
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function eventually(predicate: () => boolean, timeoutMs = 3_000, intervalMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`condition was not met within ${timeoutMs} ms`));
        return;
      }
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

export const TEST_MODEL: ModelRef = { provider: 'deepseek', model: 'deepseek-v4.1-flash' };

export function startArgs(overrides: Partial<Parameters<AgentRunner['start']>[0]> = {}) {
  return {
    runId: 'run_test',
    taskKey: 't01-test',
    dir: '/tmp/starling-test-worktree',
    prompt: 'do the thing',
    model: TEST_MODEL,
    title: 'Test task',
    ...overrides,
  };
}

/** A ReadableStream of text chunks, for fake subprocess pipes. */
export function textStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
