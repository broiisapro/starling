# Epic 49 — Robustness + engine ownership

## Goal

Make the flock survive a live demo: agents that stop talking, providers that rate-limit, budgets
that run out, perches that vanish, and a presenter who hits Ctrl-C twice. Every self-healing action
is visible on the event bus with a stable code, and the engine's public surface did not change for
the CLI, server or dashboard.

The epic also owns `packages/engine` outright this wave, carried three items over from Wave 1, and
finished the two threads Wave 1 deliberately left dangling: the stalled-session path and the
paused-because-of-a-perch-loss path.

## How it works

### One opencode client (carryover 1)

`packages/runner`'s `OpencodeClient` is now the only V2 REST client in the repo. It grew the three
routes the LLM router needed (`generate`, `sessionInfo`, `deleteSession`), per-request signals and a
typed `rateLimited` flag with `Retry-After` parsing. `@starling/llm`'s `opencode` provider is a thin
recipe (create → generate → read tokens → delete) over that client and keeps
`createOpencodeCompletionClient`'s public signature. `packages/llm` depends on `@starling/runner`;
there is no cycle (runner depends only on core).

### Policy modules

All of them are small, pure where possible, and injectable:

| File | Responsibility |
|---|---|
| `src/policies/stall.ts` | per-task inactivity watchdog + `stallDecision` |
| `src/policies/parallelism.ts` | AIMD effective-parallelism limit |
| `src/policies/budget.ts` | 80% warning + hard stop, each action once |
| `src/policies/rate-limit.ts` | rate-limit detection in `session.error` |
| `src/policies/log.ts` | stable policy codes and the log payload builder |
| `src/run-status.ts` | feature-detected `run.status` event + `nodeName` + resume refs |

### Stall detection

Every dispatch arms a debounce timer (`StallWatchdog`) for its task. Every agent event pushes it
out; `session.idle` disarms it; a terminal transition disarms it.

When it fires while the task is `running` or `fixing`:

1. Log `stall.detected` (warn).
2. Spend one attempt (`TaskRun.attempts += 1`) — the spec's "counts as an attempt".
3. Bump the task generation so any in-flight pipeline step is discarded.
4. Abort the turn (`node.abort`) and resend **the prompt that was in flight** (`sendPrompt`), so a
   stall during the fix loop resends the fixer prompt, not the worker prompt.
5. If the session is gone or rejects the resend, log `stall.redispatch` and put the task back in the
   queue for a fresh session.
6. A second stall (or `maxStallRetries: 0`, or no attempt budget left) logs `stall.failed`, aborts
   best-effort and fails the task with a reason. Dependents are cancelled as usual.

`stallAfterMs` comes from `deps.policies.stallAfterMs`, else a feature-detected
`config.stallAfterMs`, else **4 minutes**. `0` disables the watchdog entirely.

### Rate limits

**Runner side.** One `ProviderRateLimiter` per runner: a **token bucket per provider** (capacity 4,
one token per 750 ms) that every session's prompt goes through. A 429/503 on a prompt POST, or a
rate-limit-looking `session.error`, calls `penalize()`: the bucket empties, a jittered exponential
backoff (1 s doubling, 60 s cap, ±25% jitter, a server `Retry-After` wins) blocks the whole provider,
and the prompt is retried once. Success resets the streak. Rate-limited `session.error` events are
annotated with `rateLimited: true`, `provider` and the applied `retryAfterMs` before they reach the
engine, and a bus log with code `runner.rate-limit` is emitted.

**Engine side.** A `session.error` that looks like a rate limit logs `rate-limit.backoff` and halves
the effective parallelism (`AimdLimit`, floor 1), logging `parallelism.reduced`. Once the provider
has been quiet for `rateLimitRecoverMs` (default 60 s), each merged task adds one back
(`parallelism.increased`). Dispatch uses `min(maxParallel, aimdLimit)`.

### Budget

`BudgetGuard` observes priced API spend from the run ledger:

- 80% (`budgetWarnRatio`) → one `budget.warn` log.
- 100% → one `budget.stop` log; no new task is dispatched. Running work drains.
- When the last active task settles, undispatched tasks are cancelled (`budget.skipped`) and recorded
  as **skipped**. `run.finished`'s summary (template and writer prompt) says
  `Budget cap $X reached: N task(s) skipped.`

The cap is, in priority order: an additive `StartRunInput.budgetUsd` (the `--budget` hook),
`deps.policies.budgetUsd`, `config.budget.maxUsd`. Local-model calls stay free.

### Kill switch

`cancel()` now:

1. Aborts every live session.
2. Calls `node.cleanup(handle)` so a local node releases its worktree and a perch deletes its copy.
3. Removes the hub-side worktree for every task whose worktree the engine still knows about (an
   unfinished task, an earlier failure, or a node-reported `handle.worktreePath`).
   **Branches are never deleted.**
4. Cancels every unfinished task, saves the run, finishes it as `cancelled`, and logs
   `cancel.cleanup` with the number of worktrees removed.

A second `cancel()` while the first is still running takes the forced path: log `cancel.forced`,
cancel every unfinished task, settle the run, skip the possibly-blocked filesystem waits. The CLI
owns the actual `process.exit` for the second Ctrl-C (out of scope — Epic 40).

### Perch loss

The reschedule path already kept `attempts`. It now also keeps **the latest collected commit** on
the live task:

- `collect` records the commit (`recordCollect`).
- On `node.left` / `NODE_OFFLINE`, `perch.loss` logs the commit (or says none was collected) and the
  task returns to `ready` with its attempts untouched.
- The next dispatch starts from the **task branch** when a commit exists (`fromRefFor`), not from the
  integration branch, and logs `perch.resume`. On a remote node that means a bundle of the task
  branch; on the local node `Workspace.create` attaches to the existing branch.
- Without a collected commit the task restarts from integration (nothing was lost).

### `run.status` and `nodeName` (carryover 2)

`run.status` is owned by core (Epic 40). Until it lands, `runStatusEvent()` builds five plausible
payload shapes and publishes the first one `StarlingEventSchema` accepts; none accepted → nothing is
published, so replay/contract validity is unchanged. Every run status change goes through
`#setRunStatus`.

`TaskRun.nodeName` is set from the registry at dispatch (and cleared when a task is rescheduled) as an
additive property; `nodeNameOf()` reads it back for the UI.

### Resolver hook (carryover 3)

Epic 45's PR was **not on main** when this epic finished (only its prompts/merger commits exist on
`epic/45-resolver`). `packages/engine/src/pipeline.ts` has a clearly marked `RESOLVER HOOK (Epic 45)`
block at the `case 'conflict'` arm with the exact intended code:
`conflict → fixing (resolver prompt) → auditing → merging`, gated by `maxAttempts`. `conflict` stays
terminal until that lands.

## Key decisions & reasoning

- **Per-task watchdog timers, not a polling interval.** A debounce expresses "no event for N ms"
  exactly, costs one timer per active task, and the injected `Timers.setTimeout` makes it
  deterministic under a fake clock. A poll would need a second interval beside the metrics heartbeat
  and would make every existing timing test ambiguous.
- **Abort + resend on the same session.** That is what a real opencode `interrupt` allows, and it
  keeps the agent's accumulated context. A node that cannot keep the session (the `MockNode` double)
  takes the `stall.redispatch` fallback instead of failing.
- **A stall spends an audit attempt.** Otherwise a wedged agent could stall forever on a fresh
  budget. `stallDecision` refuses a recovery when the recovery's own attempt would leave no room
  (`attempts + 1 > maxAttempts`); the next audit is `attempts + 1`, so a stall and an audit failure
  cannot both hide behind one number.
- **Token bucket per provider in the runner, AIMD in the engine.** The runner owns transport and can
  see 429s; the engine owns scheduling and knows how many sessions are in flight. Neither needs the
  other's internals: the runner annotates the event, the engine reacts to the annotation (and to
  untagged 429/503 text as a fallback).
- **Detection is duplicated (runner regex + engine regex) on purpose.** The engine talks only to
  ports (ARCHITECTURE §4); a regex is a smaller cost than a package dependency and keeps engine tests
  free of runner internals.
- **Budget stops dispatch, drains, then cancels the tail.** Wave 1 documented why leaving queued
  tasks forever is worse; this epic adds the 80% warning and makes the skip visible in the summary
  instead of only in a log line.
- **The second Ctrl-C is a state flag, not a kill.** The engine cannot call `process.exit` without
  ending the server for every other run, so it offers a fast, consistent forced path; the CLI decides
  when to exit.
- **`code` is additive on the log payload.** Core's payload is frozen (L30) and the log event is the
  only observability surface the UI already renders. The message also starts with `[code]` so a
  consumer that ignores unknown keys still shows it.
- **Feature detection via the schema, not a version check.** `StarlingEventSchema.safeParse` is the
  contract's own truth: the moment Epic 40 adds the arm, the engine starts publishing without a code
  change or a flag.
- **Worktree paths come from the node or from the host.** The locked `TaskHandle` has no worktree
  path, and the engine never creates worktrees. `deps.worktreePathFor` is a one-line host hook;
  a node that reports `handle.worktreePath` wins when present.
- **Resume from the task branch, not integration.** The branch is the durable artefact; restarting
  from integration would silently throw away a collected commit and redo work the audience just
  watched.

## Interfaces for future epics

```ts
// types.ts (additive EngineDeps fields)
export interface EnginePolicies {
  stallAfterMs?: number;        // default config.stallAfterMs ?? 240_000; 0 disables
  maxStallRetries?: number;     // default 1
  budgetUsd?: number;           // default StartRunInput.budgetUsd ?? config.budget.maxUsd
  budgetWarnRatio?: number;     // default 0.8
  rateLimitRecoverMs?: number;  // default 60_000
}
export interface EngineDeps {
  // …every existing field…
  policies?: EnginePolicies;
  worktreePathFor?: (branch: string) => string;   // cancel() cleanup
}

// policies/log.ts
export type PolicyCode =
  | 'stall.detected' | 'stall.retry' | 'stall.redispatch' | 'stall.failed'
  | 'rate-limit.backoff' | 'parallelism.reduced' | 'parallelism.increased'
  | 'budget.warn' | 'budget.stop' | 'budget.skipped'
  | 'cancel.cleanup' | 'cancel.forced'
  | 'perch.loss' | 'perch.resume';
export function policyLogPayload(code, level, msg, taskKey?): PolicyLogPayload;

// policies/stall.ts
export class StallWatchdog { track(key); touch(key); untrack(key); stop(); readonly size: number }
export function stallDecision(input: { stallRetries; attempts; maxAttempts; maxStallRetries? }): 'retry' | 'fail';
export const DEFAULT_STALL_AFTER_MS = 240_000;
export function stallAfterMsFrom(config: StarlingConfig): number;

// policies/parallelism.ts
export class AimdLimit { readonly limit: number; onRateLimit(): AimdChange | undefined; onProgress(): AimdChange | undefined }

// policies/budget.ts
export class BudgetGuard { observe(costUsd): { warn: boolean; stop: boolean }; readonly stopped: boolean }

// policies/rate-limit.ts
export function rateLimitSignal(event: AgentEvent): RateLimitSignal | undefined;

// run-status.ts
export function runStatusEvent(runId, ts, from, run, accept?): StarlingEvent | undefined;
export function runStatusCandidates(runId, ts, from, run): Array<{…}>;
export function nodeNamePatch(info: NodeInfo): Partial<TaskRun> & { nodeName: string };
export function nodeNameOf(task?: TaskRun): string | undefined;
export function fromRefFor(source: { commit?: string; branch: string }, integrationBranch: string): string;

// runner (packages/runner)
export class OpencodeClient {
  generate(sessionId, { prompt, directory?, signal? }): Promise<string>;
  sessionInfo(sessionId, { signal? }?): Promise<OpencodeSessionInfo>;
  deleteSession(sessionId, { signal? }?): Promise<void>;
}
export class ProviderRateLimiter {
  acquire(provider, signal?): Promise<void>; penalize(provider, retryAfterMs?): number;
  reward(provider): void; tokens/waitMs/blockedFor/snapshot;
}
export function detectRateLimit(data): RateLimitSignal | undefined;
export function annotateRateLimit(data, fallbackProvider, penalize): { data; signal? };
export function rateLimitFromError(err): RateLimitSignal | undefined;
export function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined;
```

Host wiring (Epic 40 composition):

```ts
const deps: EngineDeps = {
  …,
  policies: { stallAfterMs: config.stallAfterMs, budgetUsd: flags.budget, maxStallRetries: 1 },
  worktreePathFor: (branch) => worktreePathFor(config.worktreeRoot, branch),
};
const runner = createOpencodeRunner({ mode, url, rateLimit: { capacity: 4 } });
// second SIGINT: await engine.cancel(runId); await engine.cancel(runId); process.exit(130);
```

## Deviations from plan

- **`worktreePathFor` is a host hook rather than node bookkeeping.** `TaskHandle` is locked and has no
  worktree field, and the engine never calls `Workspace.create` (LocalNode does). The hook, plus
  feature-detecting `handle.worktreePath`, is the smallest way to satisfy "removes worktrees" today.
- **The second Ctrl-C does not exit the process from inside the engine.** The engine may host a
  server with other runs; only the CLI can decide to exit. The engine's forced path (and its test) is
  the part this lane owns.
- **The stall policy uses per-task timeouts instead of a single watchdog interval.** See the key
  decisions; `Timers.setTimeout` was added additively, and implementations without it fall back to
  global timers.
- **`run.status` publishes only when core's schema accepts a candidate shape.** The epic prompt asked
  for feature detection; this is stricter than a version flag and cannot emit an event that would
  fail `StarlingEventSchema` in a replay.
- **`run.status` candidates include five payload shapes** because Epic 40's exact payload was not on
  main. The intended one (`{ from, to, run }`, or `{ status, previous, run }`) is first; the extras
  cost nothing and disappear once the contract exists.
- **Rate-limit text detection is duplicated in engine and runner** (see key decisions).
- **AIMD is fed by `session.error` only.** A hard 429 on `startTask` is handled by the runner's own
  backoff; if it still fails, the task fails or migrates rather than shrinking the cap.

## Known limitations / deferred

- **A single long tool call can look like a stall.** The watchdog counts any agent event; a tool that
  emits nothing for `stallAfterMs` (4 min by default) triggers one recovery. Raise `stallAfterMs` for
  repos with slow builds. Documented, not fixed: opencode has no heartbeat for a running tool.
- **`lastCommit` lives in the run's in-memory `LiveTask`.** A process restart loses the resume hint
  (the branch and its commit still exist in the repo). Run recovery across restarts is still out of
  scope.
- **Worktree removal is best-effort.** A failure is logged (`could not remove worktree …`) and cancel
  still finishes; the orphan is harmless because the branch is the deliverable.
- **Telemetry `code` is additive until core's log payload gains the field.** The message is prefixed
  with `[code]` meanwhile.
- **No conflict resolver yet.** The hook is marked in `pipeline.ts`; `conflict` stays terminal.
- **Budget is priced-API-only.** Unpriced models report `$0` (core `PRICING`), exactly as the Wave 1
  cost meter does; local calls are free by design.
- **`run.status`/`nodeName` are feature-detected, not core-owned.** A future core may rename the
  payload fields; the engine's candidate probe will simply keep publishing nothing until updated.
- **The runner's backoff blocks the prompt path.** A provider that asks for a long pause holds that
  session's semaphore slot; other providers keep flowing because buckets are per provider.

## Verification

- `bun test packages/engine packages/runner packages/llm` — 290 pass, 4 skip, 0 fail (see the
  handback for the exact groups).
- `bun run test` (root) — packages + web both green.
- `bun run check` — Biome + `tsc --noEmit` per workspace, clean.
- No network in unit tests: the runner/LLM client tests use in-process `Bun.serve` fakes; no real
  opencode, LLM or GitHub call is made.
