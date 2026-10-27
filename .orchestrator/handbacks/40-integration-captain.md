## Epic 40 Handback — Integration captain: the real end-to-end run
**Status:** Complete. Branch `epic/40-integration-captain` @ HEAD (see the PR). Closes #27.

**Delivered:**
- `apps/cli/src/real/compose-real.ts` — `composeReal(config, options)` builds the genuine stack:
  runner → effective config/profile → SQLite store + `attachRecorder` → LLM/repomap/planner/prompts/
  workspace/auditor/merger → registry + hub `LocalNode` + scheduler + `createFlockHub` → `createEngine`
  with a server-backed `bundleUrlFor`. Returns `{ engine, flock, store, bus, profile, worktreeRoot,
  runnerUrl, hubNode, setHubUrl, close }`; every resource is on a LIFO `DisposalStack`.
- `apps/cli/src/real/` support modules: `dispose.ts`, `engine-store.ts`, `hub-heartbeat.ts`,
  `workspace-deps.ts`, `merger-deps.ts`, `dashboard.ts`, `readonly-engine.ts`, `paths.ts`,
  `recording.ts`.
- `starling run` real by default (`--mock` for the Wave 1 stack), `--budget <usd>`, `--fully-open`
  wired to the `local` profile, dashboard via `startServer` unless `--no-dash`, SIGINT/SIGTERM as a
  cancellation, summary with branch + merged/failed + API/local cost.
- `starling plan` real, `--json` prints only `{plan, issues}` on stdout (progress to stderr).
- `starling status` reads `<repo>/.starling/starling.db` (additive `--repo`); `starling dash` serves
  the store + §6 API/SSE read-only.
- `packages/core` (additive): `TaskRun.nodeName?`, `run.status` event, `MergeQueueProps.selectedTask?`,
  `SkyViewProps.paused?`, with tests.
- Recordings: `fixtures/real/quick-wins.jsonl` (362 KB, 808 events) and
  `fixtures/real/launch-day.jsonl` (513 KB, 1141 events) — both under the 5 MB cap, agent strings
  clipped at 400 chars.
- Tests: `apps/cli/src/real/compose-real.test.ts` (the real stack with MockLLM + the runner's fake
  opencode server, two tasks merged on real git worktrees and a real SQLite log),
  `real-wiring.test.ts` (disposal, heartbeat, recording caps, dependency links, dashboard, read-only
  engine), `merger-deps.test.ts` (the merge port is serial: peak concurrency 1, one queue),
  `compose-real.live.test.ts` (the real quick-wins run, `STARLING_LIVE=1` only), plus updated
  CLI/core tests.

**Real runs (opencode profile, `maxParallel` 3–4, budget $5, `--no-dash`):**

1. quick-wins (3-task goal, planner produced 5), `/tmp/sky-e2e-1`:
```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ✔ run finished in 7:11                                                                 │
│ ✔ 5 merged  ·  ✘ 0 failed  ·  0 conflicts                                              │
│ api $0.223  ·  local $0  ·  saved $0.000                                               │
│ branch starling/3rcdzr/integration                                                     │
╰────────────────────────────────────────────────────────────────────────────────────────╯
recorded 808 events → fixtures/real/quick-wins.jsonl
```
```
$ git -C /tmp/sky-e2e-1 log --oneline starling/3rcdzr/integration | head
e4c99b7 merge(integration-acceptance): starling/3rcdzr/integration-acceptance
30a1756 test(integration-acceptance): cover tab title, header date and footer tag count together
3d290ee merge(footer-tags): starling/3rcdzr/footer-tags
b728151 merge(header-date): starling/3rcdzr/header-date
988a8bc test(footer-tags): cover tag normalization and footer updates
ad56b31 feat(footer-tags): show distinct tag count in the footer
366467e feat(header-date): show today's date in the header slot
bfb324a merge(tab-title): starling/3rcdzr/tab-title
eeff4ce feat(tab-title): show open-task count in document title
e024c2c merge(shell-slots): starling/3rcdzr/shell-slots
c37f0f3 feat(shell-slots): expose footer slot host and shell test hooks
a41512b chore: initial sky-todo
```
`bun test` on that branch inside the demo repo: **97 pass / 0 fail** (15 files).

2. launch-day (7-item goal, planner produced 6), `/tmp/sky-e2e-3`:
```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ✔ run finished in 7:53                                                                 │
│ ✔ 6 merged  ·  ✘ 0 failed  ·  0 conflicts                                              │
│ api $0.517  ·  local $0  ·  saved $0.000                                               │
│ branch starling/900chp/integration                                                     │
╰────────────────────────────────────────────────────────────────────────────────────────╯
recorded 1141 events → fixtures/real/launch-day.jsonl
```
```
$ git -C /tmp/sky-e2e-3 log --oneline starling/900chp/integration | head
b8f57cd merge(shortcuts-help): starling/900chp/shortcuts-help
79d73d0 feat(shortcuts-help): add keyboard shortcuts and help overlay
8845fdc merge(due-date-badges): starling/900chp/due-date-badges
3061234 merge(csv-export): starling/900chp/csv-export
7059cc8 feat(due-date-badges): add overdue, today and upcoming due-date badges
92ba3fb test(csv-export): cover escaping, missing cells and download trigger
4d317d0 feat(csv-export): add RFC 4180 todo export with toolbar action
53f2d20 merge(search-filter): starling/900chp/search-filter
22e1921 feat(search-filter): add live search box with toolbar filter
2f8c4aa merge(dates-fix): starling/900chp/dates-fix
7a38328 merge(theme-toggle): starling/900chp/theme-toggle
ffb1135 fix(dates-fix): compare local calendar days for overdue and sorting
7292a32 feat(theme-toggle): add persisted light/dark theme toggle
933833d chore: initial sky-todo
```
`bun test` on that branch inside the demo repo: **131 pass / 0 fail** (18 files).
`starling status --repo /tmp/sky-e2e-3` reports `finished · 7:53`, 6/6 merged,
**api 3.2M in / 412.2k out, $0.517** — the cost meter and the token counters are live.
`starling replay fixtures/real/quick-wins.jsonl --speed 2000` replays all 808 events to the same
summary in 0.8 s.
`starling dash --port 7799` served `/api/health` `{ok:true}` and `/api/runs` from the store.

**Key design decisions:**
- **`opencode` is the default real profile** (`STARLING_LLM_PROFILE` still wins): this machine has no
  DeepSeek key (L25/L29). The library default (`deepseek`) is deliberately not used here.
- **A private `opencode serve` on a free port**, not `opencode.port`: pinning 4096 collided with the
  user's own server and produced 401s. `opencode.port` stays meaningful for `attach` and `doctor`.
- **Worker/resolver model refs are split in the composition** (`opencode-go/deepseek-v4.1-flash` →
  `{ providerID: 'opencode-go', id: 'deepseek-v4.1-flash' }`) because the *runner* passes refs
  straight to opencode while the *LLM router* does its own split. Fixing it in the composition keeps
  both packages ignorant of each other's conventions.
- **Worktrees get `node_modules` via one symlink plus a local exclude rule** (`.git/info/exclude`):
  `.gitignore`'s `node_modules/` does not match a symlink, so without the rule the link was committed
  and every task failed its lane check. The merge queue's integration worktree gets the same link
  through a merger decorator (`real/merger-deps.ts`) rather than a new contract.
- **The merger gets a serial merge port inside the composition** (`real/merger-deps.ts`): the
  engine calls `merger.merge` directly, so two tasks that finish auditing together ran `git merge`
  in one integration worktree and collided on `.git/index.lock` — the loser was marked `failed` with
  no retry. The composition routes `merge` through the merger's own serial queue (and links
  `node_modules` inside that serialised section). This was a ~50% flake in the full suite and would
  have hit a real run with two simultaneous merges.
- **The recorder is the single writer of the event log** (`real/engine-store.ts`): the engine appends
  *and* publishes, `attachRecorder` appends again — wiring both to SQLite doubled every event.
- **The hub heartbeats itself** (`real/hub-heartbeat.ts`): the registry sweeps a node offline after
  15 s and only perches have a heartbeat route.
- **`--budget` overrides `budget.maxUsd`** for the run (engine already stops dispatching at the cap).
- **Recordings clip then cap**: 400 chars per agent string, lifecycle kept past 5 MB; the cap is
  printed, so a truncated recording never claims to be complete.
- **`starling dash` is read-only**: launching a run needs an engine built from a repo + goal, which is
  the dashboard's launch form (E41). It answers 501 with a pointer to `starling run`.

**Verification (exact commands + results):**
- `bun install` — clean (`Checked 175 installs across 221 packages`), `apps/cli/package.json` gained
  workspace deps only.
- `bun run test` (root): packages/apps/server/cli/skills/integrations/tools/evals →
  **1383 pass / 5 skip / 0 fail** (`Ran 1388 tests across 166 files`); apps/web →
  **426 pass / 0 fail** (`Ran 426 tests across 39 files`).
- `bun run check` — clean: `Checked 719 files in 139ms. No fixes applied.` + every workspace
  `tsc --noEmit` passed.
- Merge-port race (finding 7): `bun test apps/cli` re-run 5× → 0 fail each; `bun run test:packages`
  re-run 2× → 0 fail (it failed ~50% of runs before the fix).
- Real runs as above (both finished, all tasks merged, integration branch suites green inside the
  demo repo).

**Dependencies added:** none outside the workspace. `apps/cli/package.json` added
`@starling/{auditor,engine,flock,github,llm,merger,planner,prompts,repomap,runner,server,store,workspace}`
all `workspace:*` (the CLI is the composition root, so it must see every package); no new third-party
packages, no version bumps.

**CONTRACT REQUESTS:**
1. **`TaskRun.worktreePath` should be populated (or `TaskHandle` should carry it).** The auditor runs
   its `tests` check in `run.worktreePath ?? ctx.goal.repoPath`, and nothing sets it, so the test
   gate proves the *base* repo is green while only the merge queue proves the merged result. Engine
   (E49) + flock (E30) work; no core change needed, the field exists.
2. **`packages/llm`: report usage from the opencode provider.** `/api/experimental/generate` (the new
   primary path) returns text only, so planner/auditor/writer turns cost `$0.000`; agent sessions do
   report real usage now. Either read the session totals after a generate (the stateless route is the
   one without a session) or accept the gap explicitly in the docs.
3. **`packages/runner`: map `session.tool.error` / any remaining 2.1.x tool failure names** if they
   exist (only `session.tool.failed|error` are guessed here; `success`/`called`/`input.*` were
   captured live). Everything else in the streaming vocabulary is mapped.
4. **`packages/engine` (E49): call `merger.queue().enqueue` instead of `merger.merge`.** The engine
   merges as soon as a task passes audit, so two simultaneous merges share one integration worktree
   and collide on `index.lock`; the loser is marked `failed` with no retry (no core change needed —
   `createMergeQueue` is already exported). The CLI composition serialises the port today, which
   covers `starling run`, but a dashboard/launch embedder calling `merge` directly would not.

**Minimal fixes made outside the strict lane (blocking, see the epic doc):**
- `packages/llm/src/providers/opencode.ts` (+ `opencode.test.ts`): use
  `POST /api/experimental/generate` first, fall back to the session flow. Without it the planner
  could never produce JSON on 2.1.2 (the agent explored instead of answering; `text: ""`).
- `packages/runner/src/opencode/normalize.ts` (+ `normalize.test.ts`): map 2.1.2's
  `session.text.* / session.step.* / session.tool.* / session.usage.updated` family. Without it a
  live session emitted only `session.started` + `session.idle` (no text, no tools, `$0.000`).
- `apps/web/src/data/reducer.ts`, `apps/web/src/data/demo.ts`: one arm each for the new `run.status`
  event, so the exhaustive switches keep compiling (E41 was told to feature-detect it).
- `apps/cli/{package.json,src/program.ts,src/context.ts}` (workspace deps, `--budget`/`--mock`/
  `status --repo`, `stderr` + composition overrides) and the CLI's own test files.

**Deliberately deferred / out of scope:**
- Flock across two machines, mDNS, bundle transfer over HTTP (E42). `bundleUrlFor` is wired and
  `setHubUrl` exists; a remote node was never exercised.
- GitHub mode end to end (E43): the tracker is constructed and `--github` enables it, but no `gh` call
  was made from a real run.
- The dashboard data layer (E41) and the launch form; `dash` is read-only by design.
- Engine policies (E49): `run.status` publishing, `nodeName`, worktree paths.
- The conflict resolver (E45): a conflicted merge stops at `conflict`.
- `--fully-open` (`local` profile) is wired but not exercised — L23/L31 forbid local models in a wave.
- No committed screenshots of the dashboard on a live run; the recording + `starling replay` is the
  evidence.

**Open questions / flagged tradeoffs:**
- **Where should `node_modules` linking live?** It is in the CLI composition (a decorator). If the
  server or a perch ever builds its own `LocalNode`, they need the same two lines; a `Workspace`
  option would be the durable home (workspace is not this epic's lane).
- **Should the auditor run tests in the task worktree?** Yes, but it needs the worktree path on the
  TaskRun. Until then the merge queue is the real gate; the audit's `tests` check is advisory by
  accident rather than by design.
- **`opencode.port` semantics.** After this epic it means "the server I run by hand" (attach/doctor);
  a spawned Starling server is always on a free port. If the dashboard ever wants to show "the
  opencode server Starling is using", that is `composition.runnerUrl`.
- **The launch-day goal planned 6 tasks, not 7.** The planner folded keyboard shortcuts + help into
  one task; nothing in the epic requires 7, but the demo script's "7 tasks" is the model's decision,
  not a guarantee.
- **Two sessions of this epic ran on this machine at once** (a resumed session overlapped the
  original one for ~20 minutes). The committed `fixtures/real/launch-day.jsonl` is the
  `/tmp/sky-e2e-3` run described above (1141 events, the one with normalised agent events and live
  cost); a second, independent `/tmp/sky-e2e-2` launch-day run also finished 6/6 merged and its
  recording was overwritten by this one. Nothing uncommitted is left behind, so no conflict is
  expected — but if the integrator sees two launch-day recordings in review, either replays.

---

## C2 Rebasing — landing on top of the other 22 Wave 2 epics

**Status:** Complete. Branch `epic/40-integration-captain` @ the PR head (rebased onto `origin/main`
with all 22 other Wave 2 branches; Epic 44's tag arrived mid-session and is included). Two real-run
caveats are spelled out under *Verification* — neither is an integration regression.

**Delivered (C2 delta on top of the Wave 2 work above):**
- **Rebase**: 13 commits replayed onto `origin/main` (all 22 other Wave 2 branches, epic 44 included).
  Only three git conflicts, all resolved as the assignment specified:
  - `packages/llm/src/providers/opencode.ts` — took Epic 49's design and re-ported this branch's
    behaviour onto it (below); the old hand-rolled REST client is gone, not resurrected.
  - `apps/cli/package.json` — union of Epic 42's `@starling/perch` and this branch's twelve
    workspaces, alphabetical.
  - `bun.lock` — took `origin/main`'s file, then `bun install` (never hand-edited).
- **`packages/runner`**: new `OpencodeClient.generateStateless(input)` for
  `POST /api/experimental/generate`, exported `GenerateStatelessInput`, and five tests in
  `test/client.test.ts` (no session created, route-less 404 → `undefined`, refusal/no-text →
  `undefined`, explicit `text: ''` returned as text, unreachable server → `RUNNER_ERROR`). The fake
  server grew a `onGenerateStateless` hook so both outcomes are drivable.
- **`packages/llm`**: `createOpencodeCompletionClient` now tries the stateless route first and falls
  back to create → generate → `sessionInfo` → delete; `asLlmError` kept as the single error mapping;
  tests for generate-first, empty answer, 404 fallback, 503/`{}`/no-envelope fallback, unreachable
  server, slow server, and the timeout default.
- **Usage reporting (this branch's own FIX REQUEST #2)**: the session path reports real totals; the
  stateless path (schema `{ data: { text } }`, no totals) returns `usageKnown: false`, and the router
  logs `llm <role> … usage=unknown (the provider reported no token totals; cost is 0, not measured)`.
  Observed live in the final run for the writer and the auditor.
- **Semantic reconciliation** (git merged cleanly, the code was wrong or the test told a stale truth):
  - `apps/web/src/data/{reducer,demo}.ts`: dropped the duplicate `case 'run.status'` arms — Epic 41's
    `isRunStatusEvent` guard handles the event and switches over `KnownStarlingEvent =
    Exclude<StarlingEvent, RunStatusEvent>`, which is why the arms stopped typechecking once core had
    the arm.
  - `packages/engine`: the two feature-detection probes now assert that `run.status` *is* published in
    core's `{ from, to, run }` shape (and is contract-valid); `engine-golden.test.ts` gains
    `'run.status': 4`; `run-status.ts`'s header records which side of the detection we are on.
  - `apps/cli/src/real/compose-real.test.ts`: matched the merger's real subject
    `merge(<taskKey>): <ref>` instead of Wave 1's `merge(two)`.
  - `packages/llm/src/env.test.ts`: the profile-fallback opencode fake now models a route-less server,
    so those tests keep exercising the session path they describe.
- **Docs**: `docs/epic-40-integration-captain.md` grew a *C2* section (conflicts, the port, the usage
  story, the run table, the semantic reconciliation).

**Key design decisions (C2):**
- **`generateStateless`, not `generate`.** Epic 49's client already has `generate(sessionId, input)`
  for the session-scoped route; renaming that would churn every caller. The stateless route gets an
  unambiguous name, and the client's header explains why.
- **`undefined` is a capability signal, a throw is a failure.** A 404/non-2xx/unreadable body/no `text`
  means "fall back to a session"; a transport failure means the server is unreachable and stays a
  retryable `LLM_ERROR`. Swallowing the second would hide a dead server behind a slow session path.
- **`text: ''` is an answer, a missing `text` is a refusal.** The route's own schema makes that
  distinction; conflating them would silently retry a model that genuinely produced nothing.
- **`usageKnown: false` instead of "fix the numbers".** `TokenUsage` (locked) is three numbers, so
  "unknown" cannot be represented in the port. An additive optional flag on the *provider's own*
  result type keeps the meter honest without touching contracts; the router turns it into a log line.
  The precise contract change is filed below.
- **120 s default in the provider, not in the shared client.** The client's 10 s default is right for
  control-plane calls; a completion is a model call. Overriding at the LLM boundary keeps the runner's
  behaviour (and Epic 49's tests) untouched.
- **Epic 41's guard wins over this branch's switch arms.** Both implemented `run.status` handling
  before core had the arm; the guard works against either core, the arms do not. Keeping both was
  impossible (duplicate cases); keeping the guard is strictly better.
- **Taking `origin/main`'s `bun.lock` then installing** is the only resolution that cannot corrupt
  the lockfile; the union of `apps/cli/package.json` needed no third-party additions.

**Verification (exact commands + results):**
- `bun install` → `Checked 180 installs across 225 packages (no changes)`.
- `bun run test` (root, both halves):
  - packages/apps/server/cli/skills/integrations/tools/evals → **1974 pass / 5 skip / 0 fail**
    (`Ran 1979 tests across 227 files`, 29 snapshots).
  - `apps/web` (separate process) → **581 pass / 0 fail** (`Ran 581 tests across 60 files`).
- `bun run check` → `Checked 990 files … No fixes applied.` + every workspace `tsc --noEmit` passed.
- `cd apps/web && bun run build` → `✓ built in 198ms`.
- Integration-branch check (pre-Epic-44 real run, `/tmp/sky-c2`): `git log` shows merge commits
  `merge(t01-title-count)`, `merge(t02-today-header)`, `merge(t03-tag-count-footer)`; `bun test` in a
  worktree of `starling/7w6pgt/integration` → **84 pass / 0 fail** (15 files).

**Real runs (sky-todo `quick-wins`, opencode profile, budget $5, `--no-dash`, fresh repo each time):**

| # | Tree | Result |
| --- | --- | --- |
| 1 | 22 branches, **before** Epic 44 | `✘ failed after 0:10` — found the 10 s client timeout (fixed) |
| 2 | **final tree** (23 branches), `maxParallel 3` | `✔ run finished in 8:15 · 2 merged · 1 failed · 0 conflicts · api $0.148` |
| 3 | final tree, `maxParallel 3` | `✘ failed after 1.7 s` — server never came up (machine load 60 → 100, ~100 sibling agents) |
| 4 | final tree, `maxParallel 2` | `✘ failed after 1.7 s` — same startup failure at load ~98 |

Run 2 (authoritative, final tree) pasted:
```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ✔ run finished in 8:15                                                                 │
│ ✔ 2 merged  ·  ✘ 1 failed  ·  0 conflicts                                              │
│ api $0.148  ·  local $0  ·  saved $0.000                                               │
│ branch starling/fz2cnv/integration                                                     │
╰────────────────────────────────────────────────────────────────────────────────────────╯
```
Its third task failed the audit three times **correctly**: the planner wrote a DoD item demanding
`2 tags in use` for tags `['work','home']` and `['work','urgent']` (three distinct tags). The worker's
test asserted `3 tags in use`, all deterministic checks passed, and Epic 44's LLM review refused to
certify an unmet DoD. Evidence preserved at `/tmp/sky-c2-final-attempt1.db` (699 events).
`grep usage=unknown` in the run log confirms the new usage reporting:
`llm writer … 5071ms usage=unknown (the provider reported no token totals; …)`,
`llm auditor … 24194ms usage=unknown …` (the 24 s auditor call is also why the 120 s default matters).

Runs 3 and 4 are **environmental**, not code: at load 60–100 with ~100 concurrent
`opencode run --standalone` agents (`ps` count 101, load average 98), the runner's private
`opencode serve` never reached its listening state and the provider surfaced a retryable transport
error. The pre-Epic-44 run on the same port merged **3/3** in 4:24 (api $0.119), so the port itself is
proven end to end; what is *not* proven under load is the runner's spawn-readiness path (see below).

**Dependencies added:** none. `apps/cli/package.json` is now the union of Epic 42's `@starling/perch`
and this epic's twelve `workspace:*` entries; no third-party package, no version change.

**CONTRACT REQUESTS:**
1. **Let the LLM port say "usage unknown".** `LLMResponse.usage: TokenUsage` is three numbers, so a
   provider that genuinely cannot measure (opencode's stateless route — its schema is
   `{ data: { text } }`) must either lie with zeros or throw. Proposed additive change:
   `LLMResponse.usageKnown?: boolean` (absent = measured), populated from
   `OpencodeCompletionResult.usageKnown` in `packages/llm/src/router.ts`, so the cost meter and the
   dashboard can show `—` instead of `$0.000`. Filed rather than made: contracts are Epic 40's to
   extend only in coordination, and this needs the metrics/UI side to agree.

**FIX REQUESTS (not my lane):**
1. **`packages/planner` (Epic 48)**: DoD items can contradict the code's arithmetic — the final run
   died on `2 tags in use` for inputs that have three distinct tags. A cheap guard: when a DoD item
   names a literal count, re-derive it from the stated inputs before publishing the plan (or forbid
   counts in DoD items and name the property instead). This is the single biggest demo-risk the C2
   runs exposed, and the stricter auditor will now surface every instance as a failed task.
2. **`packages/runner` (Epic 49/15)**: `createOpencodeRunner` reports its URL before the server is
   provably serving. Under heavy load the first LLM call failed with
   `POST /api/experimental/generate could not be reached` at t+1.4 s and the run log never contained
   `opencode server listening`. A readiness probe (`GET /api/info` with backoff) before returning
   would turn that into a wait, and its failure into an actionable error naming the spawned process.

**Deliberately deferred / out of scope (C2):**
- Metering stateless opencode calls (needs the contract request above).
- Epics 46, 50 and 54 have not run, so this branch is complete relative to the 22 that have; a later
  wave may add conflicts in shared files.
- Re-running the demo to green after the planner fix — the run's failure is a plan-quality bug, and
  the demo goal file is Epic 58's lane.
- The recordings in `fixtures/real/` are unchanged and still replay (they predate the `run.status`
  arm, which the replay path treats as any other event).

**Open questions / flagged tradeoffs:**
- **Local-model runs under a saturated box.** Four real runs in one session (two of them at load
  60–100) hit the machine's limits, not the code's. Wave 3's demo runs probably want a `doctor`-style
  guard: refuse to start a real run when free memory is low or `opencode run` processes exceed N.
- **`run.status` is now live on the bus** (the engine's probe accepts core's shape). Consumers that
  switch exhaustively on `StarlingEvent` must handle it — the web does (guard), the store's derive
  ignores it, and the fixtures don't contain it. Worth a line in the event-bus docs.
- **`make-demo-repo.sh` takes one argument** (`[target-dir]`), so the fix prompt's
  `make-demo-repo.sh sky-todo /tmp/sky-c2` form would have created a repo named `sky-todo` inside the
  worktree. Used `make-demo-repo.sh /tmp/sky-c2` instead; worth correcting in the next wave's prompts.
