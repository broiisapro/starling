import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEvent,
  Clock,
  ExecutionNode,
  NodeInfo,
  StartTaskOptions,
  TaskHandle,
  TaskResult,
} from '@starling/core';
import {
  AgentEventSchema,
  NodeInfoSchema,
  StarlingError,
  systemClock,
  TaskHandleSchema,
  TaskResultSchema,
} from '@starling/core';
import type { BundleOps } from './bundle-ops';
import { bundleFileName } from './bundle-ops';
import { request, requestBytes, requestJson, type SseSubscription, subscribeSse } from './http';

export interface RemoteNodeOptions {
  /** Perch base URL, e.g. `http://192.168.1.24:7778`. */
  url: string;
  /** The join code, sent as `x-flock-token`. */
  token: string;
  /** Last known NodeInfo. `info()` refreshes it from the perch. */
  info: NodeInfo;
  fetch?: typeof fetch;
  clock?: Clock;
  /** `fetchBundle` imports a returned bundle into the hub repo as the task branch. */
  bundleOps?: Partial<BundleOps>;
  /** Where downloaded bundles are written. Defaults to `<tmpdir>/starling-flock`. */
  bundleDir?: string;
  timeoutMs?: number;
  /** SSE reconnect delay. */
  reconnectMs?: number;
  /** Set false to keep the node HTTP-only (useful for probes and tests). */
  events?: boolean;
}

export interface RemoteNode extends ExecutionNode {
  readonly url: string;
  /** Close the event stream and drop listeners. Idempotent. */
  close(): void;
  /** The last event-stream failure, for `starling doctor` style diagnostics. */
  lastEventError(): StarlingError | undefined;
}

function taskPath(base: string, handle: Pick<TaskHandle, 'runId' | 'taskKey'>): string {
  return `${base}/perch/tasks/${encodeURIComponent(handle.runId)}/${encodeURIComponent(handle.taskKey)}`;
}

/**
 * An `ExecutionNode` that is really another laptop running `starling perch`.
 *
 * All state-changing work happens over the locked Perch API (ARCHITECTURE §6): start/prompt/abort,
 * then `collect` gets the commit summary and pulls the result as a git bundle. That bundle is fetched
 * into the hub repo as the task branch, so audit and merge stay on the hub (L20).
 */
export function createRemoteNode(options: RemoteNodeOptions): RemoteNode {
  const base = options.url.replace(/\/+$/, '');
  const token = options.token;
  const clock = options.clock ?? systemClock;
  const fetchFn = options.fetch ?? fetch;
  const bundleDir = options.bundleDir ?? join(tmpdir(), 'starling-flock');
  const http = { fetch: fetchFn, token, timeoutMs: options.timeoutMs };

  let cached: NodeInfo = { ...options.info };
  let sse: SseSubscription | undefined;
  let eventError: StarlingError | undefined;
  const listeners = new Set<(event: AgentEvent) => void>();
  const sessions = new Map<string, TaskHandle>();

  const dispatch = (data: string): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      // A malformed SSE frame is a broken perch, not a broken hub; skip it and keep the stream alive.
      return;
    }
    const parsed = AgentEventSchema.safeParse(raw);
    if (!parsed.success) return;
    for (const listener of [...listeners]) listener(parsed.data);
  };

  const startEvents = (): void => {
    if (sse !== undefined || options.events === false) return;
    sse = subscribeSse({
      url: `${base}/perch/events`,
      token,
      fetch: fetchFn,
      reconnectMs: options.reconnectMs,
      onData: dispatch,
      onError: (err) => {
        eventError = err;
      },
    });
  };

  const stopEvents = (): void => {
    sse?.close();
    sse = undefined;
  };

  const node: RemoteNode = {
    id: cached.id,
    url: base,

    async info() {
      const started = performance.now();
      const fresh = await requestJson(`${base}/perch/info`, { method: 'GET' }, NodeInfoSchema, http);
      cached = {
        ...fresh,
        url: base,
        latencyMs: Math.round(performance.now() - started),
        lastSeen: clock.now(),
      };
      return { ...cached };
    },

    async startTask(opts: StartTaskOptions) {
      const handle = await requestJson(
        `${base}/perch/tasks`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(opts),
        },
        TaskHandleSchema,
        http,
      );
      sessions.set(handle.sessionId, handle);
      return handle;
    },

    async sendPrompt(handle: TaskHandle, prompt: string) {
      await requestJson(
        `${taskPath(base, handle)}/prompt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        },
        { parse: () => undefined },
        http,
      );
    },

    async abort(handle: TaskHandle) {
      await requestJson(
        `${taskPath(base, handle)}/abort`,
        { method: 'POST' },
        { parse: () => undefined },
        http,
      );
    },

    async collect(handle: TaskHandle, hubRepo: string, baseRef: string) {
      const collected = await requestJson(
        `${taskPath(base, handle)}/collect`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseRef }),
        },
        TaskResultSchema,
        http,
      );

      const query = `?base=${encodeURIComponent(baseRef)}`;
      const bytes = await requestBytes(`${taskPath(base, handle)}/bundle${query}`, { method: 'GET' }, http);
      await mkdir(bundleDir, { recursive: true });
      const bundlePath = join(
        bundleDir,
        `${bundleFileName(handle.runId)}-${bundleFileName(handle.taskKey)}.bundle`,
      );
      await Bun.write(bundlePath, bytes);

      if (options.bundleOps?.fetchBundle !== undefined) {
        await options.bundleOps.fetchBundle(hubRepo, bundlePath, handle.branch, handle.branch);
      }

      const result: TaskResult = { ...collected, bundlePath };
      return result;
    },

    async cleanup(handle: TaskHandle) {
      sessions.delete(handle.sessionId);
      try {
        await request(`${taskPath(base, handle)}`, { method: 'DELETE' }, http);
      } catch (err) {
        // Cleanup is best effort by contract: a perch that vanished mid-run must not fail the merge.
        // Any other error is surfaced to the caller (a truly broken perch still needs a human).
        if (!(err instanceof StarlingError && err.code === 'NODE_OFFLINE')) throw err;
      }
    },

    onEvent(fn) {
      listeners.add(fn);
      startEvents();
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) stopEvents();
      };
    },

    close() {
      stopEvents();
      listeners.clear();
      sessions.clear();
    },

    lastEventError() {
      return eventError;
    },
  };

  return node;
}
