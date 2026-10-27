# Epic 40 — Integration captain: the real end-to-end run

**Branch** `epic/40-integration-captain` · **Issue** #27 · **Lane** `apps/cli/src/{compose.ts,real/**,
commands/{run,plan,status,dash,options}.ts,render/**}`, `packages/core/**` (additive), `fixtures/real/**`

## Goal

Wave 1 built twelve packages that each pass their own tests and a CLI that could only run the mock
composition. This epic makes `starling run` real: one composition root that wires every package, a
genuine run of the sky-todo demo that ends with audited, merged, test-green work on an integration
branch, and the smallest correct fix for every place where the packages did not fit together.

The deliverable is not just "it ran". It is the **list of things that were wrong**, because those are
the things no single-package test could see.

## How it works

### The composition root (`apps/cli/src/compose.ts` → `real/compose-real.ts`)

`compose(config, { mode })` stays the only mock/real switch every command uses. `mode: 'real'` now
calls `composeReal`, which builds — **in this order, because order matters**:

1. **The opencode runner.** `createOpencodeRunner({ mode, password })`. In `spawn` mode it owns a
   *private* `opencode serve` on a free port with a generated password; the configured
   `opencode.port` is deliberately ignored (see the deviations).
2. **The effective config.** `applyProfile(config, profile)` where profile is
   `STARLING_LLM_PROFILE`, else the caller, else **`opencode`** — this machine has no DeepSeek key
   (L25/L29). Then the `opencode` provider's `baseUrl` is patched to `runner.url()` (the runner's
   port is only known at runtime), and the password is handed over through the LLM router's env map.
3. **Store + recorder.** `createSqliteStore('<repo>/.starling/starling.db')` and
   `attachRecorder(bus, store)`. The engine writes through `createRecorderOwnedStore(store)`, a
   facade whose `appendEvent` is a no-op, because the engine *also* appends to its store and the
   naive wiring doubles every event.
4. **Ports.** `createLLM`, `createRepoMapper`, `createPlanner`, `createPromptCompiler`,
   `createWorkspace` (wrapped so each new worktree gets a `node_modules` link), `createAuditor`,
   `createMerger` (wrapped so the integration worktree gets one too).
5. **The flock.** `createRegistry` + the hub's own `createLocalNode({ id: 'hub' })` +
   `createScheduler` + `createFlockHub`, with `startHubHeartbeat` keeping the hub node's `lastSeen`
   fresh (nobody else speaks for it, unlike a perch).
6. **The engine**, `createEngine({ ...ports, tracker, writer, bundleUrlFor })`. `bundleUrlFor`
   closes over a mutable `hubUrl`; `setHubUrl()` lets `starling run` point it at the server that
   actually bound a port instead of the configured guess.

Everything that owns a resource pushes a teardown onto a LIFO `DisposalStack`; `close()` runs it,
and `starling run` calls it from `finally` after handling `SIGINT`/`SIGTERM` as a cancellation.

### The commands

| Command | What changed |
| --- | --- |
| `starling run` | Real by default; `--mock` keeps the Wave 1 demo stack. `--budget <usd>` sets the per-run cap, `--github` turns the tracker on, `--fully-open` selects the `local` profile. Starts the dashboard (`startServer`) unless `--no-dash`, prints the URL, then the summary, the repo + integration branch and `git log` hint. |
| `starling plan` | Real by default. `--json` prints **only** `{ plan, issues }` on stdout; progress goes to stderr, because the agent skill pipes stdout into `jq`. |
| `starling status` | Reads the repo's SQLite store (`--repo`, additive) instead of an in-memory store; `--file` still replays a recording. |
| `starling dash` | Serves the repo's store + the §6 REST/SSE API from a read-only `EngineApi`; `POST /api/runs` answers 501 with a pointer to `starling run`. |

### The run

`maxParallel: 3`, `budget: $5`, profile `opencode`, `--no-dash`, recorded to
`fixtures/real/quick-wins.jsonl`:

```
✔ 5 merged  ·  ✘ 0 failed  ·  0 conflicts
api $0.223  ·  local $0
branch starling/3rcdzr/integration          (7m 11s)
```

and the 7-item `launch-day` goal on a second demo repo, recorded to `fixtures/real/launch-day.jsonl`.

## Key decisions & reasoning

- **`opencode` is the default profile, not `deepseek`.** L29 says real calls go through the user's
  opencode server; `parseProfile(undefined)` returns the *library* default (`deepseek`), so the
  composition checks the env var itself and defaults to `opencode`. Consequence: `STARLING_LLM_PROFILE=deepseek`
  still works for anyone with an API key.
- **A private server on a free port.** The first attempt pinned `opencode.port` (4096) and collided
  with the user's own `opencode serve` → 401s against *their* server. A spawned runner is private by
  definition, so it now lets `createOpencodeRunner` pick a free port; the config port describes the
  server a human runs, which is what `doctor` and `attach` mode want.
- **Worker/resolver model refs are split in the composition.** Under the `opencode` profile a
  `ModelRef` is `{ provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }`. The *LLM router*
  splits that; the *runner* passes the ref straight to opencode as `{ providerID, id }`. Rather than
  teach the runner about the LLM package's convention, the composition rewrites the two refs that
  only opencode consumes.
- **`node_modules` is linked into worktrees and excluded locally.** A worktree has no dependencies,
  so `bun test` inside one dies on `happy-dom`. Linking is one `symlinkSync`. It is *not* covered by
  `.gitignore`'s `node_modules/` (trailing slash = real directory only), so the first real run
  committed the symlink and every task failed its lane check. The composition now appends a
  `node_modules` rule to `.git/info/exclude` — local, uncommitted, shared by every worktree.
- **The merger gets a decorator, not a fork.** `withMergerDependencies` prepares the integration
  worktree (dependency link) *inside* a serial queue and exposes that queue as the port's `merge`.
  Two reasons: a fresh worktree has no `node_modules`, and — found only under load — the engine calls
  `merge` as soon as a task passes audit, so two tasks finishing together ran `git merge` in the same
  worktree and the loser died on `index.lock` (then `failed`, with no retry). `@starling/merger`
  already ships the serial queue as the production path; the composition just routes the engine
  through it. The alternative — a `mergeStart` hook on the port — is a contract change for one caller.
- **The recorder is the single writer of the event log.** `RunDriver.publish` appends *and*
  publishes; `attachRecorder` appends again. Dropping the engine's own append (a five-method facade)
  keeps the JSONL/SQLite log 1:1 with the bus, which is what `starling status` and any future export
  assume.
- **Recordings are clipped, then capped.** Agent payloads are the transcript of the whole repo;
  every string in an `agent.event` is truncated to 400 chars, and past 5 MB only lifecycle events are
  kept (the recording still replays to a real summary). The cap is printed by `starling run`.
- **`--budget` is an override, not a refusal.** It replaces `budget.maxUsd` for the run; the engine
  already stops dispatching when the ledger reaches it. That matches the skill's request (#27) and
  keeps one enforcement point.

### Integration bugs this epic found and fixed

Every one of these was invisible to per-package tests and blocked or degraded the real run.

1. **`packages/llm`, opencode provider** — a *session* is a coding agent. Given the planner prompt
   on 2.1.2 it starts exploring the workspace and `/api/session/{id}/generate` answers `text: ''`, so
   the planner never produced JSON ("did not produce JSON matching the schema after 3 attempts").
   `POST /api/experimental/generate` is a bare model call; it is now the primary path, with the
   session flow as the fallback for older servers.
2. **`packages/runner`, EventNormalizer** — 2.1.2 streams `session.text.*`, `session.step.*`,
   `session.tool.*` and `session.usage.updated`; there is no `message.part.*` on a live server. Every
   real session therefore produced exactly two events (`session.started`, `session.idle`): no agent
   text in the dashboard, no tool calls, and `$0.000` in the cost meter. Both vocabularies are
   handled now (`usage.updated` only — `step.ended` repeats the totals).
3. **Hub node went offline 15 s into every run.** `createRegistry.sweep()` marks a node offline when
   its `lastSeen` is stale; perches heartbeat, the hub had nobody to do it. `real/hub-heartbeat.ts`.
4. **Integration worktree had no dependencies** → `tests-failed` on every merge. `real/merger-deps.ts`.
5. **`node_modules` symlink committed by `commitAll`** → lane violation on every task.
   `ensureNodeModulesIgnored`.
6. **Double-appended event log** (`attachRecorder` + the engine's own append). `real/engine-store.ts`.
7. **Concurrent merges collided on `.git/index.lock`.** The engine calls `merger.merge` directly, so
   two tasks that finish auditing together merge into the same integration worktree at once; the
   loser throws, and the engine marks it `failed` without a retry. It surfaced as a 50% flake in the
   full suite (`compose-real.test.ts`) and would have hit any real run with two simultaneous merges.
   The composition now hands the engine the merger's own serial queue (`real/merger-deps.ts`), with
   the dependency link inside the serialised section; `merger-deps.test.ts` asserts the peak
   concurrency is 1.

## Interfaces for future epics

- **`Composition`** gained three optional members: `close?()`, `setHubUrl?(url)`, and (via
  `compose.ts`) a single `composition(overrides)` entry point with `{ config, repoPath, budgetUsd,
  github, profile }`. Mock compositions simply omit `close`.
- **`composeReal(config, options): RealComposition`** — `options` carries production knobs
  (`repoPath`, `env`, `profile`, `budgetUsd`, `github`) and test seams (`llm`, `runner`, `store`,
  `storePath`, `worktreeRoot`). `RealComposition` exposes `flock`, `store`, `bus`, `engine`,
  `profile`, `worktreeRoot`, `runnerUrl`, `hubNode`, `setHubUrl`, `close`.
- **`real/` modules are reusable pieces**: `paths.ts` (store/worktree/recording locations),
  `dispose.ts` (LIFO teardown), `dashboard.ts` (`startDashboard`, `resolveWebDist`),
  `readonly-engine.ts`, `hub-heartbeat.ts`, `workspace-deps.ts`, `merger-deps.ts`, `recording.ts`.
- **Core (additive, Epic 40 is the owner):** `TaskRun.nodeName?`, the `run.status` event
  (`{ from, to, run }`), `MergeQueueProps.selectedTask?`, `SkyViewProps.paused?`. Epic 49 should
  publish `run.status` on every run-status change; Epic 41 should consume it; Epic 55 should prefer
  `nodeName` over selector-mapped names.
- **Dashboard (E41):** the bus is the only live source and `store.events(runId)` is the backlog;
  `POST /api/runs` is only live in a `starling run` process. The store lives at
  `<repo>/.starling/starling.db` and holds one row per published event.
- **Flock (E42):** the hub's join URL is `http://localhost:<server.port>` until `setHubUrl` is called
  with the bound server URL; `bundleUrlFor` uses that plus `flock.code`. A perch-side `LocalNode`
  inherits the dependency-link and heartbeat patterns here.
- **Engine (E49):** `TaskRun.worktreePath` is never set, so the auditor falls back to the hub repo
  (see limitations); publishing `nodeName` and `run.status` belongs there. **The engine should merge
  through a serial queue itself** (`merger.queue().enqueue`) — today the CLI composition guarantees
  serialisation, but any other embedder that calls `merger.merge` twice concurrently hits
  `index.lock` and loses the task.
- **Doctor (E61):** `real/paths.ts` + `DEFAULT_REAL_PROFILE` are the single source of truth for the
  store location and the profile default.

## Deviations from plan

- **Files touched outside the strict lane**, all minimal and listed in the handback:
  `packages/llm/src/providers/opencode.ts` (+ its test) and `packages/runner/src/opencode/normalize.ts`
  (+ tests) — blocking, with FIX REQUESTS filed instead of a rewrite; two arms in
  `apps/web/src/data/{reducer,demo}.ts` so the new `run.status` arm keeps the exhaustive switches
  compiling; `apps/cli/package.json` (workspace deps), `program.ts` (new flags), `context.ts`
  (`stderr`, config overrides, `writeErr`), and the CLI's own tests.
- **`starling run --record` uses a compacting recorder** instead of the plain one, per the 5 MB cap.
- **The dashboard is not started by `starling dash` with an engine.** Launching runs from a dashboard
  process needs the engine to be constructed from values the dashboard has (a repo, a goal), which is
  E41's launch form.
- **`--fully-open` is wired but not exercised live** — L23/L31 forbid loading local models during a
  build wave.
- **The planner chose 6 tasks for the 7-item launch-day goal** (it folded keyboard shortcuts and
  help into neighbours). The plan is the model's; the epic checks what the model produced, not what
  the prompt file hoped for.

## Known limitations / deferred

- **The auditor runs tests in the hub repo, not the task worktree.** `AuditInput.run.worktreePath`
  is never populated by the engine and `TaskHandle` has no path, so `createAuditor` falls back to
  `ctx.goal.repoPath`. Consequence: the `tests` check proves the *base* repo is green, while the
  merge queue is what actually proves the merged result. FIX REQUEST for E49 + E30.
- **No `run.status` events yet**, so the run picker shows `mapping` until `run.finished` (E49's job,
  the event exists).
- **opencode completions report no token usage.** `/api/experimental/generate` returns text only, so
  planner/auditor/writer turns cost `$0.000` in the meter; agent sessions *do* report real usage
  (`session.usage.updated`), which is the bigger half. FIX REQUEST for `packages/llm`.
- **`estimatedSavedUsd` stays 0** on the opencode profile: nothing runs on a local model, so there is
  nothing to save.
- **Single-machine only.** Perches, mDNS and bundle transfer are E42's; `bundleUrlFor` needs
  `setHubUrl` with a LAN-reachable URL before a remote node can fetch anything.
- **No conflict resolver** (E45): a conflicted merge stops at `conflict`.
- **A worktree without dependencies still fails its own suite.** The link is a convenience for the
  agent; a fresh clone of the demo repo needs `bun install` like any JS project.
- **`fixtures/real/*.jsonl` are demo recordings, not golden tests.** They replay through the same
  reducer as any other recording; no test asserts their exact contents.

## Verification

```bash
bun run test          # root: packages + apps/server + apps/cli + skills/integrations/tools/evals, then apps/web
bun run check         # biome + tsc per workspace
bun run starling run "<quick-wins goal>" --repo /tmp/sky-e2e-1 --no-dash --max-parallel 3 \
  --budget 5 --record fixtures/real/quick-wins.jsonl
git -C /tmp/sky-e2e-1 log --oneline starling/3rcdzr/integration | head
cd <integration worktree> && bun test
```

Results are pasted in `.orchestrator/handbacks/40-integration-captain.md`. The merge-port fix (item 7)
landed after both real runs, so `bun run test` was re-run five times for `apps/cli` and twice for the
whole package suite to confirm the race is gone; the recordings above are unchanged and still replay.
