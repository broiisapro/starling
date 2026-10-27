import { writeFileSync } from 'node:fs';
import type { Run, StarlingEvent } from '../contracts';
import type { Store } from '../ports';

/**
 * In-memory `Store` double. Values are cloned on the way in and out, so mutating a returned run
 * cannot corrupt the store — the same guarantee the SQLite store gives in practice.
 */
export class MemoryStore implements Store {
  readonly #runs = new Map<string, Run>();
  readonly #events = new Map<string, StarlingEvent[]>();

  saveRun(run: Run): void {
    this.#runs.set(run.id, structuredClone(run));
  }

  getRun(id: string): Run | undefined {
    const run = this.#runs.get(id);
    return run === undefined ? undefined : structuredClone(run);
  }

  /** Most recent first, matching `GET /api/runs`. */
  listRuns(): Run[] {
    return [...this.#runs.values()]
      .map((run) => structuredClone(run))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  appendEvent(e: StarlingEvent): void {
    const bucket = this.#events.get(e.runId) ?? [];
    bucket.push(structuredClone(e));
    this.#events.set(e.runId, bucket);
  }

  events(runId: string, sinceTs?: number): StarlingEvent[] {
    const bucket = this.#events.get(runId) ?? [];
    const filtered = sinceTs === undefined ? bucket : bucket.filter((e) => e.ts >= sinceTs);
    return filtered.map((e) => structuredClone(e));
  }

  exportJsonl(runId: string, path: string): void {
    const lines = this.events(runId).map((e) => JSON.stringify(e));
    writeFileSync(path, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`);
  }
}
