/**
 * `bun:sqlite` implementation of the `Store` port.
 *
 * Schema (ARCHITECTURE §6 / Epic 19):
 *   runs(id PK, status, started_at, json)
 *   events(run_id, seq, ts, type, json) + index (run_id, seq)
 *
 * `seq` is monotonic per run. Writes are buffered and flushed in one transaction (every 64 events,
 * at the end of the current microtask, or whenever something reads), which keeps the synchronous
 * `Store` API consistent while amortising the transaction cost of a replay burst.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Run, RunSchema, StarlingError, type StarlingEvent, type Store } from '@starling/core';
import { writeJsonl } from './jsonl';

/** Bumped only when the SQLite layout changes; `PRAGMA user_version` is the whole migration story. */
export const STORE_SCHEMA_VERSION = 1;

/** Events buffered before a transaction is forced. Small enough to bound crash loss, large enough to batch. */
const FLUSH_THRESHOLD = 64;

export interface SqliteStore extends Store {
  /** Flush buffered events to disk now. Reads and `close()` already do this implicitly. */
  flush(): void;
  /** Append many events in a single transaction (used by import/backfill paths). */
  appendEvents(events: readonly StarlingEvent[]): void;
  close(): void;
}

interface JsonRow {
  json: string;
}
interface CountRow {
  m: number;
}
interface MarkRow {
  user_version: number;
}

function storeError(message: string, cause?: unknown): StarlingError {
  return new StarlingError('STORE_ERROR', message, { cause });
}

function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  );
  CREATE INDEX IF NOT EXISTS events_run_seq ON events (run_id, seq);
`;

/**
 * Open (or create) a store at `path`. `':memory:'` gives an ephemeral store for tests.
 * A file store runs in WAL mode with `synchronous=NORMAL` and creates its parent directory.
 */
export function createSqliteStore(path: string): SqliteStore {
  if (path !== ':memory:') {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (err) {
      throw storeError(`could not create the directory for store ${path}: ${detailOf(err)}`, err);
    }
  }

  let db: Database;
  try {
    db = new Database(path, { create: true, readwrite: true });
  } catch (err) {
    throw storeError(`could not open store ${path}: ${detailOf(err)}`, err);
  }

  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);

    const mark = db.query('PRAGMA user_version').get() as MarkRow | null;
    const version = mark?.user_version ?? 0;
    if (version > STORE_SCHEMA_VERSION) {
      throw storeError(
        `store ${path} was written by a newer Starling (schema ${version} > ${STORE_SCHEMA_VERSION})`,
      );
    }
    if (version < STORE_SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION};`);
  } catch (err) {
    db.close();
    if (err instanceof StarlingError) throw err;
    throw storeError(`could not initialise store ${path}: ${detailOf(err)}`, err);
  }

  const upsertRun = db.prepare(
    `INSERT INTO runs (id, status, started_at, json) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at, json = excluded.json`,
  );
  const insertEvent = db.prepare('INSERT INTO events (run_id, seq, ts, type, json) VALUES (?, ?, ?, ?, ?)');
  const selectRun = db.prepare('SELECT json FROM runs WHERE id = ?');
  const listRunsStmt = db.prepare('SELECT json FROM runs ORDER BY started_at DESC, id DESC');
  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE run_id = ?');
  const eventsForRun = db.prepare('SELECT json FROM events WHERE run_id = ? ORDER BY seq');
  const eventsForRunWithFlock = db.prepare(
    `SELECT json FROM events
     WHERE run_id = ?1 OR (run_id = '*' AND ts >= ?2 AND (?3 IS NULL OR ts <= ?3))
     ORDER BY ts, rowid`,
  );
  const eventsForFlock = db.prepare("SELECT json FROM events WHERE run_id = '*' ORDER BY ts, rowid");
  const runSpan = db.prepare('SELECT MIN(ts) AS lo, MAX(ts) AS hi FROM events WHERE run_id = ?');

  const lastSeq = new Map<string, number>();
  let pending: StarlingEvent[] = [];
  let closed = false;
  let microtaskQueued = false;
  let backgroundError: unknown;

  const seqFor = (runId: string): number => {
    const cached = lastSeq.get(runId);
    if (cached !== undefined) return cached;
    const row = maxSeq.get(runId) as CountRow | null;
    const value = row?.m ?? 0;
    lastSeq.set(runId, value);
    return value;
  };

  const resetSeq = (events: readonly StarlingEvent[]): void => {
    for (const event of events) lastSeq.delete(event.runId);
  };

  const writeOne = (event: StarlingEvent): void => {
    const seq = seqFor(event.runId) + 1;
    lastSeq.set(event.runId, seq);
    try {
      insertEvent.run(event.runId, seq, event.ts, event.type, JSON.stringify(event));
    } catch (err) {
      throw storeError(`could not append ${event.type} event for run ${event.runId}: ${detailOf(err)}`, err);
    }
  };

  /** One transaction for a whole batch; on failure the seq cache is rewound with the rollback. */
  const writeBatch = (batch: readonly StarlingEvent[]): void => {
    try {
      db.transaction(() => {
        for (const event of batch) writeOne(event);
      })();
    } catch (err) {
      resetSeq(batch);
      if (err instanceof StarlingError) throw err;
      throw storeError(`could not write ${batch.length} events: ${detailOf(err)}`, err);
    }
  };

  const flushPending = (): void => {
    if (closed || pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      writeBatch(batch);
    } catch (err) {
      pending = batch.concat(pending);
      throw err;
    }
  };

  const scheduleFlush = (): void => {
    if (microtaskQueued) return;
    microtaskQueued = true;
    queueMicrotask(() => {
      microtaskQueued = false;
      if (closed) return;
      try {
        flushPending();
      } catch (err) {
        // A microtask must not throw into the event loop; surface it on the next store call instead.
        backgroundError = err;
      }
    });
  };

  const assertOpen = (): void => {
    if (closed) throw storeError('store is closed');
    if (backgroundError !== undefined) {
      const err = backgroundError;
      backgroundError = undefined;
      throw err instanceof StarlingError ? err : storeError('background write failed', err);
    }
  };

  const takeBackgroundError = (): void => {
    if (backgroundError === undefined) return;
    const err = backgroundError;
    backgroundError = undefined;
    throw err instanceof StarlingError ? err : storeError('background write failed', err);
  };

  const parseRun = (json: string, id: string): Run => {
    const parsed = RunSchema.safeParse(safeJson(json, `run ${id}`, id));
    if (!parsed.success) {
      throw storeError(
        `stored run ${id} is not a valid Run: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      );
    }
    return parsed.data;
  };

  /**
   * A recording contains the run's own events plus the flock events from its lifetime. `node.*`
   * events are stored under `'*'` (they are not run-scoped), so without this merge an exported run
   * would lose its murmuration. The window comes from the saved run when there is one, otherwise
   * from the run's own first/last event, so a raw import exports just like a recorded run.
   */
  const rowsForExport = (runId: string): JsonRow[] => {
    if (runId === '*') return eventsForFlock.all() as JsonRow[];
    const row = selectRun.get(runId) as JsonRow | null;
    if (row === null) {
      const span = runSpan.get(runId) as { lo: number | null; hi: number | null } | null;
      if (span?.lo == null || span.hi == null) return [];
      return eventsForRunWithFlock.all(runId, span.lo, span.hi) as JsonRow[];
    }
    const run = parseRun(row.json, runId);
    return eventsForRunWithFlock.all(runId, run.startedAt, run.finishedAt ?? null) as JsonRow[];
  };

  return {
    saveRun(run) {
      assertOpen();
      flushPending();
      const parsed = RunSchema.safeParse(run);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw storeError(
          `refusing to save an invalid Run: ${first?.path.join('.') ?? '<root>'}: ${first?.message ?? 'invalid'}`,
        );
      }
      try {
        upsertRun.run(run.id, run.status, run.startedAt, JSON.stringify(run));
      } catch (err) {
        throw storeError(`could not save run ${run.id}: ${detailOf(err)}`, err);
      }
    },

    getRun(id) {
      assertOpen();
      flushPending();
      try {
        const row = selectRun.get(id) as JsonRow | null;
        return row === null ? undefined : parseRun(row.json, id);
      } catch (err) {
        if (err instanceof StarlingError) throw err;
        throw storeError(`could not read run ${id}: ${detailOf(err)}`, err);
      }
    },

    listRuns() {
      assertOpen();
      flushPending();
      try {
        return (listRunsStmt.all() as JsonRow[]).map((row) => {
          const parsed = RunSchema.safeParse(safeJson(row.json, 'run', '?'));
          if (!parsed.success) throw storeError('a stored run is not a valid Run');
          return parsed.data;
        });
      } catch (err) {
        if (err instanceof StarlingError) throw err;
        throw storeError(`could not list runs: ${detailOf(err)}`, err);
      }
    },

    appendEvent(event) {
      assertOpen();
      pending.push(event);
      if (pending.length >= FLUSH_THRESHOLD) flushPending();
      else scheduleFlush();
    },

    appendEvents(events) {
      assertOpen();
      if (events.length === 0) return;
      flushPending();
      writeBatch(events);
    },

    events(runId, sinceTs) {
      assertOpen();
      flushPending();
      try {
        const events = (eventsForRun.all(runId) as JsonRow[]).map((row) => parseEvent(row.json, runId));
        return sinceTs === undefined ? events : events.filter((event) => event.ts >= sinceTs);
      } catch (err) {
        if (err instanceof StarlingError) throw err;
        throw storeError(`could not read events for run ${runId}: ${detailOf(err)}`, err);
      }
    },

    exportJsonl(runId, path) {
      assertOpen();
      flushPending();
      try {
        writeJsonl(
          path,
          rowsForExport(runId).map((row) => parseEvent(row.json, runId)),
        );
      } catch (err) {
        if (err instanceof StarlingError) throw err;
        throw storeError(`could not export run ${runId}: ${detailOf(err)}`, err);
      }
    },

    flush() {
      takeBackgroundError();
      flushPending();
    },

    close() {
      if (closed) return;
      takeBackgroundError();
      flushPending();
      closed = true;
      try {
        db.close();
      } catch (err) {
        throw storeError(`could not close ${path}: ${detailOf(err)}`, err);
      }
    },
  };
}

function safeJson(json: string, what: string, id: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    throw storeError(
      `stored ${what} ${id === '?' ? '' : `(${id}) `}is not valid JSON: ${detailOf(err)}`,
      err,
    );
  }
}

function parseEvent(json: string, runId: string): StarlingEvent {
  return safeJson(json, 'event', runId) as StarlingEvent;
}
