/**
 * The Docker demo: the murmuration dashboard in a box.
 *
 * It is the same trick as `apps/server/src/dev.ts` — replay the recorded launch-day run into a
 * `MemoryStore` + `createEventBus()` on a loop, so every REST route and both SSE streams behave like
 * production — with three differences that only a container needs:
 *
 * 1. it serves the **built** dashboard from `apps/web/dist` (no Vite dev server in the image),
 * 2. it binds `0.0.0.0` explicitly (a container's loopback is not reachable from the host), and
 * 3. it drains cleanly on `SIGTERM`, which is what `docker stop` sends.
 *
 * There is no engine here on purpose: no agents, no shell, no API keys. `POST /api/runs` answers 501
 * and the image is safe to hand to someone who just wants to see the dashboard (see README.md).
 *
 * `createDemoEngine` is a 10-line read-only `EngineApi`; `apps/server/src/dev.ts` has an identical
 * copy but does not re-export it from the package entry, and `apps/server` is outside this lane.
 */
import { resolve } from 'node:path';
import type { EngineApi } from '../../apps/server/src/index.ts';
import {
  DEFAULT_PORT,
  loadReplayFile,
  startReplay,
  startServer,
  VERSION,
} from '../../apps/server/src/index.ts';
import { createEventBus, StarlingError } from '../../packages/core/src/index.ts';
import { MemoryStore } from '../../packages/core/src/testing/index.ts';

/** 8× real time: the 356 s recording plays in ~45 s, then loops after a short pause. */
export const DEFAULT_DEMO_SPEED = 8;

/** The server's default port, re-exported so the container's default has one source of truth. */
export { DEFAULT_PORT };

/** `tools/docker` → repo root → the recorded launch-day run. Also the Dockerfile's default. */
export const DEFAULT_FIXTURE_PATH = resolve(import.meta.dir, '../../fixtures/runs/sky-todo-launch-day.jsonl');

/** `tools/docker` → repo root → the Vite build output. */
export const DEFAULT_WEB_DIST = resolve(import.meta.dir, '../../apps/web/dist');

/** A container must listen on the wildcard address; the host maps it back to loopback. */
export const DEFAULT_HOSTNAME = '0.0.0.0';

export type Env = Record<string, string | undefined>;

export interface DockerDemoOptions {
  /** `0` asks the OS for a free port (tests). Defaults to `PORT` / `STARLING_PORT` / 7777. */
  port?: number;
  /** Defaults to `0.0.0.0`; tests pass `127.0.0.1`. */
  hostname?: string;
  /** Replay multiplier. Defaults to `STARLING_DEMO_SPEED` / 8. */
  speed?: number;
  /** JSONL event log. Defaults to `STARLING_DEMO_FIXTURE` / the launch-day recording. */
  fixture?: string;
  /** Built web app. Defaults to `apps/web/dist`. */
  webDist?: string;
  /** Loop the recording forever (default `true`). */
  loop?: boolean;
  /** Pause between loops in recorded ms, scaled by `speed` (default 4 000). */
  gapMs?: number;
}

export interface DockerDemo {
  url: string;
  port: number;
  hostname: string;
  version: string;
  /** The run id inside the fixture, already visible in `GET /api/runs`. */
  runId: string;
  webDist: string;
  /** Stop the replay and the HTTP listener. Idempotent. */
  stop: () => void;
}

/** Options resolved from the environment, with every required field filled in. */
export type ResolvedDemoOptions = Required<
  Pick<DockerDemoOptions, 'port' | 'hostname' | 'speed' | 'fixture' | 'webDist'>
>;

function parseIntEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Read the container's configuration. Invalid numbers fall back to the defaults instead of failing:
 * a dashboard that starts with a warning beats a container that crash-loops on a typo.
 */
export function demoOptionsFromEnv(env: Env = process.env): ResolvedDemoOptions {
  const port = parseIntEnv(env.PORT ?? env.STARLING_PORT, DEFAULT_PORT, 0, 65_535);
  const speed = parseIntEnv(env.STARLING_DEMO_SPEED, DEFAULT_DEMO_SPEED, 1, 1_000);
  const fixture = env.STARLING_DEMO_FIXTURE?.trim();
  return {
    port,
    hostname: DEFAULT_HOSTNAME,
    speed,
    fixture: fixture === undefined || fixture === '' ? DEFAULT_FIXTURE_PATH : fixture,
    webDist: DEFAULT_WEB_DIST,
  };
}

function notImplemented(method: string): () => Promise<never> {
  return async () => {
    throw new StarlingError(
      'NOT_IMPLEMENTED',
      `${method} needs an engine; the Docker demo only replays a recorded fixture.`,
    );
  };
}

/**
 * A read-only `EngineApi` (copied from `apps/server/src/dev.ts`, which does not export it publicly).
 * The routes map `NOT_IMPLEMENTED` to 501, so a curious visitor learns why nothing starts.
 */
export function createDemoEngine(store: MemoryStore): EngineApi {
  return {
    start: notImplemented('POST /api/runs'),
    cancel: notImplemented('POST /api/runs/:id/cancel'),
    abortTask: notImplemented('POST /api/runs/:id/tasks/:key/abort'),
    waitForFinish: notImplemented('waitForFinish'),
    getRun: (runId) => store.getRun(runId),
    listRuns: () => store.listRuns(),
  };
}

/**
 * Start the demo hub. Resolves once the listener is up and the first replayed event is in the store,
 * so `GET /api/runs` is populated before this returns.
 */
export async function startDockerDemo(options: DockerDemoOptions = {}): Promise<DockerDemo> {
  const resolved = demoOptionsFromEnv(process.env);
  const port = options.port ?? resolved.port;
  const hostname = options.hostname ?? resolved.hostname;
  const speed = options.speed ?? resolved.speed;
  const fixture = options.fixture ?? resolved.fixture;
  const webDist = options.webDist ?? resolved.webDist;

  const store = new MemoryStore();
  const bus = createEventBus();
  const file = loadReplayFile(fixture);

  const replay = startReplay({
    file,
    store,
    bus,
    speed,
    loop: options.loop ?? true,
    gapMs: options.gapMs ?? 4_000,
    onError: (err) => {
      bus.publish({
        type: 'log',
        runId: '*',
        ts: Date.now(),
        payload: { level: 'error', msg: `docker demo replay failed: ${String(err)}` },
      });
    },
  });

  const server = startServer(
    {
      engine: createDemoEngine(store),
      store,
      bus,
      version: VERSION,
      webDist,
      replay: async (path, replaySpeed) => {
        const replayFile = loadReplayFile(path);
        const handle = startReplay({ file: replayFile, store, bus, speed: replaySpeed, loop: false });
        return { runId: handle.runId };
      },
    },
    { port, hostname },
  );

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    replay.stop();
    server.stop();
  };

  return {
    url: server.url,
    port: server.port,
    hostname,
    version: VERSION,
    runId: file.runId,
    webDist,
    stop,
  };
}

if (import.meta.main) {
  const options = demoOptionsFromEnv();
  const demo = await startDockerDemo(options);
  // An app boundary: this is the one place in the image that prints.
  console.log(`Starling demo v${demo.version} listening on http://${demo.hostname}:${demo.port} 🐦`);
  console.log(`  dashboard  http://localhost:${demo.port}`);
  console.log(`  demo run   ${demo.runId}`);
  console.log(`  fixture    ${options.fixture}`);
  console.log(`  replay     ${options.speed}× real time, looping (no engine, read-only)`);

  const shutdown = (signal: string): void => {
    console.log(`\n${signal}: settling the murmuration…`);
    demo.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
