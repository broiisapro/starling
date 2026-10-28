/**
 * The demo hub: `bun run dev` in `apps/server`.
 *
 * It has **no engine**. It replays `fixtures/runs/sky-todo-launch-day.jsonl` on a loop into a
 * `MemoryStore` + `createEventBus()`, so every REST route and both SSE streams behave exactly as they
 * will in production, and the web epics have a real, live-looking run to point at before the engine
 * exists. `POST /api/replay` also works (one pass per call).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEventBus, StarlingError } from '@starling/core';
import { MemoryStore } from '@starling/core/testing';
import { DEFAULT_PORT, startServer, VERSION } from './app';
import type { EngineApi } from './handshake';
import { loadReplayFile, startReplay } from './replay';

/** `apps/server/src` → repo root → the recorded launch-day run. */
export const DEMO_FIXTURE_PATH = resolve(import.meta.dir, '../../../fixtures/runs/sky-todo-launch-day.jsonl');

/** `apps/web/dist`, when the dashboard has been built. */
const WEB_DIST = resolve(import.meta.dir, '../../web/dist');

/** 8× real time: the 356 s recording plays in ~45 s, then loops after a short pause. */
export const DEMO_SPEED = 8;

export interface DemoServerOptions {
  port?: number;
  speed?: number;
  fixture?: string;
  loop?: boolean;
}

export interface DemoServer {
  url: string;
  port: number;
  version: string;
  runId: string;
  stop: () => void;
}

function notImplemented(method: string): () => Promise<never> {
  return async () => {
    throw new StarlingError(
      'NOT_IMPLEMENTED',
      `${method} needs an engine; the demo server only replays a recorded fixture.`,
    );
  };
}

/**
 * A read-only `EngineApi`: it can serve the replayed run, but starting or cancelling work is honest
 * about not being wired yet (the route maps `NOT_IMPLEMENTED` to 501).
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

export async function runDemoServer(options: DemoServerOptions = {}): Promise<DemoServer> {
  const store = new MemoryStore();
  const bus = createEventBus();
  const fixturePath = options.fixture ?? process.env.STARLING_DEMO_FIXTURE ?? DEMO_FIXTURE_PATH;
  const speed = options.speed ?? Number(process.env.STARLING_DEMO_SPEED ?? DEMO_SPEED);
  const file = loadReplayFile(fixturePath);

  const replay = startReplay({
    file,
    store,
    bus,
    speed,
    loop: options.loop ?? true,
    gapMs: 4_000,
    onError: (err) => {
      bus.publish({
        type: 'log',
        runId: '*',
        ts: Date.now(),
        payload: { level: 'error', msg: `demo replay failed: ${String(err)}` },
      });
    },
  });

  const server = startServer(
    {
      engine: createDemoEngine(store),
      store,
      bus,
      version: VERSION,
      // Serve the built dashboard too, so other laptops can open http://<this-ip>:7777 and watch.
      ...(existsSync(resolve(WEB_DIST, 'index.html')) ? { webDist: WEB_DIST } : {}),
      replay: async (path, replaySpeed) => {
        const replayFile = loadReplayFile(path);
        const handle = startReplay({ file: replayFile, store, bus, speed: replaySpeed, loop: false });
        return { runId: handle.runId };
      },
    },
    { port: options.port ?? Number(process.env.STARLING_PORT ?? DEFAULT_PORT) },
  );

  return {
    url: server.url,
    port: server.port,
    version: VERSION,
    runId: file.runId,
    stop: () => {
      replay.stop();
      server.stop();
    },
  };
}

if (import.meta.main) {
  const demo = await runDemoServer();
  console.log(`Starling demo server v${demo.version} listening on ${demo.url} 🐦`);
  console.log(`  demo run   ${demo.runId}`);
  console.log(`  REST       ${demo.url}/api/runs`);
  console.log(`  SSE        ${demo.url}/api/runs/${demo.runId}/events`);
  console.log('  no engine: the launch-day fixture replays on a loop. Ctrl-C to stop the murmuration.');
}
