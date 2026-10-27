import type { Clock, ExecutionNode, NodeInfo, NodeRegistry, NodeRegistryEvent } from '@starling/core';

/**
 * A registry notification.
 *
 * The shape is core's `NodeRegistryEvent` since checkpoint C1 (`reason` is set for `left` so the
 * engine can tell a timeout from a goodbye); the alias stays so existing imports keep working.
 */
export type FlockRegistryEvent = NodeRegistryEvent;

/** The writable side of the registry. `FlockHub` and the engine's dispatcher need these. */
export interface FlockRegistry extends NodeRegistry {
  add(node: ExecutionNode, info: NodeInfo): NodeInfo;
  /** Forget a node and emit `left`. Unknown ids are a no-op. */
  remove(id: string, reason?: string): void;
  /** Refresh a node's stats; returns the stored info, or `undefined` for an unknown id. */
  touch(id: string, info: NodeInfo): NodeInfo | undefined;
  /** Mark nodes offline whose last touch is older than `offlineAfterMs`. Returns the timed-out ids. */
  sweep(): string[];
  /** Stop the background sweep timer and drop listeners. Does not remove nodes. */
  close(): void;
  onChange(fn: (event: FlockRegistryEvent) => void): () => void;
}

export interface RegistryOptions {
  clock: Clock;
  offlineAfterMs: number;
  /** Sweep period. Defaults to a third of the timeout, clamped to 50–1000 ms. */
  tickMs?: number;
  /** Set false to disable the timer (tests drive `sweep()` themselves). */
  autoSweep?: boolean;
}

interface Entry {
  node: ExecutionNode;
  info: NodeInfo;
}

/**
 * The flock's roster.
 *
 * Nodes are identified by their `NodeInfo.id` (the hub's is `'hub'`). Timeouts are judged against the
 * injected `Clock` and a touch's `lastSeen`, so a FakeClock makes the 15-second offline rule a one-line
 * test. A timed-out node is marked `offline` and announced with `left` so the engine reschedules its
 * tasks, but stays in the roster: the next heartbeat revives it without losing its id or history.
 */
export function createRegistry(options: RegistryOptions): FlockRegistry {
  const { clock, offlineAfterMs } = options;
  const entries = new Map<string, Entry>();
  const listeners = new Set<(event: FlockRegistryEvent) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const notify = (event: FlockRegistryEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const registry: FlockRegistry = {
    add(node, info) {
      const normalised: NodeInfo = {
        ...info,
        id: info.id === '' ? node.id : info.id,
        lastSeen: info.lastSeen > 0 ? info.lastSeen : clock.now(),
        status: info.status === 'offline' ? 'offline' : info.status,
      };
      entries.set(normalised.id, { node, info: normalised });
      notify({ type: 'joined', node: { ...normalised } });
      return normalised;
    },

    remove(id, reason = 'left the flock') {
      const entry = entries.get(id);
      if (entry === undefined) return;
      entries.delete(id);
      notify({
        type: 'left',
        node: { ...entry.info, status: 'offline', activeSessions: 0 },
        reason,
      });
    },

    touch(id, info) {
      const entry = entries.get(id);
      if (entry === undefined) return undefined;
      const wasOffline = entry.info.status === 'offline';
      const updated: NodeInfo = {
        ...info,
        id,
        lastSeen: info.lastSeen > 0 ? info.lastSeen : clock.now(),
        status: info.status === 'offline' ? 'offline' : info.status,
      };
      entry.info = updated;
      // A revived node is a join, not a stat: the UI paints a bird returning to the sky.
      notify(
        wasOffline && updated.status !== 'offline'
          ? { type: 'joined', node: { ...updated } }
          : { type: 'stats', node: { ...updated } },
      );
      return updated;
    },

    sweep() {
      const now = clock.now();
      const timedOut: string[] = [];
      for (const [id, entry] of entries) {
        if (entry.info.status === 'offline') continue;
        // A local node lives in this very process: there is no heartbeat to miss, so timing it out
        // would drop the hub from its own roster (and its own scheduler) after `offlineAfterMs`.
        if (entry.info.kind === 'local') continue;
        if (now - entry.info.lastSeen <= offlineAfterMs) continue;
        entry.info = { ...entry.info, status: 'offline', activeSessions: 0 };
        timedOut.push(id);
        notify({
          type: 'left',
          node: { ...entry.info },
          reason: 'heartbeat-timeout',
        });
      }
      return timedOut;
    },

    list() {
      return [...entries.values()].map((entry) => ({ ...entry.info }));
    },

    get(id) {
      return entries.get(id)?.node;
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    close() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      listeners.clear();
    },
  };

  const defaultTick = Math.max(50, Math.min(1000, Math.floor(offlineAfterMs / 3)));
  if (options.autoSweep !== false) {
    timer = setInterval(() => {
      registry.sweep();
    }, options.tickMs ?? defaultTick);
    // Never keep the process alive for a heartbeat sweep; a hub with nothing to do should exit.
    timer.unref?.();
  }

  return registry;
}
