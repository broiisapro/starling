/**
 * Test-only DOM bootstrap. Call `ensureDom()` at the top of a test module before dynamically
 * importing `@testing-library/react`: Testing Library binds `screen` to `document.body` at import
 * time, so the document has to exist first. It never unregisters — bun runs several test files in
 * one process.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

export function ensureDom(url = 'http://localhost/'): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof document === 'undefined') {
    GlobalRegistrator.register({ url });
  }
}

ensureDom();
