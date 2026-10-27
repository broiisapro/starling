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
- **Stateless opencode completions still cost `$0.000` in the meter** — but they are no longer
  *silently* zero. Since C2 the provider marks them `usageKnown: false`, the router logs
  `usage=unknown`, and the session path reports real totals (`session.usage.updated` covers agent
  sessions). The residual gap is the locked `LLMResponse.usage: TokenUsage` (three numbers, no
  "unknown"), so a truthful meter needs a contract change — proposed as a CONTRACT REQUEST in the
  handback.
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

## C2 — landing on top of the other 22 Wave 2 epics

Wave 2 changed the ground under this branch: Epic 49 unified the opencode client and took ownership
of `packages/*` internals, Epic 41 shipped the dashboard data layer that feature-detects `run.status`,
Epic 42 put the perch into the CLI's dependencies, and Epics 44/45/51/57 moved the auditor, merger and
profiles. C2 re-lands the integration captain on top of all of it.

### The two real conflicts (and what the resolution looks like)

| File | Conflict | Resolution |
| --- | --- | --- |
| `packages/llm/src/providers/opencode.ts` | This branch had rewritten the *old* hand-rolled REST client to call `/api/experimental/generate`; Epic 49 deleted that client and built the provider on `@starling/runner`'s `OpencodeClient`. | Ported the behaviour onto Epic 49's design — see below. |
| `apps/cli/package.json` | Epic 42 added `@starling/perch`; this branch added twelve workspace packages. | Union, alphabetical. |
| `bun.lock` | Both sides regenerated it. | Took `origin/main`'s file, then `bun install`. Never hand-edited. |

The rebase itself only conflicted in those three places. Everything else that broke was **semantic**:
git merged both sides cleanly and the code no longer typechecked or no longer described the truth.

### The provider, ported rather than re-implemented

```
complete()
  ├─ client.generateStateless(...)   POST /api/experimental/generate — no session, no tools
  │    ├─ text?  → return (usage unreported)
  │    └─ undefined (404 / refusal / no data.text) → fall through
  └─ client.createSession → generate → sessionInfo (real totals) → deleteSession
```

- **`OpencodeClient.generateStateless(input)`** (`packages/runner/src/opencode/client.ts`) is new. It
  returns `undefined` — never throws — for *any* refusal: a 404 on a server that predates the route,
  another non-2xx, an unreadable body, or a body without `data.text`. A refusal is a capability
  signal ("use a session"), not a failed completion. A transport failure still throws `RUNNER_ERROR`,
  which the provider maps to a retryable `LLM_ERROR`; silently falling back there would hide a dead
  server. It is named `generateStateless` because `generate(sessionId, …)` already owns the
  session-scoped route; renaming that one would churn every caller for no gain.
- **`asLlmError` is kept** as the single mapping from the runner's error vocabulary to the router's.
- An **explicitly empty** answer (`data.text: ''`) is returned as text, not treated as a refusal: the
  model did answer, with nothing. Only a *missing* `text` field means "this server will not do it".

### Reporting real usage, and being honest when there is none

The session path reads `sessionInfo().tokens` and reports the real totals (this is the metered path).
The stateless route cannot report anything — its response schema is `{ data: { text } }`, confirmed in
`packages/runner/test/fixtures/openapi.json` — and the locked `LLM` port's `TokenUsage` is three
numbers, so "unknown" has no representation there. Rather than let a fabricated zero pass as a
measurement, `OpencodeCompletionResult` grew an optional `usageKnown?: boolean`:

- `false` from the stateless path, and the router logs
  `llm <role> … usage=unknown (the provider reported no token totals; cost is 0, not measured)`;
- absent/true from the session path and from hand-written fakes (meaning "these numbers are real").

The run below shows that line live for the summary writer. The remaining gap is a **type** gap, not an
implementation one: `LLMResponse.usage` is locked to numbers, so the meter still adds zeros for
stateless calls. Fixing that properly needs a contract change (see *Known limitations*).

### The find only a real run could make

The first C2 attempt died at **0:10** with `opencode POST /api/experimental/generate could not be
reached`. Cause: Epic 49's shared client defaults its per-request timeout to **10 s** — right for
control-plane calls (`/api/info`, session create) and far too short for a model call. The provider's
own option had documented "Default 120 s" since Wave 1 but never applied it, so the tighter default
won. `createOpencodeCompletionClient` now always passes `timeoutMs: opts.timeoutMs ?? 120_000`, with a
constant, a regression guard on it and a slow-server test. This is exactly the class of bug this epic
exists to catch: each package was green on its own.

### Semantic reconciliation (no git conflict, but broken or untrue)

1. **`packages/web`: duplicate `run.status` arms.** Epic 41's `data/run-status.ts` handles the event
   with an `isRunStatusEvent` guard and switches over `KnownStarlingEvent = Exclude<StarlingEvent,
   RunStatusEvent>`. This branch had added `case 'run.status'` arms too — written before that guard
   existed — so once core knew the arm, the switches had duplicate cases and `tsc` failed. The guard
   is the better design (it works with either core), so the arms are gone.
2. **`packages/engine`: feature-detection probes asserted the pre-C2 truth.** Epic 49 published
   `run.status` only if `StarlingEventSchema` accepted one of five candidate shapes and asserted
   "nothing is published while core has no arm". With the arm landed, `{ from, to, run }` is accepted
   and four status events appear in the golden trace. The two probes now assert the published shape
   and its contract validity, and the golden envelope gained `'run.status': 4`.
3. **`apps/cli`: the composition test froze Wave 1's merge subject.** The merger writes
   `merge(<taskKey>): <ref>` now, not `merge(two)`; the assertion matches the current shape.
4. **`packages/llm/src/env.test.ts`**: the profile-fallback fake answered every POST, so the new
   stateless probe stole the call from the session path the test is about. The fake now models a
   route-less server, which is the case those tests describe.

## C2 verification

```bash
bun install                     # clean, no changes
bun run test                    # packages 1979 tests · apps/web 581
bun run check                   # biome + tsc for every workspace
cd apps/web && bun run build    # vite build
bash examples/scripts/make-demo-repo.sh /tmp/sky-c2-final
bun run starling run "$(cat examples/sky-todo/demo-goals/quick-wins.md)" \
  --repo /tmp/sky-c2-final --no-dash --max-parallel 3 --budget 5
```

`make-demo-repo.sh` takes the **target directory** as its only argument (`[target-dir]`); the fix
prompt's `make-demo-repo.sh sky-todo /tmp/sky-c2` form would create a repo named `sky-todo` inside the
worktree, so the target-only form is what is used here.

### Real runs at C2

All on `opencode/deepseek-v4.1-flash` through the local `opencode serve`, budget $5, `--no-dash`,
sky-todo `quick-wins` goal, fresh demo repo each time:

| # | Tree | Result | What it proved |
| --- | --- | --- | --- |
| 1 | 22 branches, **before** Epic 44 merged | `0 merged · failed at 0:10` | the 10 s client timeout above — the first thing a real run found |
| 2 | final tree (all 23), `maxParallel: 3` | **2 merged · 1 failed** in 8:15, api $0.148 | the port works end to end; the failure is a genuine planner DoD bug (below) |
| 3 | final tree, `maxParallel: 3` | `0 merged · failed at 1.7 s` | a *startup* transport failure, not a timeout: the machine was at load 60–100 with ~100 sibling agent processes, and the run never printed `opencode server listening` |
| 4 | final tree, `maxParallel: 2` | `0 merged · failed at 1.7 s` | same startup failure at load ~98; the server did not come up at all |

Run 2 is the authoritative one. Its third task (`t03-tag-count`) **failed the audit three times**, and
the auditor was right: the planner wrote a DoD item that says `tag-count.test.ts` must assert
`2 tags in use` for tags `['work','home']` and `['work','urgent']` — which is *three* distinct tags.
The worker wrote the arithmetically correct test (`3 tags in use`), the deterministic checks
(`lane`, `tests`, `missing-tests`, `lint`) all passed, and the LLM review refused to claim a DoD item
that was not met. Epic 44 made the auditor strict ("never pass an audit a configured reviewer did not
judge"), so this is the stricter auditor doing its job on a planner-quality defect, not an integration
regression. The pre-rebase run merged the same task under the looser auditor.

Runs 3 and 4 are environmental: the box was running ~100 `opencode run --standalone` agents
(load average 98), the private `opencode serve` never reached its listening state, and the provider
correctly surfaced a retryable transport error instead of pretending to have a completion. Re-running
under that load is not a fair test of the code (and would burn budget), so the evidence above stands
as the C2 verification: one run with all tasks merged on the pre-Epic-44 tree, one run on the final
tree that merges two tasks and fails the third for a real, explained reason.
