/**
 * `startDashboard` — one call that turns a composed engine into a live control room.
 *
 * Epic 40's `starling run` calls this from the CLI: it binds the hub's HTTP + SSE surface, serves the
 * built web app when it exists, and publishes the secret-free config the header renders. Everything is
 * still injected, so the CLI decides what "real" means and the server never imports a sibling package.
 */
import type { EventBus, FlockHub, Store } from '@starling/core';
import { DEFAULT_PORT, type ServerHandle, type ServerOptions, startServer, VERSION } from './app';
import type { EngineApi } from './handshake';
import type { PublicConfigInput } from './public-config';
import type { ReplayFn } from './routes/replay';

export interface DashboardOptions extends ServerOptions {
  engine: EngineApi;
  store: Store;
  bus: EventBus;
  /** Absent → single-node mode: `/api/nodes` is empty and `/api/flock/*` answers 503. */
  flock?: FlockHub;
  /** `apps/web/dist`. Omitted → API only (the Vite dev server proxies `/api` instead). */
  webDist?: string;
  /** Default 7777 (ARCHITECTURE §6). */
  port?: number;
  /** Default `0.0.0.0` so a perch on the LAN can reach the hub. */
  hostname?: string;
  /** Defaults to the package's `VERSION`. */
  version?: string;
  /** `STARLING_LLM_PROFILE` / §5 defaults when unset. */
  publicConfig?: PublicConfigInput;
  replay?: ReplayFn;
  /** Where relative replay paths resolve from; defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Explicit replay allow-list roots; defaults to `<repoRoot>/fixtures` and `<repoRoot>/.starling`. */
  replayRoots?: string[];
}

export interface DashboardHandle extends ServerHandle {
  /** The config the header will read, already resolved — handy for a CLI banner. */
  publicConfig: PublicConfigInput;
}

/**
 * Build and bind the dashboard server. Synchronous: the caller prints `url`, then the engine keeps
 * publishing onto the same bus the SSE routes are subscribed to.
 */
export function startDashboard(options: DashboardOptions): DashboardHandle {
  const version = options.version ?? VERSION;
  const publicConfig: PublicConfigInput = {
    ...(options.publicConfig?.profile === undefined ? {} : { profile: options.publicConfig.profile }),
    ...(options.publicConfig?.models === undefined ? {} : { models: options.publicConfig.models }),
  };

  const handle = startServer(
    {
      engine: options.engine,
      store: options.store,
      bus: options.bus,
      version,
      publicConfig,
      ...(options.flock === undefined ? {} : { flock: options.flock }),
      ...(options.replay === undefined ? {} : { replay: options.replay }),
      ...(options.webDist === undefined ? {} : { webDist: options.webDist }),
      ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
      ...(options.replayRoots === undefined ? {} : { replayRoots: options.replayRoots }),
    },
    {
      port: options.port ?? DEFAULT_PORT,
      ...(options.hostname === undefined ? {} : { hostname: options.hostname }),
      ...(options.keepAliveMs === undefined ? {} : { keepAliveMs: options.keepAliveMs }),
      ...(options.corsOrigins === undefined ? {} : { corsOrigins: options.corsOrigins }),
      ...(options.shutdownSignal === undefined ? {} : { shutdownSignal: options.shutdownSignal }),
    },
  );

  return { ...handle, publicConfig };
}
