/**
 * Keep the hub's own `LocalNode` alive in the registry.
 *
 * `createRegistry()` marks a node `offline` when its `lastSeen` is older than `flock.offlineAfterMs`
 * (15 s by default). Perches keep themselves alive with `POST /api/flock/heartbeat`; the hub's own
 * node has nobody to speak for it, so without this timer the hub goes offline 15 seconds into every
 * run, the engine treats it as lost (`node.left`) and reschedules its own tasks forever. Found the
 * hard way on the first real end-to-end run.
 *
 * The first refresh is immediate, so `info()` (cores, memory, capacity) replaces the placeholder the
 * composition registered synchronously.
 */
import type { Clock, ExecutionNode, NodeInfo } from '@starling/core';

/** The slice of `FlockRegistry` this needs — `touch` refreshes a node and emits `node.stats`. */
export interface NodeTouchable {
  touch(id: string, info: NodeInfo): unknown;
}

export interface HubHeartbeatOptions {
  node: ExecutionNode;
  registry: NodeTouchable;
  clock: Clock;
  everyMs: number;
  /** Called when a refresh fails; the timer keeps running (a transient `info()` failure is not fatal). */
  onError?: (err: unknown) => void;
}

export interface HubHeartbeat {
  /** Refresh now. Never rejects. */
  refresh(): Promise<void>;
  /** Stop the timer. Idempotent. */
  stop(): void;
}

export function startHubHeartbeat(options: HubHeartbeatOptions): HubHeartbeat {
  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = async (): Promise<void> => {
    try {
      const info = await options.node.info();
      options.registry.touch(options.node.id, { ...info, lastSeen: options.clock.now() });
    } catch (err) {
      options.onError?.(err);
    }
  };

  void refresh();
  timer = setInterval(
    () => {
      void refresh();
    },
    Math.max(250, options.everyMs),
  );
  // Never keep a finished `starling run` alive just to heartbeat the hub into an empty sky.
  timer.unref?.();

  return {
    refresh,
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
