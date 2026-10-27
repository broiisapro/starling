/**
 * The dashboard side of `starling run` and `starling dash`.
 *
 * One place decides whether a built web app exists and how a port conflict is reported. `run` treats
 * the dashboard as a nicety (a busy port must not fail a coding run); `dash` treats it as the whole
 * point (so it reports the error and exits 1).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EventBus, Store } from '@starling/core';
import { StarlingError } from '@starling/core';
import { startServer, VERSION } from '@starling/server';
import type { EngineApi, FlockHub } from '../handshake';

export interface DashboardOptions {
  engine: EngineApi;
  store: Store;
  bus: EventBus;
  flock?: FlockHub;
  port: number;
  hostname?: string;
}

export interface Dashboard {
  url: string;
  port: number;
  stop(): void;
}

/** `apps/web/dist` when the dashboard has been built, else `undefined` (the server serves API only). */
export function resolveWebDist(): string | undefined {
  const dist = resolve(import.meta.dir, '../../../web/dist');
  return existsSync(resolve(dist, 'index.html')) ? dist : undefined;
}

export function startDashboard(options: DashboardOptions): Dashboard {
  const webDist = resolveWebDist();
  try {
    const handle = startServer(
      {
        engine: options.engine,
        store: options.store,
        bus: options.bus,
        version: VERSION,
        ...(options.flock === undefined ? {} : { flock: options.flock }),
        ...(webDist === undefined ? {} : { webDist }),
      },
      {
        port: options.port,
        ...(options.hostname === undefined ? {} : { hostname: options.hostname }),
      },
    );
    return { url: handle.url, port: handle.port, stop: handle.stop };
  } catch (err) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `Could not start the dashboard on port ${options.port}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err, details: { port: options.port } },
    );
  }
}
