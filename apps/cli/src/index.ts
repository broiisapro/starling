#!/usr/bin/env bun
/**
 * `starling` — the CLI. Commands talk to the engine only through the §8 handshake; the composition
 * root in `compose.ts` supplies mocks in Wave 1 and the real packages in Wave 2.
 */
export const PACKAGE = '@starling/cli' as const;

export * from './compose';
export * from './context';
export * from './doctor';
export type * from './handshake';
export * from './init';
export * from './jsonl';
export * from './live-state';
export * from './live-view';
export * from './plan-health';
export * from './program';
export * from './render/doctor';
export * from './render/flock';
export * from './render/format';
export * from './render/live';
export * from './render/palette';
export * from './render/plan';
export * from './render/status';
export * from './render/summary';
export * from './render/task-status';

import { main } from './program';

if (import.meta.main) {
  process.exitCode = await main(process.argv);
}
