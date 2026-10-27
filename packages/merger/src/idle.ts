/**
 * Wait for one resolver session to go idle.
 *
 * The `ExecutionNode` port has no `waitForIdle` (LOCKED contract), so the resolver watches
 * `agent.event`s. Two details matter:
 *
 * 1. The handle — and therefore the session id — only exists after `startTask` resolves, while a
 *    fast node can emit `session.started` before that. Events for our task are buffered until
 *    `attach()` and then replayed.
 * 2. `session.error` is a failure, not an idle: a crashed session must not be collected as if it had
 *    finished the work.
 */
import type { AgentEvent, ExecutionNode } from '@starling/core';
import { StarlingError } from '@starling/core';

/** A resolver session that has not gone idle in this long is abandoned. Model calls are slow. */
export const DEFAULT_SESSION_TIMEOUT_MS = 20 * 60 * 1000;

export interface IdleWatchOptions {
  runId: string;
  taskKey: string;
  /** Kill the watch after this long. 0 disables the watchdog (tests only). */
  timeoutMs?: number;
}

export interface IdleWatch {
  /** Resolves on `session.idle`; rejects on `session.error` or the timeout. */
  readonly done: Promise<void>;
  /** Bind the session id returned by `startTask`, replaying anything buffered before it arrived. */
  attach(sessionId: string): void;
  /** Unsubscribe and clear the watchdog. Safe to call more than once. */
  stop(): void;
}

export function watchForIdle(node: ExecutionNode, options: IdleWatchOptions): IdleWatch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const buffered: AgentEvent[] = [];
  let sessionId: string | undefined;
  let settled = false;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let resolveDone: () => void = () => undefined;
  let rejectDone: (err: unknown) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const settle = (error?: unknown): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
    if (error === undefined) resolveDone();
    else rejectDone(error);
  };

  const onEvent = (event: AgentEvent): void => {
    if (event.runId !== options.runId || event.taskKey !== options.taskKey) return;
    if (sessionId === undefined) {
      buffered.push(event);
      return;
    }
    if (event.sessionId !== sessionId) return;
    if (event.kind === 'session.idle') {
      settle();
    } else if (event.kind === 'session.error') {
      const reason = typeof event.data.reason === 'string' ? event.data.reason : 'unknown error';
      settle(
        new StarlingError('RUNNER_ERROR', `The resolver session for "${options.taskKey}" failed: ${reason}`, {
          details: { taskKey: options.taskKey, sessionId },
        }),
      );
    }
  };

  unsubscribe = node.onEvent(onEvent);

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      settle(
        new StarlingError(
          'RUNNER_ERROR',
          `The resolver session for "${options.taskKey}" did not go idle within ${timeoutMs}ms`,
          { details: { taskKey: options.taskKey, timeoutMs } },
        ),
      );
    }, timeoutMs);
    // A pending watchdog must not keep the process (or a test run) alive after the run finishes.
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    done,
    attach(nextSessionId: string): void {
      sessionId = nextSessionId;
      const pending = buffered.splice(0);
      for (const event of pending) {
        if (settled) break;
        onEvent(event);
      }
    },
    stop(): void {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      settled = true;
    },
  };
}
