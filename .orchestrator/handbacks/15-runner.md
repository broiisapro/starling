## Epic 15 Handback — opencode runner

**Status:** Complete. Branch `epic/15-runner` @ `2152e16`.

**Delivered:**

- `createOpencodeRunner(options)` in `packages/runner/src/opencode/runner.ts`, implementing the
  core `AgentRunner` port plus `url(): string` and `health(): Promise<boolean>`.
  - `spawn`: reserves a free port, starts `opencode serve --port … --hostname 127.0.0.1` with
    `OPENCODE_SERVER_PASSWORD` in the child env, waits for the `server listening on …` line and a
    healthy `GET /api/info`, kills the child on `close()` (SIGTERM → SIGKILL) and on `process.exit`.
  - `attach`: uses an existing server; never spawns or kills anything.
- `start()` creates a directory-scoped session (`location.directory` + `x-opencode-directory`),
  splits `ModelRef` into `{providerID, id}`, emits `session.started`, opens the SSE stream, admits
  the prompt asynchronously and returns `sessionId`. `send()` continues the session; `abort()`
  calls `/api/session/{id}/interrupt`.
- `src/opencode/normalize.ts`: `SessionV1` event → `AgentEvent` mapping for all eight kinds
  (`session.started`, `text`, `tool.call`, `tool.result`, `file.edited`, `usage`, `session.idle`,
  `session.error`), per-session text debounce (default 500 ms, flush on idle/error), tool state
  mapping, step-finish usage, directory attribution for server-wide `file.edited`.
- One SSE subscription per runner, demultiplexed by session id; exponential-backoff reconnect with
  `GET /api/session/active` resync that emits an idle missed while disconnected.
- `Semaphore`-backed `maxConcurrentPrompts` (default 8), keyed per session so steer prompts reuse
  a slot.
- `src/opencode/client.ts`: handwritten typed v2 client (fetch-injectable) for the six routes in
  the doc, Basic auth, error mapping to `StarlingError('RUNNER_ERROR')`.
- `src/sse.ts`: incremental SSE parser + stream reader; `src/schedule.ts`: injectable scheduler and
  abortable sleep.
- `createReplayRunner({events, clock?, speed?})`: array/JSON/JSONL input, zod validation, timing
  scaled by `speed`, runId/taskKey/sessionId remap, real timers by default, `tick()`-driven with a
  `FakeClock`, `done()` and `close()`.
- Tests: in-process `Bun.serve({port: 0})` fake of the six real endpoints
  (`test/fake-opencode.ts`) and 52 passing tests covering start→events→idle, model/directory
  scoping, send, abort, error, semaphore queueing, two-session demux, SSE drop/reconnect, resync
  idle, text debounce, SSE parsing, client auth/errors, spawn/attach/startup failure/timeout, and
  ReplayRunner timing with `FakeClock`. `runner.live.test.ts` exists behind `STARLING_LIVE=1` and
  was not run.
- Recorded the installed API: `test/fixtures/openapi.json` (opencode 2.1.2, 119 paths) and
  `test/fixtures/opencode-cli.txt` (`--version`, `--help`, `serve --help`).
- `docs/epic-15-runner.md` with the endpoint table, SDK-vs-handwritten comparison, exported
  signatures and a usage snippet.

**Key design decisions:**

- **Handwritten client, not `@opencode-ai/sdk@1.19.4`.** The SDK's v2 types use `properties`
  payloads and `session.next.*` events; the installed server sends `data` payloads and
  `SessionV1` names. Prompt bodies differ too (`{parts}` vs `{text}`), and the SDK's routes are
  the older `/session/...` family. Adapting two event models would be more code than the client.
- **Password through `OPENCODE_SERVER_PASSWORD`.** The server's documented input; when set, the
  server does not print it, so diagnostics logs cannot leak it.
- **`session.started` is emitted from the create response, not `session.created`.** SSE is
  volatile; the event must not depend on the stream being open.
- **`session.error` is followed by `session.idle`.** The engine advances on idle (ARCHITECTURE
  §4); error alone would strand a task. Idle is deduped so the server's own idle does not double.
- **`start()` returns before prompt admission.** Matches the port's "asynchronously"; keeps the
  semaphore from delaying session creation; a rejected prompt becomes `session.error`.
- **`file.edited` is attributed by directory.** The real payload has no `sessionID`; Starling's
  one-worktree-per-task model makes this unambiguous.
- **Sync factory + async readiness.** `createOpencodeRunner` returns immediately (URL known in
  spawn mode), every operation awaits one stored `#ready`, and startup failures are stored rather
  than creating unhandled rejections.
- **Replay with a custom clock is timer-free.** `tick()` after `clock.advance()` is deterministic;
  the default `systemClock` path uses real timers and honours recorded spacing.
- **`standalone` is a no-op.** `opencode serve` rejects `--standalone` on 2.1.2 and its default
  mode is already a private server.
- **Package tsconfig includes `test/**/*.ts`** so the fake server and tests are typechecked by the
  root check.

**Verification (exact commands + results):**

- `bun install` → `Checked 133 installs across 192 packages (no changes) [11.00ms]`; no
  `bun.lock` change.
- `bun test packages/runner` → `52 pass, 1 skip, 0 fail, 126 expect() calls; Ran 53 tests across 10 files.`
  The skip is `runner.live.test.ts` (STARLING_LIVE gate).
- `bun run test` (root) → `237 pass, 1 skip, 0 fail, 910 expect() calls; Ran 238 tests across 46 files.`
- `bun run typecheck` (all 18 workspaces) → exit 0.
- `bunx biome check packages/runner` → `Checked 25 files … No fixes applied.`
- `bun run check` → **fails only on 9 pre-existing formatting errors outside this lane**:
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, and 7 files under
  `tools/local-models/**` (Epic 02). None are touched by this branch; `packages/runner` is clean.
  The typecheck half of `bun run check` passes when run separately.
- `pgrep -f 'opencode serve'` after the full suite → no output (no process left behind). The one
  real server used for the protocol probe was stopped and its probe session deleted.
- Protocol probe: `opencode --version` → `2.1.2`; `/doc` serves the web app, `/openapi.json`
  returns 401 without auth and the full 3.1 document with Basic auth; `GET /api/event` produced
  `server.connected` and `session.created` frames (no prompt sent).

**Dependencies added:** none. `@opencode-ai/sdk@1.19.4` remains in `packages/runner/package.json`
because Epic 00 pre-installed it; this package does not import it (see the decision above).

**CONTRACT REQUESTS:** none. The runner implements the Wave 0 `AgentRunner` port verbatim and
needs no core change. Two conventions future epics should know (not contract changes):
1. the runner emits `session.started` itself, so the engine/node should not synthesise one;
2. `session.error` is always followed by `session.idle`, so consumers that treat error as terminal
   must dedupe or ignore the idle.

**Deliberately deferred / out of scope:**

- Choosing which node runs a task (Flock, E30) and prompt content (E13) — untouched.
- Answering opencode `permission.asked` / `question.asked` — the runner ignores them; an agent that
  needs approval waits until the task times out. Dashboard wiring is a later epic.
- Reasoning/compaction/retry events — not in `AgentEventKind`, deliberately ignored.
- A real prompt — `runner.live.test.ts` was written but not run (L23).
- Retrying a racy free-port reservation — startup fails loudly instead.
- Multi-session replay — one session per `ReplayRunner` instance.
- Budget enforcement — usage is emitted; the LLM router/engine owns the ceiling.

**Open questions / flagged tradeoffs:**

- Should the `AgentRunner` port eventually expose `health()`/`url()`? E30's `LocalNode` needs them;
  today it can type against `OpencodeRunner` (which extends the port) without a core change.
- `maxConcurrentPrompts` defaults to 8 to match the hub's `hubMaxSessions`; E30 may want to drive
  it from config. It is a plain option today.
- Text is debounced at 500 ms, so the dashboard sees chunks rather than tokens. Lowering
  `textDebounceMs` is the knob if the Sky view wants a typing effect.

Closes #9
