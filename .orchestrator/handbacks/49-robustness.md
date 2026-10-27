## Epic 49 Handback — Robustness + engine ownership

**Status:** Complete. Branch `epic/49-robustness` (PR head), rebased on `origin/main`.

**Delivered:**
- **One opencode client.** `packages/runner/src/opencode/client.ts` is the single V2 REST client: added
  `generate()`, `sessionInfo()`, `deleteSession()`, per-request signals, `Retry-After` parsing and a
  typed `rateLimited` flag. `packages/llm/src/providers/opencode.ts` is now a thin
  create → generate → tokens → delete recipe over it and keeps `createOpencodeCompletionClient`'s
  signature. `packages/llm/package.json` depends on `@starling/runner` (no cycle).
- **Runner rate limits.** `packages/runner/src/opencode/rate-limit.ts` exports
  `ProviderRateLimiter` (token bucket **per provider**, capacity 4, 1 token/750 ms, jittered
  exponential penalty 1 s→60 s, server `Retry-After` wins), `detectRateLimit`,
  `rateLimitFromError`, `annotateRateLimit` and `looksRateLimited`. The runner acquires a token before
  every prompt, retries a 429 prompt once after the backoff, annotates rate-limited `session.error`
  events with `rateLimited/provider/retryAfterMs`, logs code `runner.rate-limit`, and exposes
  `onRateLimit`.
- **Engine policies (new files).**
  - `src/policies/stall.ts`: `StallWatchdog` (per-task debounce over injected `Timers`) +
    `stallDecision` + `stallAfterMsFrom`. No event for `stallAfterMs` → abort + resend the in-flight
    prompt once (spends one attempt); a second stall (or `maxStallRetries: 0`) → `failed` with a
    reason. Abort + resend on the same session; `stall.redispatch` fallback when the session is gone.
  - `src/policies/parallelism.ts`: `AimdLimit` (halve on a rate limit, floor 1; +1 per merged task
    after a quiet window). Dispatch uses `min(maxParallel, aimdLimit)`.
  - `src/policies/budget.ts`: `BudgetGuard` (80% warn once, 100% stop once). Running work drains, the
    undispatched tail is cancelled, and the summary names the skipped tasks.
  - `src/policies/rate-limit.ts`: `rateLimitSignal(event)` for engine-side AIMD (tagged or untagged
    429/503 + provider phrases).
  - `src/policies/log.ts`: stable `PolicyCode`s, `policyLogPayload`, `policyMessage`.
- **Kill switch.** `cancel()` aborts every session, calls `node.cleanup`, removes worktrees (node-
  reported `handle.worktreePath` first, else `deps.worktreePathFor(branch)`), keeps every branch,
  cancels unfinished tasks, saves, and finishes as `cancelled`. A concurrent second `cancel()`
  takes the forced path (`cancel.forced`) and settles the run. Removal failures are logged, never
  fatal.
- **Perch loss.** `collect` records the latest commit; `node.left`/`NODE_OFFLINE` keeps `attempts`
  and the commit, logs `perch.loss`, and the next dispatch starts from the **task branch**
  (`fromRefFor`) with `perch.resume` when a commit was collected.
- **Carryover 2.** Every run status change goes through `#setRunStatus` and publishes a `run.status`
  event **only when core's `StarlingEventSchema` accepts one of five candidate payloads**
  (`src/run-status.ts`); nothing is emitted while the arm is absent. `TaskRun.nodeName` is filled
  from the registry at dispatch, cleared on reschedule, readable via `nodeNameOf`.
- **Carryover 3.** A clearly marked `RESOLVER HOOK (Epic 45)` block at `pipeline.ts`'s `case
  'conflict'` with the exact intended flow. Epic 45's PR is not on main; `conflict` stays terminal.
- **Tests.** New: `policies/stall.test.ts`, `policies/parallelism.test.ts`, `policies/budget.test.ts`,
  `policies/rate-limit.test.ts`, `run-status.test.ts`, `engine-stall.test.ts`,
  `engine-rate-limit.test.ts`, `engine-budget.test.ts`, `engine-cancel-cleanup.test.ts`,
  `engine-perch-resume.test.ts`, `engine-observability.test.ts`, runner `rate-limit.test.ts`,
  runner `opencode-client.test.ts`. Harness gained `FakeTimers.fireTimeouts/pendingTimeouts`,
  `policyLogs()`, and `policies`/`worktreePathFor` options.

**Key design decisions:**
- **Per-task debounce timers instead of a poll loop** — exactly models "no event for N ms", one timer
  per active task, deterministic with `FakeTimers`; added `Timers.setTimeout/clearTimeout`
  additively (implementations without them fall back to global timers).
- **Stall recovery reuses the live session** — that is what opencode's `interrupt` supports and it
  keeps context; nodes whose abort destroys the session take an explicit redispatch fallback.
- **A stall spends one attempt** (`TaskRun.attempts += 1`); `stallDecision` refuses a recovery that
  would exceed `maxAttempts`. A stall during `fixing` resends the fixer prompt because the pipeline
  records the in-flight prompt.
- **Token bucket in the runner, AIMD in the engine** — transport knowledge and scheduling knowledge
  stay in their own lanes; the event annotation is the contract between them.
- **Regex detection is duplicated** in runner and engine on purpose: the engine imports ports only
  (ARCHITECTURE §4), so a regex beats a package dependency and keeps engine tests runner-free.
- **Budget: stop dispatch, drain, then cancel + count skipped** — full-stop was the only way to keep
  `waitForFinish` finite (Wave 1 precedent), now visible at 80%, 100% and in the summary.
- **The second Ctrl-C is a consistent fast path, not a process kill** — the engine may host a server
  with other runs; only the CLI may exit.
- **`code` rides on the log payload additively** and the message is prefixed `[code]`, so today's UI
  and replay keep working; core can adopt the field later without an engine change.
- **Feature detection through `StarlingEventSchema.safeParse`** — no version flags; the moment Epic 40
  lands the arm, `run.status` starts flowing.
- **Resume from the task branch** — the branch is the durable artefact; restarting at integration
  would throw away a commit the audience already watched being produced.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 163 installs across 221 packages (no changes)` — clean; `bun.lock`
  regenerated by bun for the new workspace dependency.
- `bun test packages/engine`: `163 pass, 0 fail, 589 expect() calls, 23 files`.
  - stall group (`policies/stall.test.ts` + `engine-stall.test.ts`): watchdog arm/touch/untrack/stop,
    decision table, 0-disable, recovery-on-same-session, fixer-prompt resend, second-stall failure,
    recovery-disabled failure.
  - AIMD group (`policies/parallelism.test.ts` + `engine-rate-limit.test.ts`): halving/floor/growth,
    quiet window, tagged and untagged 429s, ordinary errors ignored, `8 → 4` / `4 → 5` logs.
  - budget group (`policies/budget.test.ts` + `engine-budget.test.ts`): warn-once/stop-once,
    80%/100%, drain + skip summary, `budgetUsd` and `policies.budgetUsd` precedence.
  - kill switch (`engine-cancel-cleanup.test.ts`): abort + cleanup + worktree removal + branch kept +
    store consistent, node-reported path preferred, second Ctrl-C forced path, removal failure.
  - perch loss (`engine-perch-resume.test.ts`): attempts kept, commit kept, resume `fromRef` = task
    branch, no-commit case still starts from integration.
  - observability (`engine-observability.test.ts`): nodeName on TaskRun and on `task.status`, no
    `run.status` while core lacks it, `[code]` prefix on every policy log.
- `bun test packages/runner packages/llm`: `127 pass, 4 skip, 0 fail, 364 expect() calls, 20 files`
  (the 4 skips are the pre-existing `*.live.test.ts`).
- `bun run test` (root): packages — `1424 pass, 4 skip, 0 fail` across 175 files (23 snapshots, 6494
  expect() calls); web — `426 pass, 0 fail` across 39 files (3527 expect() calls).
- `bun run check`: Biome `Checked 726 files … No fixes applied`; per-workspace `tsc --noEmit` loop
  completed with no output (clean).
- Live checks: **none run** by design (L23/L29: no real LLM, opencode server or GitHub calls in this
  wave); the runner/LLM HTTP tests use in-process `Bun.serve` fakes.

**Dependencies added:** `@starling/runner@workspace:*` in `packages/llm` (no new npm packages; no
hand edits to `bun.lock`).

**FIX REQUESTS (lanes I don't own):**
1. `packages/core/src/contracts.ts` (**Epic 40**): add the `run.status` arm to `StarlingEventSchema`,
   ideally `{ type: 'run.status', runId, ts, payload: { from: RunStatus; to: RunStatus; run: Run } }`
   (the engine's first candidate is `{status, previous, run}`). Also add `code?: string` to the `log`
   payload. The engine already feature-detects both and will start publishing/using them with no
   further change.
2. `packages/core/src/config.ts` (**Epic 40**): add
   `stallAfterMs: z.number().int().nonnegative().default(240_000)` (feature-detected today) and
   optionally `budget.warnRatio`.
3. `packages/core/src/handshake.ts` (**Epic 40**): add `budgetUsd?: number` to `StartRunInput` so the
   CLI `--budget` flag has a typed home (the engine already reads an additive `budgetUsd`).
4. `packages/flock` (**Epic 42**): put `worktreePath?: string` on `TaskHandle` (the engine currently
   feature-detects the property and otherwise needs `deps.worktreePathFor` from the host).
5. `packages/engine` composition in `apps/cli` (**Epic 40**): pass
   `policies: { stallAfterMs, budgetUsd: flags.budget }` and
   `worktreePathFor: (branch) => worktreePathFor(config.worktreeRoot, branch)`; wire the second SIGINT
   to `await engine.cancel(runId)` twice and then `process.exit(130)`.
6. Epic 45: wire the marked resolver hook once its PR lands (code sketch is in `pipeline.ts`).

**CONTRACT REQUESTS:** the `run.status` arm and `log.payload.code` above (both additive), plus
`StartRunInput.budgetUsd` and `TaskHandle.worktreePath`.

**Deliberately deferred / out of scope:**
- Resolver internals and wiring (Epic 45 unmerged; hook marked).
- CLI composition, `--budget` plumbing, the actual process exit on the second Ctrl-C (Epic 40).
- Flock transport/heartbeat changes (Epic 42); the engine consumes `node.left` as before.
- Run recovery after a process restart (still out of scope; `lastCommit` is in-memory on `LiveTask`).
- Persisting `nodeName`/policy codes as first-class contract fields (feature-detected instead).

**Open questions / flagged tradeoffs:**
- **`run.status` payload shape** is a guess among five candidates until Epic 40 fixes it; if the
  chosen shape is none of them, the engine will keep publishing nothing (safe, silent). Please confirm
  the shape when the core epic lands.
- **Stall semantics:** a recovery increments `attempts`, so the next audit is `attempts + 1` (a stall
  is attempt 1, the audit is attempt 2). If the product wants stalls tracked separately from audit
  verdicts, that needs a new `TaskRun` field (contract request).
- **4-minute default** matches the spec; a single tool call longer than that will trigger one
  recovery. Raise `stallAfterMs` for slow builds.
- **Budget uses priced API spend only** (same as the Wave 1 meter); unpriced models count as `$0`.
- **`worktreePathFor` is an engine-level host hook** rather than node bookkeeping because
  `TaskHandle` is locked; the flock fix request above would make it unnecessary.
