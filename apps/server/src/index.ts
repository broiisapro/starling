/**
 * `@starling/server` — the hub's Hono REST + SSE app (ARCHITECTURE §6).
 *
 * Library entry point: everything is pure wiring over injected ports. Running this file directly
 * starts the demo server from `dev.ts`, because Wave 1 has no engine to wire yet.
 */
import { runDemoServer } from './dev';

export const PACKAGE = '@starling/server' as const;

export * from './app';
export * from './handshake';
export * from './http';
export * from './replay';
export * from './routes/events';
export * from './routes/flock';
export * from './routes/replay';
export * from './routes/runs';
export * from './sse';
export * from './static';

if (import.meta.main) {
  const demo = await runDemoServer();
  // An app boundary: this is the one place in the server that prints.
  console.log(`Starling server v${demo.version} listening on ${demo.url} 🐦`);
  console.log(`  demo run   ${demo.runId}`);
  console.log(`  REST       ${demo.url}/api/runs`);
  console.log(`  SSE        ${demo.url}/api/runs/${demo.runId}/events`);
  console.log('  no engine in Wave 1 — the launch-day fixture replays on a loop.');
}
