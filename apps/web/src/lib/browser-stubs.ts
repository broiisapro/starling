/**
 * Browser stubs for the two Node builtins that `@starling/core`'s config loader imports.
 *
 * The web shell only needs core's contracts, error class and zod schemas; it never loads a YAML
 * config. Vite aliases `node:fs` / `node:path` here so the root barrel stays importable in a
 * browser (and the bundle no longer carries an externalized-module dead end).
 *
 * If any real code path calls these, fail loudly: silently guessing a path in a dashboard would be
 * worse than a clear error. Filed as a CONTRACT REQUEST (browser-safe core subpath) in the handback.
 */

export function existsSync(_path: string): boolean {
  return false;
}

export function readFileSync(_path: string): never {
  throw new Error('node:fs is not available in the browser; load config on the server instead');
}

export function resolve(...parts: string[]): string {
  return parts.filter((part) => part !== '').join('/');
}
