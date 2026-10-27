# Epic 15 — opencode runner

## Goal

Give Starling one thing to call when it needs an agent: the `AgentRunner` port from
`@starling/core`, implemented on top of a real opencode server. One `opencode serve` process, one
session per task in that task's worktree, prompts in and normalised `AgentEvent`s out (text, tool
calls, file edits, usage, idle, errors). Plus `ReplayRunner`, so the dashboard and the engine can
be driven from a recording with no model and no network.

The epic is deliberately narrow: **no real prompt is sent during Wave 1** (L23). Everything below
is exercised against an in-process fake server whose shapes were taken from the installed
opencode's own OpenAPI document.

## How it works

### The installed server (what we integrated against)

`opencode --version` is **2.1.2**, a newer CLI than most public docs describe. Findings, captured
verbatim in `packages/runner/test/fixtures/opencode-cli.txt`:

- `opencode serve` is the **v2 API and web server**. Flags: `--hostname`, `--port`, `--cors`,
  `--service`, `--stdio`.
- `--standalone` is a **root** CLI flag for the TUI/run commands. `opencode serve --standalone`
  is rejected (`Unrecognized flag`). `serve` in its default mode already starts a private server;
  `--service` is the managed-background-service mode, which Starling does not use.
- The server prints `server listening on http://127.0.0.1:<port>` on stdout.
- Auth is HTTP Basic with username `opencode` and the server password. The password is read from
  `OPENCODE_SERVER_PASSWORD` when the server starts (and then is *not* printed), otherwise one is
  generated and printed as `server password …`.
- Sessions are scoped to a directory with `location.directory` in `POST /api/session`; the server
  also understands the `x-opencode-directory` header, which we send on every call.

The OpenAPI document (`GET /openapi.json`, Basic auth) is committed at
`packages/runner/test/fixtures/openapi.json` (opencode `2.1.2`, 119 paths). The six routes this
package uses are listed in **Interfaces for future epics** below.

### Spawn / attach

`createOpencodeRunner` is a synchronous factory. It returns immediately with a usable `url()`:

- **spawn**: reserve a free port with `Bun.serve({port: 0})`, generate a password (or take
  `opts.password` / `OPENCODE_SERVER_PASSWORD`), start
  `opencode serve --port <p> --hostname 127.0.0.1` with the password in the child's environment,
  read the listening line, then poll `GET /api/info` until healthy. `start()`/`send()`/`abort()`
  await that readiness; `health()` reports it. `close()` sends SIGTERM, waits up to 3 s, then
  SIGKILL. A `process.on('exit')` hook SIGKILLs the child if the hub dies, and is removed on
  `close()`.
- **attach**: uses `opts.url` (required) and optionally `opts.password`. Nothing is spawned and
  nothing is killed.

`standalone` is accepted for API compatibility and is a **no-op**: on 2.1.2 `serve` is already a
private server, and the root flag is rejected by the subcommand.

### Sessions and prompts

`start({runId, taskKey, dir, prompt, model, title})`:

1. `POST /api/session` with `{title, location: {directory: dir}, model: {providerID, id}}`, split
   from the core `ModelRef` (`provider` → `providerID`, `model` → `id`). The create call is
   awaited; a failure throws `StarlingError('RUNNER_ERROR')`.
2. Register the session with the normaliser, which immediately emits `session.started` with
   `{title, model}` — not waiting for the server's `session.created` frame, which could be missed
   during a reconnect.
3. Open the SSE stream (once per runner) and wait for the first connection (or a 5 s timeout).
4. Mark the turn outstanding and admit the prompt **in the background**, then return `sessionId`.
   A saturated `maxConcurrentPrompts` semaphore therefore never delays session creation.

`send(sessionId, prompt)` continues the same session and awaits admission (it is the fixer path,
where the previous turn has already idled). `abort(sessionId)` calls
`POST /api/session/{id}/interrupt`; if the server reports `interrupted: false` the session was
already idle, so an idle is emitted to unblock the caller.

### Event pipeline

One `GET /api/event` SSE subscription per runner. Frames are
`data: {"id","created","type","location"?,"data",…}`. `readSse` parses the stream, `OpencodeClient`
parses the JSON, and `EventNormalizer` demultiplexes by `data.sessionID` into the runId/taskKey
registered for that session:

| opencode event | Starling `AgentEvent` | `data` |
| --- | --- | --- |
| `session.created`, `session.execution.started` | `session.started` | `{title?, model?}` (normally already emitted on register) |
| `message.part.delta` (`field: "text"`) | `text` (debounced) | `{text}` |
| `message.part.updated` (`part.type: "text"`) | `text` (final) | `{text}` |
| `message.part.updated` (`part.type: "tool"`, `pending`/`running`) | `tool.call` | `{tool, args, callId}` |
| `message.part.updated` (`part.type: "tool"`, `completed`/`error`) | `tool.result` | `{tool, ok, summary, callId}` |
| `file.edited` / `part.type: "patch"` | `file.edited` | `{path}` |
| `message.part.updated` (`part.type: "step-finish"`) | `usage` | `{input, output, cached, costUsd}` |
| `session.idle`, `session.status{idle}`, `session.execution.succeeded/interrupted` | `session.idle` | `{}` |
| `session.error`, `session.execution.failed` | `session.error` then `session.idle` | `{name, message}` |

Text is debounced per session: deltas are merged and flushed at most once per
`textDebounceMs` (default 500 ms), and immediately before an idle or error. A server that sends
only `message.part.updated` (no deltas) is also supported: the unseen suffix of the part text is
appended to the same buffer.

`file.edited` is server-wide — its payload only has `file`, no `sessionID`. Starling gives every
task its own worktree, so the normaliser attributes it by `location.directory`. If two sessions
share a directory, both receive the event (documented limitation).

### Concurrency

`maxConcurrentPrompts` (default 8) caps agent turns, not sessions. A turn acquires a slot before
its prompt is admitted and releases it on idle, error or abort. Slots are keyed by session, so a
steer prompt to a running session reuses its slot.

### Reconnection

The SSE loop reconnects with exponential backoff (`minMs` 100, `maxMs` 2 000, factor 2, all
configurable). After each drop it sleeps, then polls `GET /api/session/active` and emits a
`session.idle` for every registered session whose turn is outstanding but no longer active — the
resync that recovers an idle missed while disconnected. It then reconnects. Stream-end (server
closed the response) and transport errors take the same path.

### Replay

`createReplayRunner({events, clock?, speed?})` accepts an `AgentEvent[]` or a path to a JSON array
or JSONL file, validates every event with `AgentEventSchema`, and replays it with
`dueAt = startNow + (event.ts - baseTs) / speed`, remapping `runId`, `taskKey` and `sessionId`.

- Default clock: real timers honour the recorded spacing.
- Custom clock (`FakeClock`): no timers are created; call `tick()` after advancing the clock. This
  is what makes replay tests deterministic and leak-free.
- `done()` resolves when the recording is exhausted; `close()` stops playback.
- `send()`/`abort()` emit a terminal `session.idle` (a recording has nothing more to play), so an
  engine replaying a run does not hang on a fixer loop.

## Key decisions & reasoning

- **Handwritten client instead of `@opencode-ai/sdk@1.19.4`.** The installed SDK does ship a
  `./v2` entry point, but it does not match the installed server:
  - SDK v2 event payloads are under `properties` and use `session.next.*` event names; the server
    sends payloads under `data` and `SessionV1` event names (`message.part.delta`,
    `session.idle`, …). `session.next.*` does not appear in the server binary at all.
  - SDK `Session.prompt` takes `{parts: [...]}`; the server takes `{text}`.
  - The SDK's route surface is the older `/session/{id}/message` family; the server exposes
    `/api/session/{id}/prompt`, `/api/session/active`, `/api/event`.
  A thin `fetch` client is ~180 lines, fully typed, injectable, and testable against the fake
  server. Using the SDK would have meant adapting two incompatible event models anyway.
- **Password through the environment, never scraped.** `OPENCODE_SERVER_PASSWORD` is the server's
  documented input; when it is set the server does not print the password. Logs kept for
  diagnostics therefore cannot leak it.
- **`location.directory` + `x-opencode-directory`.** The v2 API scopes a session at creation; the
  header mirrors what the official SDK's per-client `directory` option does and covers routes that
  take a directory out-of-band.
- **`session.started` on register, not on `session.created`.** SSE is volatile (the server's own
  docs say events during disconnection are missed). Emitting it from the create response makes the
  event deterministic and keeps the UI's agent list correct even if the stream opens late.
- **Errors also emit idle.** The engine's state machine advances on `session.idle`
  (ARCHITECTURE §4). Emitting `session.error` alone would strand a task. The error event carries
  the detail; the idle unblocks. Dedupe means the server's own idle does not duplicate it.
- **Debounce at the normaliser, not the runner.** The buffer, timer and flush-on-idle live next to
  the event mapping, so they are unit-testable with an injected scheduler and cannot leak timers
  when a session dies.
- **`start()` does not await prompt admission.** The port says "send the prompt asynchronously and
  return sessionId". Doing so also means the semaphore queues turns without blocking session
  creation, and a rejected prompt becomes a `session.error` event rather than a `start()` failure
  (the session exists and the engine can retry or fail it).
- **Sync factory, async readiness.** `createOpencodeRunner` returns before the server is healthy so
  the port shape stays `AgentRunner & { url(); health() }`; every operation awaits a single
  `#ready` promise that stores startup failures instead of producing unhandled rejections.
- **Replay is tick-driven on a custom clock.** Real timers plus `FakeClock` cannot be made
  deterministic without polling; making the custom-clock path timer-free keeps the test suite fast
  and leak-free while the default path still honours real time.
- **Tests are in the package's tsconfig.** `packages/runner/tsconfig.json` includes `test/**/*.ts`
  so `bun run typecheck` checks the fake server and every test, not just `src/`.
- **The OpenAPI fixture is committed formatted.** It is evidence for the endpoint table and for
  future protocol changes; Biome owns its formatting like any other checked-in file.

## Interfaces for future epics

### Exported from `@starling/runner`

```ts
export const PACKAGE: '@starling/runner';

export function createOpencodeRunner(options: OpencodeRunnerOptions): OpencodeRunner;

export interface OpencodeRunner extends AgentRunner {
  url(): string;
  health(): Promise<boolean>;
}

export interface OpencodeRunnerOptions {
  mode: 'spawn' | 'attach';
  url?: string;                 // required for attach
  port?: number;                // spawn; free port when omitted
  password?: string;            // defaults to OPENCODE_SERVER_PASSWORD, then random
  standalone?: boolean;         // accepted, no-op on opencode 2.1.2 (see above)
  bus?: EventBus;               // lifecycle logs as `log` events with runId '*'
  clock?: Clock;
  spawn?: typeof Bun.spawn;
  fetch?: typeof fetch;
  maxConcurrentPrompts?: number;  // default 8
  textDebounceMs?: number;        // default 500
  command?: string;               // default 'opencode'
  startupTimeoutMs?: number;      // default 20_000
  healthPollMs?: number;          // default 100
  streamReadyTimeoutMs?: number;  // default 5_000
  reconnect?: { minMs?: number; maxMs?: number; factor?: number };
}

export function createReplayRunner(options: ReplayRunnerOptions): ReplayRunner;

export interface ReplayRunner extends AgentRunner {
  tick(): void;                  // emit events whose virtual due time has passed
  done(): Promise<void>;
  readonly replayed: number;
  readonly remaining: number;
}

export interface ReplayRunnerOptions {
  events: AgentEvent[] | string; // array, JSON array file, or JSONL file
  clock?: Clock;
  speed?: number;                // default 1
  schedule?: Scheduler;          // override the real timer
  newSessionId?: () => string;
}

export class OpencodeClient { /* createSession, prompt, interrupt, serverInfo,
                                 activeSessions, openEventStream, parseEvent, headers */ }
export class EventNormalizer { /* register, unregister, markPromptSent, handle,
                                  resync, flush, flushAll, fail, idle, dispose */ }
export class Semaphore { /* acquire(): Promise<() => void>; active; pending; max */ }
export function createSseParser(): SseParser;
export function readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage>;
export function sleep(ms: number, signal?: AbortSignal): Promise<void>;
export const timerScheduler: Scheduler;
```

`AgentRunner` is the core port verbatim — no local mirror is needed because `packages/runner`
implements a Wave 0 port rather than meeting a Wave 1 sibling.

### Usage

```ts
import { createEventBus } from '@starling/core';
import { createOpencodeRunner } from '@starling/runner';

const bus = createEventBus();
const runner = createOpencodeRunner({ mode: 'spawn', bus, maxConcurrentPrompts: 8 });

const off = runner.onEvent((event) => {
  // event: { runId, taskKey, sessionId, ts, kind, data }
  bus.publish({ type: 'agent.event', runId: event.runId, ts: event.ts, payload: event });
});

const { sessionId } = await runner.start({
  runId: 'run_01',
  taskKey: 't03-csv-export',
  dir: '/Users/me/.starling-worktrees/t03',
  prompt: 'Implement CSV export …',
  model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  title: 'CSV export',
});

// On audit failure, keep the same session:
await runner.send(sessionId, 'The audit failed: add tests for the empty CSV case.');

// On cancel:
await runner.abort(sessionId);

off();
await runner.close(); // kills a spawned server; leaves an attached one alone
```

Attach to a server the user already runs:

```ts
const runner = createOpencodeRunner({
  mode: 'attach',
  url: 'http://127.0.0.1:4096',
  password: process.env.OPENCODE_SERVER_PASSWORD,
});
```

Replay a recording with a fake clock (tests) or real time (demos):

```ts
import { FakeClock } from '@starling/core';
import { createReplayRunner } from '@starling/runner';

const clock = new FakeClock(0);
const replay = createReplayRunner({ events: 'fixtures/agent-events.jsonl', clock, speed: 4 });
await replay.start({ runId: 'demo', taskKey: 't01', dir: '.', prompt: '', model, title: 'Demo' });
clock.advance(10_000);
replay.tick();
await replay.done();
```

### The exact endpoint table of the installed server

From `packages/runner/test/fixtures/openapi.json` (opencode **2.1.2**, `opencode HttpApi` 0.0.1).
Every route requires `Authorization: Basic base64("opencode:" + password)`.

| Method | Path | operationId | Used for | Request | Response |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/info` | `server.info` | health, version | — | `ServerInfo` `{version, pid, urls, paths}` |
| `POST` | `/api/session` | `session.create` | create a task session | `{title?, model?: {providerID, id, variant?}, location?: {directory}}` | `{data: Session.Info}` |
| `POST` | `/api/session/{sessionID}/prompt` | `session.prompt` | admit a prompt (agent loop runs async) | `{text, files?, agents?, skills?, metadata?, delivery?, resume?}` | `{data: Session.Inbox.User}` |
| `POST` | `/api/session/{sessionID}/interrupt` | `session.interrupt` | abort the active turn | `{}` (optional `?resume=`) | `{interrupted: boolean}` |
| `GET` | `/api/session/active` | `session.active` | reconnect resync | — | `{data: {[ses_id]: {type: "running"}}}` |
| `GET` | `/api/event` | `event.subscribe` | the event stream | — | `text/event-stream`; `data:` is one event |

SSE envelope on 2.1.2:

```json
{"id":"evt_…","created":1793117790822,"type":"session.created","location":{"directory":"/repo"},"data":{"sessionID":"ses_…"},"durable":{"aggregateID":"ses_…","seq":0,"version":1}}
```

Event payloads we consume (from the server's `SessionV1` schemas): `session.created` /
`session.updated` `{sessionID, info}`; `message.part.delta`
`{sessionID, messageID, partID, field, delta}`; `message.part.updated` `{sessionID, part, time}`;
`file.edited` `{file}` (no `sessionID`); `session.idle` `{sessionID}`; `session.status`
`{sessionID, status: {type: "idle" | "retry" | "busy"}}`; `session.error`
`{sessionID, error: {name, data?: {message}}}`. Tool parts carry
`{type: "tool", callID, tool, state: {status: "pending" | "running" | "completed" | "error",
input, output?, error?}}`; usage comes from `{type: "step-finish", cost, tokens:
{input, output, reasoning, cache: {read, write}}}`.

### SDK vs handwritten client (the note the assignment asks for)

`@opencode-ai/sdk@1.19.4` is installed (Epic 00 pre-installed it) and has both a v1 surface and a
`./v2` entry. **Neither matches the installed server**, so this package uses
`src/opencode/client.ts`:

| | SDK 1.19.4 (`./v2`) | Installed server 2.1.2 |
| --- | --- | --- |
| session create | `POST /session` | `POST /api/session` |
| prompt | `POST /session/{id}/message` with `{parts}` | `POST /api/session/{id}/prompt` with `{text}` |
| events | `/event`, payload under `properties`, `session.next.*` | `/api/event`, payload under `data`, `SessionV1` names |
| interrupt | `POST /session/{id}/abort` | `POST /api/session/{id}/interrupt` |
| active sessions | — | `GET /api/session/active` |

The fake server in `test/fake-opencode.ts` implements exactly the six routes above, so a future
protocol change shows up as a failing test rather than a silent mismatch.

## Deviations from plan

- **`createOpencodeRunner` is synchronous** (returns the runner, with async readiness) instead of
  returning a promise. The requested signature is not async; a sync factory keeps `url()` usable
  immediately and pushes the wait to `start()`/`health()`.
- **`standalone` is a no-op.** The installed `serve` rejects `--standalone`; its default mode is
  already a private server.
- **`createReplayRunner` has two extra optional knobs** (`schedule`, `newSessionId`) beyond
  `events`/`clock`/`speed`, for deterministic tests.
- **`session.error` is followed by `session.idle`.** Not in the letter of the deliverable, but the
  engine only advances on idle.
- **`file.edited` is attributed by directory**, because the server's payload has no session id.
- **Tests are included in the package tsconfig** so they are typechecked by the root check.
- **The OpenAPI fixture is 456 KB of formatted JSON** rather than a trimmed excerpt; it is the
  primary evidence for the endpoint table.

## Known limitations / deferred

- **No real prompt was sent during this epic** (L23). `runner.live.test.ts` exists behind
  `STARLING_LIVE=1` and has not been run.
- **Text is debounced, not streamed token-by-token.** The UI gets at most two text events per
  second per session. If the dashboard wants typing animation later, lower `textDebounceMs`; the
  SSE deltas are already merged in order.
- **Reasoning parts, compaction, retries and agent/model switches are ignored.** They are not in
  the `AgentEventKind` union. A future contract addition can map them without touching the runner's
  plumbing.
- **`file.edited` cannot be attributed when two sessions share a directory.** Starling's one
  worktree per task makes this a non-issue in production; the fallback emits for every matching
  session.
- **The free-port reservation is racy.** `Bun.serve({port: 0})` is stopped before `opencode serve`
  binds; another process could take the port in between. The server then exits and startup fails
  loudly; a retry loop is deferred.
- **The spawned server is killed with SIGTERM then SIGKILL; opencode's own graceful shutdown is
  not awaited.** `close()` waits up to 3 s.
- **Attach mode does not verify the server version.** A v1 server would fail at the first
  `/api/session` call with a `RUNNER_ERROR` naming the route.
- **Permissions/questions are not answered.** opencode may emit `permission.asked` or
  `question.asked`; the runner ignores them, so an agent that needs approval will sit until the
  task times out. Wiring those to the dashboard is a later epic (the engine/auditor loop does not
  need it for the demo tasks).
- **`ReplayRunner` supports one session per instance.** A run with a fixer loop needs a second
  instance or a recording that already contains both turns.
- **No cost ceiling inside the runner.** Usage events are emitted; budget enforcement belongs to
  the engine/LLM router.
