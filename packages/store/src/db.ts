/**
 * Opening and preparing the SQLite database used by the store.
 *
 * Kept apart from `sqlite-store.ts` so the connection pragmas, schema and version check can be
 * read (and tested) without the `Store` implementation around them.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StarlingError } from '@starling/core';

/** Bumped only when the SQLite layout changes; `PRAGMA user_version` is the whole migration story. */
export const STORE_SCHEMA_VERSION = 1;

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

export function storeError(message: string, cause?: unknown): StarlingError {
  return new StarlingError('STORE_ERROR', message, { cause });
}

export function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Open (or create) the store database at `path` in WAL mode, create the schema, and check
 * `user_version`. A database written by a newer Starling is refused rather than silently misread.
 * `':memory:'` works and is what the tests use.
 */
export function openStoreDatabase(path: string): Database {
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

    const mark = db.query('PRAGMA user_version').get() as { user_version: number } | null;
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

  return db;
}
