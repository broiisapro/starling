/**
 * Browser-safe entry: `@starling/core/browser`.
 *
 * The web app (and any bundle that runs in a browser) may import from here. Everything reachable
 * from this module is pure: zod schemas, contract types, the handshake interfaces, glob matching,
 * pricing/metrics math, ULIDs and the error type. Nothing here imports `node:*`, `Bun`, `exec`,
 * config (which reads files), or the event bus.
 *
 * `browser.test.ts` bundles this module with `Bun.build({ target: 'browser' })` and fails if a
 * `node:` import or a `Bun.` reference sneaks into the graph.
 */
export const PACKAGE = '@starling/core/browser' as const;

export * from './contracts';
export * from './errors';
export * from './glob';
export * from './handshake';
export * from './ids';
export * from './metrics';
