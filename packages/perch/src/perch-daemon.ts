import {
  type Clock,
  type EventBus,
  type ExecutionNode,
  type NodeInfo,
  StarlingError,
  systemClock,
} from '@starling/core';
import { z } from 'zod';
import type { MdnsAdvertiser } from './handshake';
import { randomJoinCode } from './join-code';
import { findLanIPv4, perchUrl } from './lan';
import { STARLING_SERVICE_TYPE } from './mdns';
import { createPerchApp } from './perch-app';
import { createLocalModelsProbe, type ExecFn, type OsProbe, perchInfo, probeOs } from './perch-info';

export interface StartPerchOptions {
  /** The local `ExecutionNode` to expose. In production this is Epic 30's `LocalNode`. */
  node: ExecutionNode;
  /** Hub base URL, e.g. `http://192.168.1.20:7777`. Omit for mDNS-only discovery. */
  hub?: string;
  /** The flock join code (`XXXX-XXXX`). Required when `hub` is set. */
  code?: string;
  /** Perch API port. Default 7778; `0` binds an ephemeral port (tests). */
  port?: number;
  /** Bind address. Default `0.0.0.0` (ARCHITECTURE §6). */
  hostname?: string;
  /** Human name. `'auto'`/undefined means ComputerName, then hostname. */
  name?: string;
  maxSessions?: number;
  lendModels?: boolean;
  mdns?: MdnsAdvertiser;
  clock?: Clock;
  fetch?: typeof fetch;
  /** Heartbeat period. Default 3 s (ARCHITECTURE §1). */
  heartbeatMs?: number;
  /** First retry delay after a failed hub call. Default 500 ms. */
  backoffMs?: number;
  /** Retry backoff cap. Default 30 s. */
  maxBackoffMs?: number;
  /** Per-request timeout for hub calls. Default 5 s. */
  requestTimeoutMs?: number;
  keepAliveMs?: number;
  ollamaUrl?: string;
  exec?: ExecFn;
  os?: OsProbe;
  bus?: EventBus;
  /** Explicit API token. Defaults to `code`, or a generated code when running without a hub. */
  token?: string;
  /**
   * Host the hub should dial. Defaults to the first non-internal IPv4 (`findLanIPv4`). Tests pass
   * `127.0.0.1` so they never depend on the machine's Wi-Fi address.
   */
  publicHost?: string;
}

export interface PerchHandle {
  /** The URL a hub should use, e.g. `http://192.168.1.23:7778`. */
  url: string;
  /** Hub-assigned id. Read it again later: a retry can fill it in after `startPerch` resolves. */
  readonly nodeId?: string;
  /** Stop the heartbeat, abort in-flight sessions, unpublish mDNS and close the server. Idempotent. */
  stop(): Promise<void>;
}

const RegisterResponseSchema = z.object({ nodeId: z.string().min(1) });

/**
 * Start a perch: the daemon behind `starling perch`.
 *
 * Sequence: bind the Perch API on `0.0.0.0`, work out the LAN URL, advertise `_starling._tcp`,
 * then register with the hub (if one was given) and keep heartbeating. Registration and heartbeats
 * never throw out of `startPerch`: a hub that is asleep at boot is the normal case, so failures back
 * off exponentially and the loop keeps trying.
 */
export async function startPerch(opts: StartPerchOptions): Promise<PerchHandle> {
  const clock = opts.clock ?? systemClock;
  const doFetch = opts.fetch ?? fetch;
  const heartbeatMs = opts.heartbeatMs ?? 3000;
  const backoffMs = opts.backoffMs ?? 500;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 5000;
  const hub = opts.hub === undefined ? undefined : normalizeHub(opts.hub);

  const token = opts.token ?? opts.code ?? (hub === undefined ? randomJoinCode() : undefined);
  if (token === undefined || token.length === 0) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      'joining a hub needs the flock code (--code) or an explicit token',
    );
  }

  const log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string): void => {
    opts.bus?.publish({ type: 'log', runId: '*', ts: clock.now(), payload: { level, msg } });
  };

  // Probe the OS once: the friendly name is needed for mDNS and every heartbeat, and re-running
  // `scutil` on a 3 s loop is pointless. Injected in tests.
  const osFacts = await (opts.os ?? (() => probeOs({ exec: opts.exec })))();
  const requestedName = opts.name?.trim();
  const resolvedName =
    requestedName !== undefined && requestedName.length > 0 && requestedName !== 'auto'
      ? requestedName
      : (osFacts.computerName ?? osFacts.hostname);

  let assignedNodeId: string | undefined;
  let url = '';

  const modelsProbe = createLocalModelsProbe({
    clock,
    fetch: doFetch,
    ollamaUrl: opts.ollamaUrl,
    ttlMs: 30_000,
  });

  const info = (): Promise<NodeInfo> =>
    perchInfo({
      node: opts.node,
      name: resolvedName,
      maxSessions: opts.maxSessions,
      lendModels: opts.lendModels,
      url,
      id: assignedNodeId,
      clock,
      os: async () => osFacts,
      localModels: modelsProbe,
    });

  const app = createPerchApp({
    node: opts.node,
    token,
    info,
    bus: opts.bus,
    clock,
    keepAliveMs: opts.keepAliveMs,
  });

  const bindHost = opts.hostname ?? '0.0.0.0';
  const bindPort = opts.port ?? 7778;
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port: bindPort,
      hostname: bindHost,
      fetch: app.fetch,
      // SSE connections are long-lived and quiet between agent events. Bun's 10 s default would
      // kill an idle `/perch/events` stream between keep-alives; the app pings every 15 s.
      idleTimeout: 120,
    });
  } catch (err) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `perch could not bind ${bindHost}:${bindPort} — is another perch already running?`,
      { cause: err },
    );
  }

  const actualPort = server.port ?? bindPort;
  url = perchUrl(opts.publicHost ?? findLanIPv4(), actualPort);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const retryDelay = (attempt: number): number =>
    Math.min(backoffMs * 2 ** Math.max(0, attempt - 1), maxBackoffMs);

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
    timer.unref?.();
  };

  const call = async (path: string, body: unknown): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    timeout.unref?.();
    try {
      return await doFetch(`${hub}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flock-token': token },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped || hub === undefined) return;

    try {
      if (assignedNodeId === undefined) {
        const res = await call('/api/flock/register', { url, info: await info() });
        if (!res.ok) {
          failures += 1;
          log('warn', `hub rejected registration (${res.status}); retrying in ${retryDelay(failures)}ms`);
          schedule(retryDelay(failures));
          return;
        }
        const parsed = RegisterResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          failures += 1;
          log('warn', 'hub returned an unusable registration response; retrying');
          schedule(retryDelay(failures));
          return;
        }
        assignedNodeId = parsed.data.nodeId;
        failures = 0;
        log('info', `perch registered with ${hub} as ${assignedNodeId}`);
        schedule(heartbeatMs);
        return;
      }

      const res = await call('/api/flock/heartbeat', { nodeId: assignedNodeId, info: await info() });
      if (res.status === 404) {
        // The hub restarted or forgot this node. Drop the id and register again rather than
        // heartbeating into the void forever.
        log('warn', `hub no longer knows ${assignedNodeId}; re-registering`);
        assignedNodeId = undefined;
        failures = 0;
        schedule(backoffMs);
        return;
      }
      if (!res.ok) {
        failures += 1;
        log('warn', `heartbeat rejected (${res.status}); retrying in ${retryDelay(failures)}ms`);
        schedule(retryDelay(failures));
        return;
      }
      failures = 0;
      schedule(heartbeatMs);
    } catch (err) {
      failures += 1;
      const detail = err instanceof Error ? err.message : String(err);
      log('warn', `perch could not reach ${hub} (attempt ${failures}): ${detail}`);
      schedule(retryDelay(failures));
    }
  };

  if (opts.mdns !== undefined) {
    try {
      await opts.mdns.advertise({
        name: resolvedName,
        type: STARLING_SERVICE_TYPE,
        port: actualPort,
        // The code is published so a hub doing zero-config discovery can authenticate. LAN-only,
        // matching the no-TLS threat model in ARCHITECTURE L18.
        txt: { code: token, node: resolvedName },
      });
    } catch (err) {
      log('warn', `mDNS advertisement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (hub !== undefined) await tick();

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    await app.close();

    if (hub !== undefined && assignedNodeId !== undefined) {
      try {
        // The locked Perch API has no deregister route. A final heartbeat with status 'offline' is
        // the closest thing; if the hub ignores it, its 15 s heartbeat timeout cleans up.
        const finalInfo: NodeInfo = { ...(await info()), status: 'offline' };
        await call('/api/flock/heartbeat', { nodeId: assignedNodeId, info: finalInfo });
      } catch (err) {
        log(
          'debug',
          `perch could not send its offline heartbeat: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (opts.mdns !== undefined) {
      try {
        await opts.mdns.stop();
      } catch (err) {
        log('warn', `mDNS shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    server.stop(true);
  };

  return {
    url,
    get nodeId(): string | undefined {
      return assignedNodeId;
    },
    stop,
  };
}

function normalizeHub(hub: string): string {
  const trimmed = hub.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('hub URL must be http(s)');
    }
  } catch (err) {
    throw new StarlingError('INVALID_ARGUMENT', `invalid hub URL: ${hub}`, { cause: err });
  }
  return trimmed;
}
