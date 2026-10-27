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
  engine), `compose-real.live.test.ts` (the real quick-wins run, `STARLING_LIVE=1` only), plus updated
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
  **1380 pass / 5 skip / 0 fail** (`Ran 1385 tests across 165 files`); apps/web →
  **426 pass / 0 fail** (`Ran 426 tests across 39 files`).
- `bun run check` — clean: `Checked 718 files in 153ms. No fixes applied.` + every workspace
  `tsc --noEmit` passed.
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
- **A duplicate of this session appears to have written `fixtures/real/launch-day.jsonl` mid-epic**
  (a `/tmp/sky-e2e-2` run, 6/7 merged, finished). This branch's file is the run described above from
  `/tmp/sky-e2e-3`; if two sessions of this epic merged, the integrator should expect a conflict on
  that file and keep either recording (both are valid, both replay).
