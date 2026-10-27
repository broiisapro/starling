import { Hono } from 'hono';

/** The version reported by `GET /api/health`. Keep in sync with the root package version. */
export const VERSION = '0.0.0';

export interface HealthResponse {
  ok: true;
  version: string;
}

/**
 * The Starling HTTP API. Wave 0 only has `/api/health`; every other route in ARCHITECTURE §6
 * belongs to a later epic. `app.fetch` is handed straight to `Bun.serve`.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json<HealthResponse>({ ok: true, version: VERSION }));

  return app;
}
