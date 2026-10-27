/** Shared paths and helpers for the store's test suites (not a test file itself). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StarlingEvent } from '@starling/core';

export const FIXTURE_RECORDING = fileURLToPath(
  new URL('../../../fixtures/runs/sky-todo-launch-day.jsonl', import.meta.url),
);

/** A scratch directory per test, removed by the caller. */
export function makeTempDir(prefix = 'starling-store-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** A minimal, always-valid run-scoped event. */
export function makeLogEvent(runId: string, ts: number, msg = 'tick'): StarlingEvent {
  return { type: 'log', runId, ts, payload: { level: 'info', msg } };
}
