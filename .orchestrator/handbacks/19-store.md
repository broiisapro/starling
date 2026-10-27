## Epic 19 Handback — Store + record/replay
**Status:** Complete. Branch `epic/19-store` @ <sha filled at PR time>.

Closes #13

**Delivered:**
- `createSqliteStore(path): SqliteStore` (`packages/store/src/sqlite-store.ts`) on `bun:sqlite`: WAL + `synchronous=NORMAL` + busy timeout, `runs(id PK, status, started_at, json)`, `events(run_id, seq, ts, type, json)` with index `(run_id, seq)`, `PRAGMA user_version = 1` (refuses a newer schema).
- Per-run monotonic `seq`, upserting `saveRun`, newest-first `listRuns`, `events(runId, sinceTs?)` ordered by `seq` with inclusive `sinceTs`, and `StarlingError('STORE_ERROR')` on every failure path.
- Batched writes: events are queued and flushed in one transaction at 64 events, on every read, on `flush()`, and on `close()`. 10,000 individual `appendEvent` calls measured at **442k events/s** on this laptop (requirement: ≥ 2,000/s).
- `exportJsonl(runId, path)` / `importJsonl(path)` / `parseJsonl` / `serialiseJsonl` / `writeJsonl` (`src/jsonl.ts`): one compact event per line, zod-validated on import, first bad line reported with its 1-based line number as `STORE_ERROR`.
- `deriveRun(events): Run | undefined` plus `deriveRunState` and incremental `createRunAccumulator` (`src/derive.ts`): folds snapshots, plan, task statuses, verdicts, merges, metrics and migrations; tracks flock nodes seen (offline on `node.left`, back online on a later `node.stats`). Pure: inputs are never mutated, outputs are clones.
- `createReplayer({ events, bus, clock?, speed?, newRunId? })` (`src/replayer.ts`): scaled relative timing, 2 s idle-gap cap, `speed: Infinity`, real timers or virtual time via `FakeClock`, run-id rewriting that keeps `'*'` flock events un-scoped, `stop()` + `done`.
- `attachRecorder(bus, store)` (`src/recorder.ts`): persists every event and saves the derived `Run` on `run.created`, `task.status`, `run.finished`.
- Public surface re-exported from `src/index.ts`; package stays dependency-free beyond `@starling/core`.
- `docs/epic-19-store.md` (all required sections, exported signatures + a usage snippet) and this handback.

**Key design decisions:**
- **Read-through buffered writes** — a transaction per event is wasteful, an async-only queue makes `events()` lie. Queue + flush on read keeps the synchronous `Store` contract and still batches; background flush failures are re-thrown on the next call rather than crashing the event loop.
- **Per-run `seq` + table-wide rowid for export order** — satisfies the locked schema while making `ORDER BY ts, rowid` reproduce the fixture's original order byte-for-byte in content. No extra column.
- **Export merges the `'*'` flock bucket over the run window** — `node.*` events are not run-scoped (ARCHITECTURE §6), so a run-only export would lose the murmuration and round-trip 239/252 events. Window = saved run `startedAt..finishedAt`, falling back to the run's own first/last event when the run row is absent (raw import). Rejected: storing node events under the active run (wrong with two runs), exporting all `'*'` events (leaks later runs into earlier recordings).
- **`run.finished` is authoritative in the reducer** — the engine publishes full snapshots; inferring final state from partial events would drift. The fixture test asserts `deriveRun(recording) === recording.run.finished.payload.run`.
- **`FakeClock` = virtual time in the replayer** — the `Clock` port only has `now()`, so the replayer duck-types `advance(ms)`. Same timing maths, deterministic tests, no 3.5 s sleeps.
- **Validation boundaries** — runs validated on save and read; JSONL validated per line (untrusted file); event appends trusted on the hot path and guarded with `JSON.parse` on read.
- **No new dependencies** — `bun:sqlite`, `node:fs` and core's zod schemas are enough. No sibling Wave 1 package imported.

**Verification (exact commands + results):**
- `bun install` → `Checked 133 installs across 192 packages (no changes) [16.00ms]`
- `bun test packages/store` → **44 pass, 0 fail**, 646 `expect()` calls, 6 files — includes the 10k-event throughput test, fixture import→store→export round trip, `deriveRun` fixture story (7 tasks, all merged, theme fixed after a failed audit, search migrated), replay at speed 100 with `FakeClock` (252 events, scaled timing), idle-gap cap, `newRunId`, and recorder + replayer end to end.
- `bun run test` (root) → **229 pass, 0 fail**, 1430 `expect()` calls, 42 files.
- `bun run typecheck` → exit 0 for every workspace.
- `bun run check` → **Biome fails only on pre-existing files outside this lane**, unchanged from `origin/main` (verified with `git diff --name-only origin/main --`): `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,smoke,ollama,ollama.test}.ts`, `tools/local-models/results/*.json`. `bunx biome check packages/store docs/epic-19-store.md` → clean.
- Manual throughput check (quoted in the epic doc): 10k appends in 22.6 ms → 442,121 events/s.
- Fixture round trip: 252 events imported, stored, exported; normalised JSON equals `fixtures/runs/sky-todo-launch-day.jsonl` event-for-event and in order.

**Dependencies added:** none

**CONTRACT REQUESTS:** none. Noted for later: `Store.events(runId)` deliberately excludes `'*'` flock events (they are not run-scoped), so `apps/server` should merge `events('*')` for a complete per-run stream, as `exportJsonl` does internally. Changing that is a contract decision, not a store bug.

**Deliberately deferred / out of scope:**
- Server endpoints (Epic 21): `/api/runs*`, `/api/replay`, SSE backlog.
- Web reducer (Epic 23) — `deriveRun` is the reference to cross-check it against.
- Remote/cloud storage, retention/compaction, and migrations beyond `user_version = 1`.
- Run-scoped flock event storage (would need a contract change).

**Open questions / flagged tradeoffs:**
- Concurrent runs on one database share the `'*'` bucket, so each exported recording includes the same in-window flock events. Acceptable for the single-run demo; flagged in the epic doc's limitations.
- Crash durability is "up to 63 buffered events + the current microtask". `flush()`/`close()` are the durability points; the server should close the store on shutdown.
- Replay preserves event timestamps rather than rewriting them to replay time, so the dashboard shows the recorded clock. If the UI ever needs wall-clock replay time, that is an additive option on `ReplayerOptions`.
