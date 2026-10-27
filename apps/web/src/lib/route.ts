import { DEFAULT_DEMO_SPEED, type DemoSpeed, parseDemoSpeed } from './speed';

/**
 * Tiny URL router — no react-router dependency, no server routes.
 *
 * The dashboard only has three addressable things in Wave 1:
 * - `?demo=1`       force demo mode (auto-demo already kicks in when /api/health fails)
 * - `?speed=4`      demo speed: 1, 4 or 16
 * - `?run=<ulid>`   open a specific run (`#/runs/<ulid>` is accepted too)
 */
export interface SkyRoute {
  /** `true` forces demo, `false` forces live, absent lets bootstrap probe `/api/health`. */
  demo?: boolean;
  /** Only set when the URL carried a valid speed. */
  speed?: DemoSpeed;
  runId?: string;
}

export const DEFAULT_ROUTE: SkyRoute = {};

export function parseRoute(search: string, hash = ''): SkyRoute {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const runFromParams = params.get('run')?.trim();
  const runFromHash = /^#\/runs\/([A-Za-z0-9_-]+)$/.exec(hash)?.[1];
  const speed = parseDemoSpeed(params.get('speed'));
  const demoFlag = params.get('demo');

  const route: SkyRoute = {};
  if (demoFlag === '1' || demoFlag === 'true' || hash === '#/demo') route.demo = true;
  else if (demoFlag === '0' || demoFlag === 'false') route.demo = false;
  if (speed !== undefined) route.speed = speed;
  const runId = runFromParams !== undefined && runFromParams !== '' ? runFromParams : runFromHash;
  if (runId !== undefined) route.runId = runId;
  return route;
}

export function currentRoute(
  location: { search: string; hash: string } | undefined = globalThis.location,
): SkyRoute {
  if (location === undefined) return DEFAULT_ROUTE;
  return parseRoute(location.search, location.hash);
}

/** The speed to boot with: URL, else 1×. */
export function initialSpeed(route: SkyRoute): DemoSpeed {
  return route.speed ?? DEFAULT_DEMO_SPEED;
}
