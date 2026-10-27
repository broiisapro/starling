/**
 * Shared test environment for the agents feature lane. Imported first by every test file so the DOM
 * exists before Testing Library registers its hooks. Never unregisters: Bun runs test files in one
 * process and another file's `afterAll` must not pull the document out from under this one.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (typeof document === 'undefined') GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
