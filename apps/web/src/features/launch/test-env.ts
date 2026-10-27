/**
 * Shared test environment for the launch lane.
 *
 * The root `bun run test` runs `apps/web` with `test-setup.ts` preloaded, but Bun may also run this
 * file alongside others where a lane's `afterAll` unregistered happy-dom. Re-checking before every
 * test is cheap and keeps the lane green in both processes.
 */
import { beforeEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

export function ensureDom(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
}

ensureDom();
beforeEach(ensureDom);
