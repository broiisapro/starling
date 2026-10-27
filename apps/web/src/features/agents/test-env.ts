/**
 * Shared test environment for the agents feature lane.
 *
 * The DOM is (re)registered before every test rather than only at import time: Bun evaluates test
 * modules and runs their tests in one process, and another lane's `afterAll` may unregister happy-dom
 * between files. Re-checking is cheap and keeps this lane green under the root `bun run test`.
 */
import { beforeEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

export function ensureDom(): void {
  if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

ensureDom();
beforeEach(ensureDom);
