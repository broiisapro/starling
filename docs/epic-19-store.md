# Epic 19 — Store + record/replay

## Goal

Persist every Starling event and every `Run` snapshot in SQLite, export a run as a JSONL recording,
and replay that recording with its original timing. This is the demo safety net: the dashboard can
show a complete seven-task murmuration with no engine, no network and no model calls when the venue
wifi dies — and it gives the engine, server and CLI a durable history to read back.

Lane: `packages/store/**` only. No sibling Wave 1 package is imported; the only dependency is
`@starling/core` plus Bun's built-in `bun:sqlite`.

## How it works

| file                  | what it does                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/sqlite-store.ts` | `createSqliteStore(path)`: WAL SQLite `Store` implementation, per-run `seq`, buffered transactional writes            |
| `src/jsonl.ts`        | `importJsonl` / `parseJsonl` / `serialiseJsonl` / `writeJsonl`; line-numbered zod validation                          |
| `src/derive.ts`       | `deriveRun` / `deriveRunState` / `createRunAccumulator`: pure reducer from events to the latest `Run` (+ flock nodes) |
| `src/replayer.ts`     | `createReplayer`: re-publishes a recording on an `EventBus`, timing scaled by `speed`, optional `runId` rewrite       |
| `src/recorder.ts`     | `attachRecorder(bus, store)`: persist every event, save the `Run` on the three snapshot events                        |
| `src/index.ts`        | public surface; `PACKAGE` kept from the skeleton                                                                      |

### SQLite schema

```sql
CREATE TABLE runs   (id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL, type TEXT NOT NULL, json TEXT NOT NULL,
                     PRIMARY KEY (run_id, seq));
CREATE INDEX events_run_seq ON events (run_id, seq);
PRAGMA user_version = 1;   -- the whole migration story for Wave 1
```

- File stores open in WAL mode with `synchronous=NORMAL` and a 5 s busy timeout; the parent directory
  is created on demand. `':memory:'` is supported for tests.
- `appendEvent` assigns `seq = max(seq for run) + 1`, cached in memory per run.
- Writes are queued and flushed **in one transaction** when 64 events are pending, at the end of the
  current microtask, or whenever anything reads (`events`, `getRun`, `listRuns`, `exportJsonl`,
  `flush`, `close`). The synchronous `Store` API therefore never returns stale data, while a replay
  burst costs one transaction per batch instead of one per event.
- A background (microtask) flush failure is stored and re-thrown on the next store call instead of
  crashing the event loop.
- `events(runId, sinceTs?)` is the run's own stream, ordered by `seq`; `sinceTs` is inclusive.
- `listRuns()` is newest first (`started_at DESC, id DESC`).

### Recordings

`exportJsonl(runId, path)` writes the run's events **plus the flock events from the run's lifetime**,
in recording order (`ts`, then insertion rowid). Flock `node.*` events are stored under the `'*'`
run id because they are not run-scoped (ARCHITECTURE §6); without this merge an exported run would
lose its nodes, and the fixture's 252 events would round-trip as 239. The lifetime window is the
saved run's `startedAt..finishedAt`; if the run was never saved, the run's own first/last event
timestamps are used. `exportJsonl('*', path)` exports just the flock bucket.

`importJsonl` validates every line with `StarlingEventSchema` and throws `StarlingError('STORE_ERROR')`
naming the 1-based file line on the first bad JSON or bad event.

### Reducer

`deriveRun(events)` folds a stream into a `Run`:

- `run.created` / `run.finished` replace the snapshot (the final snapshot wins, exactly);
- `plan.created` installs the plan and moves `mapping|planning → planned`;
- `task.status` installs the task snapshot and moves `mapping|planning|planned → running`;
- `audit.verdict` stores `lastVerdict`; `merge.result` sets `merged` / `conflict`;
- `metrics` replaces metrics; `task.migrated` sets the task's `nodeId`;
- `node.joined|stats|left` maintain the flock nodes seen (`Run` has no node field, so
  `deriveRunState` returns `{ run, nodes, eventCount, lastTs }`).

Input events are never mutated and every returned snapshot is a deep clone.

### Replay

`createReplayer({ events, bus, clock?, speed?, newRunId? })`:

- delay between events = `max(0, ts[i] - ts[i-1]) / speed`, capped at `MAX_REPLAY_GAP_MS` (2 s);
- `speed: Infinity` publishes everything back-to-back; speed ≤ 0 or `NaN` throws `INVALID_ARGUMENT`;
- event timestamps are preserved (the dashboard shows the recorded timeline);
- with a real `Clock` (default `systemClock`) delays are real timers; with a `FakeClock` (anything
  with `advance(ms)`) the same delays advance virtual time instead, making tests deterministic and
  instant while still asserting scaled timing;
- `newRunId` rewrites `runId` on every run-scoped event and the run/`TaskRun` ids inside
  `run.created`, `run.finished`, `task.status` and `agent.event`; `'*'` flock events stay `'*'`;
- `stop()` drops pending events and resolves `done`; `done` never rejects (a throwing publisher
  surfaces through `start()`).

## Key decisions & reasoning

- **Buffered writes with read-through flushing.** A transaction per event is simple but pays a
  commit per event; a pure async queue would make `events()` lie. Flushing on read gives synchronous
  consistency _and_ batching. Measured 442k events/s for 10k individual `appendEvent` calls on the
  M5 Pro, ~220× the 2,000/s requirement.
- **Per-run `seq` plus a table-wide rowid.** The contract asks for a per-run monotonic `seq`; SQLite's
  implicit rowid gives a free global insertion order, which is what makes export ordering
  (`ts`, then rowid) reproduce the fixture exactly without adding a column.
- **Export merges the `'*'` flock bucket over the run window.** Rejected alternatives: storing node
  events under the active run (wrong for a hub with two runs), exporting only the run bucket (loses
  the murmuration and breaks the required round trip), exporting _all_ flock events (imports later
  runs' node events into early recordings). The window keeps multi-run databases sane.
- **`deriveRun` treats `run.finished` as authoritative.** The engine publishes full snapshots; a
  reducer that re-derives final state from partial events would drift from the engine. The fixture
  test asserts `deriveRun(recording) === recording.run.finished.payload.run`.
- **`FakeClock` means virtual time.** The `Clock` port only has `now()`, so the replayer duck-types
  `advance(ms)`. This is the only way to honour "replay at speed 100 with FakeClock emits all 252
  events with scaled timing" without a 3.5 s sleep per test.
- **Validation boundaries.** Incoming runs are validated on `saveRun` (a bad snapshot must not poison
  the history); JSONL is validated line by line (the file is the untrusted boundary); event appends
  are trusted (typed API, hot path) and parsed back with a guarded `JSON.parse`.
- **Schema version via `PRAGMA user_version` only.** A newer database is refused loudly; no migration
  framework exists in Wave 1 by design.

## Interfaces for future epics

```ts
// packages/store/src/sqlite-store.ts
export const STORE_SCHEMA_VERSION = 1;
export interface SqliteStore extends Store {
  flush(): void;
  appendEvents(events: readonly StarlingEvent[]): void;
  close(): void;
}
export function createSqliteStore(path: string): SqliteStore; // ':memory:' supported

// packages/store/src/jsonl.ts
export function serialiseJsonl(events: readonly StarlingEvent[]): string;
export function writeJsonl(path: string, events: readonly StarlingEvent[]): void;
export function parseJsonl(text: string, source?: string): StarlingEvent[];
export function importJsonl(path: string): StarlingEvent[];

// packages/store/src/derive.ts
export interface DerivedRunState {
  run: Run | undefined;
  nodes: NodeInfo[];
  eventCount: number;
  lastTs: number | undefined;
}
export interface RunAccumulator {
  apply(event: StarlingEvent): void;
  state(): DerivedRunState;
  run(): Run | undefined;
}
export function createRunAccumulator(initialEvents?: readonly StarlingEvent[]): RunAccumulator;
export function deriveRun(events: readonly StarlingEvent[]): Run | undefined;
export function deriveRunState(events: readonly StarlingEvent[]): DerivedRunState;

// packages/store/src/replayer.ts
export const MAX_REPLAY_GAP_MS = 2000;
export interface ReplayerOptions {
  events: StarlingEvent[];
  bus: EventBus;
  clock?: Clock;
  speed?: number;
  newRunId?: string;
}
export interface Replayer {
  start(): Promise<void>;
  stop(): void;
  done: Promise<void>;
}
export function createReplayer(opts: ReplayerOptions): Replayer;
export function rewriteEventRunId(event: StarlingEvent, newRunId: string): StarlingEvent;

// packages/store/src/recorder.ts
export function attachRecorder(bus: EventBus, store: Store): () => void; // returns unsubscribe
```

Usage the server (E21), CLI (E22) and dashboard (E23) can rely on:

```ts
import { createEventBus, systemClock } from '@starling/core';
import { attachRecorder, createReplayer, createSqliteStore, deriveRun, importJsonl } from '@starling/store';

const store = createSqliteStore('.starling/starling.db');
const bus = createEventBus();
const detach = attachRecorder(bus, store); // live run: every event is persisted

// `starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 4`
const events = importJsonl('fixtures/runs/sky-todo-launch-day.jsonl');
const replayer = createReplayer({ events, bus, clock: systemClock, speed: 4 });
await replayer.start();

const run = deriveRun(events); // fold the recording back into a Run
if (run !== undefined) store.exportJsonl(run.id, 'out.jsonl'); // a replayable recording
detach();
store.close();
```

Server wiring notes: `GET /api/runs/:id` → `store.getRun(id)`; `GET /api/runs` →
`store.listRuns()`; `GET /api/runs/:id/events` backlog → `store.events(id, since)`; `POST /api/replay`
→ `importJsonl` + `createReplayer`. `attachRecorder` is safe to leave subscribed for the process
lifetime; unsubscribe on shutdown.

## Deviations from plan

- **`events(runId)` does not include flock events.** It is the run's own stream ordered by `seq`, as
  specified. Flock context is added by `exportJsonl` (windowed) and available via `events('*')`.
- **Extra additive exports** beyond the brief: `deriveRunState`, `createRunAccumulator`,
  `rewriteEventRunId`, `parseJsonl`, `serialiseJsonl`, `writeJsonl`, `MAX_REPLAY_GAP_MS`,
  `STORE_SCHEMA_VERSION`, `SqliteStore` (`flush`, `appendEvents`). They keep the tested pieces
  reusable by the server/CLI and are all documented above.
- **Run validation on read as well as write.** Cheap for a run row, and it turns a corrupted database
  into a clear `STORE_ERROR` instead of a silent bad `Run`.
- **Exported recordings are normalised through zod on import**, so JSON object key order follows the
  schema rather than the source file. The round-trip test therefore compares normalised JSON, which is
  what the brief asks for; event order and content are identical.

## Known limitations / deferred

- `exportJsonl(runId)` includes every `'*'` flock event inside the run's window. Two runs recorded
  concurrently on the same database would each export the same flock events; run-scoping node events
  would need a contract change.
- A crash can lose up to 63 buffered events plus the current microtask's batch. `flush()`/`close()`
  are the durability points; the engine/server should call `close()` on shutdown.
- Reading events (`events`, export) parses JSON but does not re-validate every event through zod;
  imported recordings and typed appends are already validated. Hand-edited database rows are not
  defended against beyond the `JSON.parse` guard (run rows are validated).
- No schema migrations beyond `user_version = 1`, and no compaction/vacuuming of old runs. A future
  epic can add `PRAGMA user_version` steps in `createSqliteStore`.
- No retention policy: the database grows with every run and every agent event.
- Replay timing uses `setTimeout`, so real-time playback is accurate to roughly a timer tick; the
  virtual-clock path is exact.
- Server endpoints (`apps/server`), the web reducer (`apps/web`) and remote storage remain out of
  scope for this epic (Epics 21 and 23).
