/**
 * `@starling/store` — SQLite persistence and record/replay for every Starling event.
 *
 * ```ts
 * import { createSqliteStore, attachRecorder, createReplayer, deriveRun } from '@starling/store';
 * ```
 */
export const PACKAGE = '@starling/store' as const;

export type { DerivedRunState, RunAccumulator } from './derive';
export { createRunAccumulator, deriveRun, deriveRunState } from './derive';
export { importJsonl, parseJsonl, serialiseJsonl, writeJsonl } from './jsonl';
export { attachRecorder } from './recorder';
export type { Replayer, ReplayerOptions } from './replayer';
export { createReplayer, MAX_REPLAY_GAP_MS, rewriteEventRunId } from './replayer';
export type { SqliteStore } from './sqlite-store';
export { createSqliteStore, STORE_SCHEMA_VERSION } from './sqlite-store';
