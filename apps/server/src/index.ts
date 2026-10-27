/** `@starling/server` — Hono REST + SSE. Only `/api/health` exists until the server epic lands. */
import { createApp, VERSION } from './app';

export const PACKAGE = '@starling/server' as const;
export { createApp, VERSION } from './app';

const port = Number(process.env.STARLING_PORT ?? 7777);

if (import.meta.main) {
  Bun.serve({ port, fetch: createApp().fetch });
  // The server is an app boundary, so printing the roost address here is intentional.
  console.log(`Starling server v${VERSION} listening on http://localhost:${port} 🐦`);
}
