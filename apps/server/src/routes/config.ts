/** `GET /api/config/public` — the header's secret-free config (see `public-config.ts`). */
import type { Hono } from 'hono';
import { buildPublicConfig, type PublicConfig, type PublicConfigInput } from '../public-config';

export interface ConfigRouteDeps {
  version: string;
  flockEnabled: boolean;
  publicConfig?: PublicConfigInput;
}

export function mountConfig(app: Hono, deps: ConfigRouteDeps): void {
  app.get('/api/config/public', (c) => {
    const body: PublicConfig = buildPublicConfig(deps.publicConfig, deps.version, deps.flockEnabled);
    return c.json(body);
  });
}
