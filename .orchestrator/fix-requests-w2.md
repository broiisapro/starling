# Wave 2 FIX REQUESTS, compiled for Wave 3

Every Wave 2 handback's FIX REQUESTS section, verbatim, grouped by source epic. **Wave 3 rule:** find every request whose target file or package is inside your lane, implement it (or decline it with a reason), and list each one in your handback under **Carryover done**. Requests aimed at `packages/core`, `packages/llm`, `packages/runner`, `apps/cli` (outside `src/ext/`) or `apps/web/src/data` belong to Wave 3b; leave them alone.

## From 41-live-dashboard


1. **Root `package.json`**: add `"dev:live": "bun apps/server/src/dev-live.ts"`. The prompt's DoD says `bun run dev:live`; root config is outside this lane (AGENTS §1), so the script currently lives in `apps/server/package.json` and the working invocations are `cd apps/server && bun run dev:live` or `bun --cwd apps/server run dev:live`.
2. **Epic 49 (`packages/engine`)**: publish the collected diff so the new route is populated on real runs — either a `task.diff` event `{ taskKey, diff }` or an additive `diff` on `task.status`. The server already accepts either shape, so this is the only missing producer.
3. **Epic 47 (`apps/web/src/features/sky`)**: honour `SkyViewProps.paused`. The shell now passes `paused: view !== 'sky'`; until the prop exists the Sky's rAF loop keeps running behind the DAG.
4. **Epic 55 / queue lane**: honour `MergeQueueProps.selectedTask` to highlight the selected queue card. The shell passes it; the component currently ignores it.
5. **Epic 49**: publish `run.status` transitions (`{from,to,run}`). The web reducer already handles them; the picker will otherwise keep saying `mapping` until `run.finished`.

**Deliberately deferred / out of scope:**

- Real engine/CLI composition (Epic 40), visual Sky polish (Epic 47), the launch form (Epic 53).
- Refreshing a cached drawer diff after a later fix attempt (fetch-once per run+task today).
- Pinning the selected run against "newest run wins" (a future store flag).
- A committed browser/Playwright pass for live mode; verification here is route tests, the scripted hub, and the live curls above.
- Last-Event-ID support (still cursor-based `?since=`, per E21).

**Open questions / flagged tradeoffs:**

- **Diff shape ownership.** The route accepts three shapes to avoid blocking on core; if Epic 49 picks a different field name, the extractor needs one small addition. `latestTaskDiff` is the single place to change.
- **`/api/config/public` resolves env per request.** A running process that changes `STARLING_LLM_PROFILE` after composition will show the new value while the engine keeps the old routes; acceptable for a dev hub, but worth knowing.
- **Auto-follow replaces an explicit selection when a newer run starts.** That is the control-room reading of the requirement; a "pin" toggle is the escape hatch if it proves surprising on stage.
- **`dev-live` adds a `diff` to `audit.verdict` payloads.** It is dev-only and documented; the strict contract is untouched, and real recordings never contain it.

Closes #28

## From 42-flock-e2e


1. **`apps/server/src/routes/flock.ts` (Epic 41): return 404 for an unknown heartbeat id.** Now the
   route always answers `{ok:true}` while the hub re-registers fire-and-forget. Answering 404 when
   `registry.get(nodeId) === undefined` makes the perch's explicit re-register path (already
   implemented) the recovery of record, and matches the loopback hub. Response body:
   `{error:{code:'unknown-node', message:…}}`.
2. **`packages/engine` (Epic 49) / dispatch:** the scheduler reads registry `NodeInfo`, which lags a
   dispatch by one heartbeat. Dispatching two tasks in the same tick can double-book a
   `maxSessions: 1` perch, and the node rejects the second `startTask` with `INVALID_ARGUMENT`. Reserve
   locally at dispatch, or refresh `node.info()` into the registry between picks (the loopback waits for
   `activeSessions > 0` before its second pick; see `tools/flock/loopback.ts`).
3. **`apps/server` (Epic 41) / hub node liveness:** the hub's `LocalNode` is in the registry but nothing
   refreshes its `lastSeen`. This lane's `createRegistry.sweep` now skips `kind: 'local'`, which fixes
   the symptom; if the server wants real stats on the hub row it should still `registry.touch('hub',
   await localNode.info())` on a timer or after each dispatch.
4. **`apps/cli/src/program.ts` (Epic 40/22): add `--hub <url>` to `starling flock`.** The command
   currently reads `STARLING_HUB_URL` and falls back to `config.server.port`; a flag is the obvious UX
   and cannot be added from this lane.
5. **`apps/cli` (Epic 40): terminal QR code in `starling flock`.** Needs a CLI dependency for QR
   rendering; per the brief that is Epic 40's lane. The join command is printed and copy-pasteable
   today.
6. **Epic 40/41: real composition + real flock smoke.** When `apps/cli/src/real/*` and the server's flock
   routes land, run hub + one perch on this Mac (separate port and cache dir) with `maxSessions: 1` on
   the hub, using the `quick-wins` goal, and record it to `fixtures/real/flock-loopback.jsonl`. The
   loopback is the harness to compare against.

**Deliberately deferred / out of scope:**

- The real flock smoke and its JSONL fixture (Epic 40 dependency, see above).
- Engine dispatch/reschedule execution (Epic 49): the loopback plays dispatcher and re-dispatch by hand.
- Web flock panel changes (Epic 41/47) and LLM lending (Epic 51).
- TLS / per-node credentials (LAN-only by L18), bundle garbage collection, scheduler affinity beyond
  free slots (inherited from Epics 14/30).
- Two physical laptops: the runbook is written, not executed here.

**Open questions / flagged tradeoffs:**

- **SSE replay window.** 500 events with a 400 ms scripted turn is plenty, but a text-heavy real session
  could evict an old `session.idle`. If that ever bites, the next step is a per-session sequence number
  or a larger/disk-backed ring, not a protocol change.
- **Fresh connections get no backlog.** Deliberate (see decisions). A hub that loses its `RemoteNode`
  object entirely (process restart) will not see events from before the restart; `Last-Event-ID` only
  helps within one node object's lifetime. The engine's periodic health check should remain the
  backstop.
- **Two rosters can disagree briefly.** `starling flock` reads `/api/nodes`; the in-process fallback
  reads a mock registry. The warning line makes the difference visible, but the two are not the same
  data source by design.
- **Fixed loopback ports vs. a busy build machine.** 7781/7782 with ephemeral fallback keeps output
  readable; if a future CI wants strict isolation, pass `port1: 0, port2: 0` (both are options on
  `runLoopback`).

## From 43-github-e2e


- `packages/engine` (Epic 40/49): when `--github` is wired, (1) assign `syncPlan`'s return value onto
  `run.tasks[key].issueNumber` **before** any retry, so a resumed run takes the no-listing fast path;
  (2) pass `run.tasks[key].nodeId` (already present) and, if available, the per-task local usage through
  a tracker that renders it — otherwise the task PR shows `Local: —` and the node falls back to
  `TaskRun.nodeId`; (3) route `GitHubTrackerOptions.warn` to the EventBus `log` event so rate-limit
  retries and "nothing to review" are visible in the dashboard.
- `apps/cli` (Epic 40/22): `compose()` still only supports `mode: 'mock'`; `starling run --github` cannot
  reach the real tracker until it can build `createGitHubTracker({ cwd: goal.repoPath, repo: config.github.repo ?? undefined })`.
- `examples/scripts/make-demo-repo.sh`: no change needed — `SKY_TODO_SKIP_INSTALL=1` already exists and is
  what `setup.sh` uses.

**Deliberately deferred / out of scope:**

- Engine integration of `--github` (Epic 40), CI on the final PR (Epic 52), deleting sandbox repos.
- Automatic duplicate reconciliation when GitHub's read lag exceeds the 2.4 s settle budget (documented
  in the epic doc as the next step; never observed beyond ~1 s).
- Pagination past 500 `starling:task` issues, label theming, editing issues when the plan changes.
- Parallel `gh` calls (17 sequential calls for 7 tasks is acceptable at this scale).
- A real secondary-rate-limit run: the retry detector is unit-tested against GitHub's documented text,
  but deliberately not provoked so the account is not temporarily blocked.

**Open questions / flagged tradeoffs:**

- **Merged-by-hand PRs.** Merging a task branch into the integration branch makes GitHub report the task
  PR as `MERGED` even though nobody pressed the green button. That is good for the demo but means
  `prUrl` points at a PR GitHub considers merged; if a future epic wants task PRs to stay open until a
  human reviews them, the engine must merge *after* the PR is closed or use a different base.
- **`settleDelaysMs` default (600 ms + 1 800 ms)** is tuned to the observed ~1 s lag on one repo. A very
  busy org might need more; the option exists so a user can raise it without a code change.
- **`openTaskPR` returning `undefined`** for "nothing to review" is a silent-ish skip by design, but it
  relies on the engine honouring `warn`. Flagged in the fix request above.

## From 44-auditor-tuning

- `evals/real.ts` (Epic 29 lane): `instantiate()` calls `createAuditor({})`, so `bun evals/run.ts auditor --impl real` only sees a reviewer when a profile env var is set, and it has no retry. It now works for real runs because `createAuditor({})` auto-resolves from `STARLING_LLM_PROFILE`; please (a) document that env requirement next to `loadRealAuditor`, and (b) consider delegating to `evals/auditor/run-real.ts` so the shared CLI gets the provider-hiccup retry and per-check detail.
- `tools/local-models/recommend.ts` (Epic 28 lane): `readBenchResults` merges every `bench-*.json` in a directory and ignores each result’s `profile` field, so a model measured on the 32 GB laptop can be recommended for the 16 GB laptop. Please filter results by the requested profile (or by a `--profile` flag) before ranking.
- `apps/cli/src/compose.ts` (Epic 40 lane): when the real composition lands, construct the auditor as `createAuditor({ llm: 'auto', bus })` so `STARLING_AUDITOR_PROFILE`/`STARLING_LLM_PROFILE` decides the reviewer and the fallback warning reaches the event stream.

**Deliberately deferred / out of scope:**
- The real local-model bench and `recommendation.json` (Epic 72). No `bench-*.json` or `recommendation.json` is committed from this epic on purpose: a dry-run artifact would put fake measurements in the file the auditor reads at runtime.
- Engine fix-loop behaviour on a reviewer outage (Epic 49): this epic makes the audit fail; what the loop does with it is that lane’s decision.
- Planner evals (Epic 48), models > 20 GB, Ollama pulls.

**Open questions / flagged tradeoffs:**
- Reviewer outage now fails clean tasks too. Deliberate (never merge un-reviewed work) and reversible via `llm: 'off'`/profile configuration, but it couples task success to provider availability; worth watching in the first real runs.
- Fix-instruction quality on held-out is 0.833 because `heldout-skipped-failing-test` says “revert `test.skip` … do not disable the test” and never the literal word “fix”/“implement”. The answer key was left untouched rather than tuned on held-out data.
- The eval is single-sample and the model is not deterministic at `temperature: 0` (0.833 vs 0.917 on two identical baseline runs). Treat one-case differences as noise; Epic 72 or a future eval epic may want `--repeat N` per case.

## From 45-resolver


1. `packages/engine/src/pipeline.ts`, `TaskPipeline.#merge()`, `case 'conflict'` — replace
   `transition(key, 'conflict'); cleanup(live)` with the resolver call in
   `docs/epic-45-resolver.md` § *engine-hook*: transition to `fixing` (the locked `TaskStatus` enum
   has no `resolving`), publish a `log` info, call
   `deps.resolver.resolve({ run, integrationBranch, taskA, taskB, conflict: result,
   prompt: host.promptContext(spec, host.branchOf(key)), model: modelFor(config, 'resolver'),
   testCommand: ctx.testCommand })`, publish `merge.result` with the returned result, then
   `merging` + `merged` (+ `tracker.onMerged`) when `resolved`, otherwise `failed` with
   `log('error', resolved.detail)`; keep today's `conflict` behaviour when no resolver is wired.
2. `packages/engine/src/types.ts` — add `resolver?: ConflictResolver` to `EngineDeps`
   (`import type { ConflictResolver } from '@starling/merger'`).
3. `packages/engine/src/run-driver.ts` — construct it next to the merger:
   `createConflictResolver({ node, prompts, workspace, merger: queuedMerger, clock, bundleUrlFor })`
   where `queuedMerger` wraps `merger.queue().enqueue` so a resolver landing cannot race a normal
   merge in the shared integration worktree; pass it into `TaskPipeline`/`EngineDeps`.
4. `packages/engine/src/pipeline.ts` (optional) — derive `taskB` with
   `conflictingTasks(plan, key, result.conflictedFiles)[0]` from `@starling/prompts`; it is context
   only (marker commit message and telemetry).

**Deliberately deferred / out of scope:**

- Wiring the engine (Epic 49 owns `packages/engine`); the exact call site and transitions are in the
  doc and as FIX REQUESTS above.
- Real LLM resolver sessions (C2). Every test uses a scripted agent; no real model, opencode server,
  Ollama or GitHub call is made.
- Re-auditing the resolution: the auditor's lane check would flag the sibling's file, which is the
  nature of a conflict. The gates are the marker check, the suite and the merge queue.
- Re-preparing the conflict when the integration branch moves during a resolver session (a landing
  conflict becomes a failed attempt instead).
- Deleting the resolve branch after a give-up; it is kept for inspection.
- Flock scheduling of resolver sessions (choosing the perch); `bundleUrlFor` makes a remote node
  usable, but selection/event streaming is engine/server work.

**Open questions / flagged tradeoffs:**

- **Which node runs the resolver, and does the engine count that session against `maxParallel`?**
  `LocalNode` counts it in `activeSessions`, so the scheduler sees it, but the engine's own dispatch
  budget does not. Epic 49 should decide (reuse the task's node is the simplest and keeps the warm
  worktree cache).
- **Two suite runs on the happy path** (resolver verification + merger gate). Deliberate, documented;
  if it proves too slow for big repos, the resolver could pass no `testCommand` to the merger and rely
  on its own verified tree (the merge commit's tree is identical). Not done, because the invariant
  "integration only takes commits the suite vouched for" is worth more than one suite run.
- **Give-up status is `conflict`/`tests-failed` + `resolved: false`.** If the orchestrator would
  rather see `MergeResult.status: 'failed'`, that is a core change (CONTRACT REQUEST above) and the
  engine hook would switch on it instead of `resolved`.

## From 47-sky-polish

1. **`packages/core/src/handshake.ts` — `SkyViewProps.paused?: boolean`** (owner: Epic 40). The C1
   handback already requested it; Epic 47 now consumes it via a local intersection type, so the
   change is purely additive:
   ```ts
   export interface SkyViewProps { /* … */ reducedMotion?: boolean; paused?: boolean }
   ```
   Why: the shell keeps both centre views mounted (React Flow measurement + instant switching), so the
   Sky's rAF must stop while the DAG is shown (`.orchestrator/handbacks/34-c1-web-wiring.md`, request
   3). Until it lands, the shell can pass `paused` and TypeScript will reject it.
2. **`apps/web/src/app/Layout.tsx` — pass `paused={view !== 'sky'}` to `<SkyView>`** (owner: Epic 41 /
   shell). The Sky already stops cleanly; only the wiring is missing. No layout or data-layer changes
   are needed, and the fps/sound controls need no shell support.
3. *(Optional)* `apps/web/src/app/Layout.tsx` — forward toasts/notices into the flock panel's node
   list? Not needed: the Sky renders its own captions and the node.* events already reach it through
   `recent`.

**Deliberately deferred / out of scope:**
- Pixel-diff/screenshot tests and a Playwright CI harness (screenshots remain documentation; the
  deterministic sim tests are the assertion layer).
- Resolver sessions still look like their parent status (no `resolver` TaskStatus exists).
- Per-flock migration re-planning mid-arc; variable migration duration by distance.
- Sound mix/volume UI, spatial panning per roost, and a live-device audio test.
- Caption localisation, a caption priority queue beyond "newest four", and reduced-motion captions.
- Wire labels beyond ~30 merges (ellipsised; the DAG owns full titles).
- Anything in the data layer, layout or the other five panels (Epic 41's lane).

**Open questions / flagged tradeoffs:**
- **Dynamic wire slots supersede Epic 24's stable-slot decision.** Landed flocks shuffle left as new
  merges arrive. It buys readable keys at 9+ merges; if the orchestrator prefers absolute stability,
  revert `wireSlots()` to `flocks.length` and accept overlapping/absent labels.
- **Sound volume is fixed** (master 0.26, hum ≤ 0.05). A demo room may want a slider; a projector
  audience will barely hear it, which is the intent for a stage demo.
- **The join toast is ~20 px tall at 1080p** (`height × 0.023`), deliberately smaller than the roost
  names. If the projector review wants it bigger, one constant in `drawNotices` changes it.
- **`createAudio` is a production prop** (not test-only) because it doubles as the embedding seam for
  a future shared audio context; it is inert unless passed.


Closes #34

## From 48-planner-quality

- `packages/llm/src/env.ts` (`createLLMFromEnv`): for `STARLING_LLM_PROFILE=opencode`, discover the running CLI's `~/.local/state/opencode/service.json` (URL + password) when `STARLING_OPENCODE_URL` / `OPENCODE_SERVER_PASSWORD` are unset. Every consumer that should "just work" (CLI, server, evals, scripts) currently duplicates this; Epic 48 carries a copy in `packages/planner/src/default-llm.ts` and the eval harness delegates to it. Moving it into `@starling/llm` would give one implementation.

**Deliberately deferred / out of scope:**
- Deleting `packages/planner/src/render-map.ts` and the `verbose` option. It is the losing side of the A/B; keeping it one release makes the comparison reproducible. The doc records it as a one-file follow-up.
- Prompt-level enforcement of `tNN` keys (code owns renumbering; the prompt only asks the model not to number).
- A large-repo map-budget benchmark (sky-todo cannot show a saving) — belongs with the local-model/perf work.
- Registry-level model tuning, Ollama auditor (Epic 44), repomap changes, engine changes.

**Open questions / flagged tradeoffs:**
- **Eval semantics changed in three places** (± 1 task range, safety-edge exemption, feature-based new-folder coverage). Each is justified in code and the epic doc, and the reference plans still score ≥ 0.95. A reviewer should be aware that part of the 0.690 → 0.956 delta is measurement correction, not model improvement.
- **Run-to-run variance at `temperature: 0`** (opencode-backed model): one-task and ±0.075 case-score swings. The mean is ≥ 0.85 with margin, but one case (`express-notes-auth-search`) landed exactly on 0.850 in the canonical run because it omitted the auth→search edge. A stricter case-level threshold would need more than one run per case.
- **Two 0.9 cases are answer-key strictness, not broken plans:** `conflict-bait` misses `src/ui/styles.css` (the doctrine discourages owning global styles) and `python-cli-json-config` loses 0.1 on lanes; both are validator-clean and executable.
- **`launch-day` shape** hit 7 tasks in four of five recent runs and 6 in one; the ± 1 range is the honest contract, not a guarantee of exactness.

## From 49-robustness

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


## From 51-fully-open


1. `packages/llm/src/index.ts` (not in this lane; consumers can only import the package root) — export
   the new surface so the CLI, engine and auditor can use it:

   ```ts
   export { createLLMFromEnv, opencodeFallbackConfig, reportProfile, resolveLLMProfile } from './env';
   export type { EnvProfileOptions } from './env';
   export type { LocalHostProfile, LocalModelChoice } from './profiles-recommend';
   export {
     chooseLocalModel, hostProfile, parseRecommendation, readRecommendation,
     RECOMMENDATION_RELATIVE_PATH,
   } from './profiles-recommend';
   export type { OllamaProbe, OllamaProbeOptions } from './profiles-probe';
   export { nativeOllamaUrl, probeOllama } from './profiles-probe';
   export type { ProfileResolution, ProfileWarning, ProfileWarningCode } from './profiles';
   export {
     describeProfile, LOCAL_BASE_URL, LOCAL_PROVIDER, MIXED_CLOUD_ROLES, MIXED_LOCAL_ROLES,
     resolveProfile,
   } from './profiles';
   ```

   Why: `starling doctor` should print `describeProfile(resolveLLMProfile())`, and Epic 44 wants
   `opencodeFallbackConfig` instead of a second fallback table. Without the exports those callers
   must deep-import `@starling/llm/src/...`, which the package `exports` map forbids.
2. `apps/cli` (Epic 40/22) — `starling run … --profile <name>` / `--fully-open` mapping to
   `STARLING_LLM_PROFILE`, and the `doctor` lines above. `smoke.sh` probes `run --help` for
   `--profile` and uses the real harness the day it exists.
3. Two **test-only** edits outside the literal lane, made because adding `mixed` changes the public
   constant and the `local` default model: `packages/llm/src/index.test.ts` (expected
   `LLM_PROFILES`) and `packages/llm/src/routing.test.ts` (expected local model + hermetic
   `skipRecommendation`). No production file outside the lane was modified.

**Deliberately deferred / out of scope:**

- The real fully-local run (one tiny task, tokens/s, memory) — Epic 72 "local model day", per L31
  revised. `smoke.sh` is written, `bash -n`-clean and dry-run-clean, and is not run here.
- Pulling/recommending any model > 20 GB; `recommendation.json` is absent on this machine and the
  built-in default is used.
- The auditor's own model-choice logic (Epic 44) — this epic only publishes the names
  (`MIXED_LOCAL_ROLES`/`MIXED_CLOUD_ROLES`, warning codes) and the fallback helper.
- Perch-lent inference (Wave 3 stretch).

**Open questions / flagged tradeoffs:**

- **Two sessions worked in this worktree.** Another session on `epic/51-fully-open` was editing
  `tools/fully-open/**` concurrently (the opencode config investigation, the smoke report, README
  wording). The final files are the merged result; the first four commits on this branch hold parts
  of both. Nothing was force-pushed and no work was discarded, but the commit boundaries are not as
  clean as usual.
- `mixed` can move a *single* call to opencode mid-run if Ollama flaps; the warning is logged but the
  dashboard metric ("local vs API calls") does not yet distinguish a fallback from a deliberate
  route.
- `limit.context: 32768` in the opencode config is a deliberate ceiling for tool calling on a 27B
  model; the model's native window is larger and a future epic may raise it per role.

## From 52-ci

 none. No file outside `.github/workflows/**`, `docs/epic-52-ci.md` and this handback
was changed. The expected `scutil`/`vm_stat` guards were unnecessary because those probes are injected
in tests; if a future test calls them directly, the exact guard is
`test.skipIf(process.platform !== 'darwin')('…', async () => { … })`.

**Deliberately deferred / out of scope:**
- Release automation and publishing (Wave 3), as instructed.
- Live model/opencode/GitHub tests in CI (never; `STARLING_LIVE` stays unset).
- Branch protection / required checks: a repository-settings change, not a file in this lane. The
  Orchestrator should mark `lint + typecheck`, `test (ubuntu-latest)`, `test (macos-latest)` and
  `build apps/web` as required on `main`.
- Coverage uploads, CodeQL/Dependabot and a Bun-version matrix: Wave 3 polish / contradicts the L21 pin.

**Open questions / flagged tradeoffs:**
- The macOS job does not cover `apps/cli`, `apps/server` or `packages/flock`; widening it costs macOS
  runner minutes. Widen deliberately if a macOS-only regression appears outside the three packages.
- `actions/cache` saves only after a successful job, so the first run on a new lockfile is cold
  (~30–60 s install). This is intentional; a cache that never misses would be a cache that lies.

## From 53-web-launch

1. **Epic 41 — shell wiring** (`apps/web/src/app/`): render `<LaunchPanel />` (e.g. a “Launch” region or sheet) with:
   - `runs={sortedRuns(state)}` from `data/selectors.ts`, `onOpenRun={(id) => skyActions.setActiveRun(id)}`;
   - `recentRepos` = unique `goal.repoPath` values across `sortedRuns(state)`, most recent first, plus `DEMO_REPO_PATH`; optionally persist locally under `starling.recentRepos`;
   - `goals={[...DEMO_GOALS]}` (re-exported from `features/launch`);
   - `onLaunch={(input) => fetch('/api/runs', {method:'POST', …}).then(r => r.json())}` — the body is `goal`, `repoPath`, `dryRun`, `maxParallel`, `budgetUsd`; after `{runId}` set the follow/active run so the Sky shows it;
   - `onPreview={(input) => postPreview(input)}` against the new endpoint below.
2. **Epic 41 — preview endpoint** (`apps/server/src/routes/runs.ts` + `apps/web/src/data/`): add `POST /api/runs/preview` accepting the same body as `POST /api/runs` and returning `{ plan, issues }` right before `start()` would merge→audit. Implementation options: call `EngineApi.preview` when present (CONTRACT REQUEST 2), else map the repo and call `Planner.plan` in a server-owned planner instance; never persist a run and never create a worktree. Return 501 with `{ error: 'PREVIEW_UNAVAILABLE' }` when neither is wired. Add a web client `previewRun(input)`.
3. **Epic 41 — budget plumbing**: accept `budgetUsd` in `StartRunBodySchema` and pass it to the engine once CONTRACT REQUEST 1 lands. Until then the UI must keep saying “cap” without enforcing it; ideally trim or hide the field if the server rejects it.
4. **Epic 41 — playground route**: add `'launch'` to `PLAYGROUNDS` in `apps/web/src/lib/route.ts` and a lazy `LaunchPlayground` branch (plus a `TITLES` entry) in `apps/web/src/app/PlaygroundHost.tsx`. The feature already ships `Playground.tsx` and `playground.html`.
5. **Epic 41 — initial repo**: read the last successful repo from the URL (`?repo=`) or localStorage and pass it first in `recentRepos`; the panel only starts from `recentRepos[0]`.

**Deliberately deferred / out of scope:**
- Server endpoints and the preview implementation (Epic 41; the panel only calls props).
- Shell wiring, routing and store access (Epic 41).
- Per-run budget enforcement (needs contract + engine changes).
- Repository browsing (native directory picker / server-side listing); the form takes a path, as specified.
- Run cancellation/abort, pagination, filters and diff previews in history.
- Visual polish of the rest of the dashboard (Epic 47/55).

**Open questions / flagged tradeoffs:**
- The cost heuristic is a stage aid, not a forecast: 40k/6k tokens per task and a 1.35 retry factor. If Epic 48/29 produces measured per-goal costs, replace the constants in `estimate.ts` (one file) rather than tuning the UI.
- `budgetUsd: 0` is described as “plan only”. That is true only once the engine reads the per-run budget; with a config budget it is advisory. The UI copy and the FIX REQUEST should land together.
- The overlap badge can be stricter than the planner (it also counts error-severity `issues`). That is intentional: a demo must never show “clear” over a plan the validator will reject.
- Late preview responses are not cancelled (no `AbortSignal` in the prop contract); the stale marker makes the mismatch visible instead. If Epic 41 adds cancellation, extend `onPreview`’s input with a signal or return an abortable handle.

Closes #40

## From 55-web-panels-polish

1. **Epic 40 — `packages/core/src/contracts.ts`:** add `nodeName?: string` to `TaskRun`. The queue card
   wants the node's display name without a selector lookup; today it renders the id. Already handled
   structurally (`TaskRunWithNodeName = TaskRun & { nodeName?: string }` in `queue/node-name.ts`), so
   this is additive and non-blocking.
2. **Epic 40 — `packages/core/src/handshake.ts`:** add `selectedTask?: string` to `MergeQueueProps` /
   the queue handshake. The board highlights the selected card today behind an optional prop; promoting
   it removes the local mirror.
3. **Epic 41 (layout) — queue column widths:** the six queue columns are equal `flex-1`, so five empty
   stages take five sixths of the board while "On the wire" scrolls at 7+ cards. Occupied columns should
   grow proportionally. This is a shell grid decision, so it was not made from this lane.

**Deliberately deferred / out of scope:**
- Sky (Epic 47), data layer/layout (Epic 41), launch panel (Epic 53), stats page (Epic 68), core types
  (Epic 40) — untouched.
- Queue column widths (FIX REQUEST 3).
- Audit check-name column wraps at hyphens ("definition-of-" / "done"); readable, slightly untidy.
- The compact rail's bare task-count badge (`5` next to `0/8`) is explained by its tooltip only — no
  room for "5 tasks" at 15 rem.
- Virtualisation is per column; a single-column phone layout would want its own threshold.

**Open questions / flagged tradeoffs:**
- **Count-up vs exactness on the final sample.** The meter animates while `live` and snaps otherwise.
  If the shell ever marks a finished run as `live`, the last figure would animate once; the shell
  currently passes `live` only while streaming.
- **`off-peak` note wording** was shortened from `peak rates · off-peak ≈ $0.02` to `off-peak $0.02`
  to fit the ~110 px column at 1280; the full explanation lives in the tooltip. Anyone reading only the
  note sees the cheaper figure without the word "peak", hence the `API · DeepSeek` label directly above
  it. Flagging in case product prefers the longer line plus a taller strip.
- **Flock de-chrome** assumes the shell keeps wrapping the panel in a titled `Panel`. Rendered
  standalone (the Playground), flock has no title of its own any more; the Playground page title covers
  it. If a future host renders it bare, it will need a heading back.

## From 56-repomap-prompts


1. `packages/planner/src/render-map.ts` (Epic 48) — the planner still renders its own repo map (`renderRepoMap` with `maxFiles`/`maxSymbols`/`summaryChars`). That is now the third-and-last duplicate; `@starling/repomap`'s `renderRepoMap(map, { maxTokens, maxFiles?… })` covers it. Please adopt it when the planner lane next changes, so the planner and the worker see the same file lines.
2. `docs/epic-11-repomap.md` and `docs/epic-13-prompts.md` — stale in three places (markdown heading symbols, `maxFiles` 5,000 and "the prompt package has its own minimal renderer"). The orchestrator owns cross-epic docs; corrections are in `docs/epic-56-repomap-prompts.md`.

**Deliberately deferred / out of scope:**

- Go (`go.mod`-relative) and Rust (`crate::`) imports, and absolute Python imports; the import graph is JS/TS + Python-relative only. Neighbours for gin/serde therefore come from siblings (usually none).
- Python/Rust lint detection (black/ruff/flake8/isort are indistinguishable without running them).
- More than one test command per repo; polyglot secondary suites stay invisible.
- A cheaper `tokenEstimate` (still renders the whole map; 193 ms of Django's 580 ms).
- Any LLM call, the planner (Epic 48) and the resolver prompt (Epic 45), per the assignment.

**Open questions / flagged tradeoffs:**

- The worker map excludes `map.tree` on purpose (budget for lane + neighbours). For a repo shape where the tree is the most useful orientation (unfamiliar monorepos), a compact `dir/ (N files)` line might beat 30 sampled paths — needs a prompt-quality eval with a real model, which this epic could not run (L23/no real calls).
- 60 owned files at ~90 characters each is the entire map budget. A planner that emits package-wide lanes will produce prompts where neighbours and orientation silently disappear (footer says so). Worth a `PlanIssue` warning above ~40 owned files in the planner lane.
- The nested-package rule picks by file count, so `bulletproof-react` resolves to `apps/nextjs-app` rather than the Vite app in `apps/react-vite`. Any of the three is a correct command; a human would pick by the goal. Left deterministic and documented.

## From 57-workspace-hardening


1. `apps/cli/src/**` (Epic 22/CLI lane) — add the `starling gc` command the assignment reserved for a
   FIX REQUEST: `starling gc [--repo .] [--worktree-root <dir>] [--dry-run] [--older-than-hours 12]
   [--include-integration] [--json]`, implemented as
   `recoverWorkspace(repo, worktreeRoot ?? join(dirname(repo), '.starling-worktrees'), {...})` and
   printing `report.entries`/`report.removed` (exit 1 when `report.errors` is non-empty). The report
   is JSON-serialisable as-is.
2. `packages/engine/src/**` (Epic 49) — call `recoverWorkspace(repo, worktreeRoot, { liveRunIds })`
   once at run start (or on hub startup) with the run ids that currently have sessions, so a crashed
   run's worktrees and `starling/*` branches are reclaimed before the next dispatch. Suggested:
   `liveRunIds` = short run ids of every run in `pending|running|auditing|fixing|merging`.
3. `packages/engine/src/**` (Epic 49) — today nothing deletes task branches after a merge; the merger
   merges into the integration branch and `Workspace.remove` removes the worktree only. If branches are
   meant to be cleaned per run, either add that to the merge path or rely on the gc wiring above.
4. `apps/cli/src/**` + `starling.config.yaml` schema (root config is not my lane) — the two new knobs
   `worktree.maxGitConcurrency` and `worktree.pruneIntervalMs` are supported by
   `createWorkspace` but not plumbed from config; defaults (4…12, 10 s) are sane, so this is optional.

**Deliberately deferred / out of scope:**

- Merge logic, the engine, CLI wiring (per the assignment).
- Automatic submodule initialisation; LFS object download/push.
- Bundle-file garbage collection.
- Sparse-checkout derivation from `TaskSpec.lane` (needs engine input).
- Windows verification.

**Open questions / flagged tradeoffs:**

- **Machine load makes absolute timings non-comparable.** The final stress run reports load average
  23.1/22.4/40.1 because sibling agents were building on this same 10-core laptop (earlier runs saw
  load in the 90s–100s). Phase wall clock and the zero-failure result are the meaningful parts; the
  p95s should be re-measured on a quiet machine before quoting them as a product claim.
- **`GIT_LFS_SKIP_SMUDGE=1` is a deliberate product decision**: Starling never downloads LFS content.
  If a future epic needs binary assets for a task, it must opt in explicitly rather than re-enabling
  the smudge filter globally.
- **Should `recoverWorkspace` delete integration branches by default?** I chose protection (the branch
  is the deliverable); if the product wants a strict "leave nothing behind", `includeIntegration: true`
  is one flag away — but it can destroy the only copy of a crashed run's work.
- **`stat` apparent size vs allocated blocks.** The report shows both because 5 000 tiny files cost one
  block each (31 KB apparent vs 1.6 MB allocated for a 406-file sample). If a future metrics panel
  shows "disk per worktree", it should use `du`-style allocation, not `st_size`.

Closes #81

## From 58-demo-targets

**Status:** Complete. Branch `epic/58-demo-targets` @ `303c9bb` (docs + this handback land in the commit on top). One documented deviation: the `stage` answer key lives in `.starling-answers/` instead of `demo-goals/` — see FIX REQUESTS.


## From 59-landing-site

1. **Epic 52 — deploy the site to GitHub Pages.** Add `.github/workflows/pages.yml`:

   ```yaml
   name: pages

   on:
     push:
       branches: [main]
       paths:
         - 'site/**'
         - '.github/workflows/pages.yml'
     workflow_dispatch:

   permissions:
     contents: read
     pages: write
     id-token: write

   concurrency:
     group: pages
     cancel-in-progress: true

   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v2
           with:
             bun-version: 1.4.4
         - run: bun install --frozen-lockfile
         - run: bun run --cwd site typecheck
         - run: bun run --cwd site test
         - run: bun run --cwd site build
         - uses: actions/configure-pages@v5
         - uses: actions/upload-pages-artifact@v3
           with:
             path: site/dist

     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

   Relative asset URLs mean the project-page path (`/starling/`) works without a `base` setting.
2. **Epic 52 — include the site in `ci.yml`.** `site/` is outside the Bun workspace, so root
   `bun run check` does not typecheck it and root `bun run test` does not run its 21 tests. Add a
   `site` job (same four commands as the Pages build job above).
3. **Root-script owner (E00/integrator, if you prefer CI-free local parity).** Exact additions to
   root `package.json`:
   ```json
   "test": "bun run test:packages && bun run test:web && bun run test:site",
   "test:site": "bun test site/src",
   "check": "biome check . && bun run typecheck:site && bun run typecheck",
   "typecheck:site": "bunx tsc --noEmit -p site/tsconfig.json"
   ```
4. **Epic 68 — write the stats file.** Path: `site/data/stats.json`. Canonical shape:
   `{ generatedAt, source, totals: { epics, prs, tests, agents, laptops, commits } }`. Aliases and
   array-derived values are tolerated by `site/src/stats.ts`; see `site/README.md`.
5. **Epic 60 — link the page/screenshot** from the README (`site/`, `site/screens/hero.png`), and
   reuse the screenshot's `og:image` idea if useful. No change needed in this lane.

**Deliberately deferred / out of scope:**
- Actual deployment and custom domain/canonical URL (Epic 52 / release).
- Root README and docs hub (Epic 60).
- Live run data or an embedded dashboard; the page only shows the build snapshot and links the
  `starling dash` command.
- Automated visual regression (a screenshot script and browser matrix would add dependencies).
- Rendering Epic 68's full wave timeline; the About page owns that richer view.

**Open questions / flagged tradeoffs:**
- **Placeholder stats**: epics 28, PRs 28, tests 1,785, agents 35, laptops 2, commits 37 are a
  snapshot of this branch's history. They will read as stale until Epic 68 runs; the note on the page
  says "Snapshot of this build" rather than implying live data.
- **Repo URL is hardcoded** (`github.com/broiisapro/starling`) in links and `og:image`. If the
  submission repo moves, that is one file (`site/index.html`) plus `site/README.md`.
- **`og:image` uses `raw.githubusercontent.com`** so sharing cards work before Pages is deployed. If
  Pages lands at a stable URL, switching to that absolute URL would be marginally more robust.
- **No Firefox/Safari screenshots** were captured; the APIs used are broadly supported, but a
  browser matrix belongs with the Epic 71 e2e work if judges will use non-Chromium browsers.
- **The hero is decorative by design**: the canvas has no textual equivalent beyond the story around
  it. That keeps the page readable for screen readers and non-canvas browsers, at the cost of not
  describing individual birds.

## From 60-readme

1. **Epic 52 (CI)** — keep the workflow filename `.github/workflows/ci.yml`; the README badge points at
   `https://github.com/broiisapro/starling/actions/workflows/ci.yml/badge.svg?branch=main`. If it needs a
   different name, ask me for a one-line README change rather than editing it. Make the workflow run
   `bun run check` and both `test:packages` + `test:web` halves so the badge means what the README says.
2. **Epic 40 / 42 / 61 (real wiring)** — when the CLI drops the mock composition, update the README's `⏳ v0.1`
   markers and the status callout. Search `README.md` for `v0.1`, `mock composition` and `two-terminal`. Also
   remove `apps/cli`'s footer "Wave 1 runs on the mock composition; real wiring lands in Epic 40" (not my
   lane) — it is the last stale Wave 1 string a user sees.
3. **Epic 68 (swarm stats)** — replace the placeholder table in `README.md` §"Built by the flock"
   (`| Waves | Epics | Agents | Laptops | PRs |`) and the sentence below it with collector output, then delete
   the "coming in v0.2" note.
4. **Epic 61 (onboarding)** — if `starling init` gains `--yes`/`--dry-run`, add them to the README quickstart
   and the CONTRIBUTING setup example.
5. **Epic 59 (landing site)** — reuse `docs/assets/diagrams/*.svg` and the palette rules in
   `docs/assets/diagrams/README.md`; do not fork a second diagram set.

**Deliberately deferred / out of scope:**
- Demo GIF (the brief allowed screenshot(s); a GIF needs a stable live dashboard owned by other lanes).
- Release notes / CHANGELOG, landing-site copy, a real logo mark, Windows instructions.
- Live swarm numbers — Epic 68 owns the collector; README keeps honest placeholders.
- Real-run screenshots — the only committed screenshot is the C1 demo run.

**Open questions / flagged tradeoffs:**
- **CI badge is dark until Epic 52 merges.** It resolves automatically once `.github/workflows/ci.yml` exists;
  the alternative was omitting the badge, which felt worse for a repo that is about to gate every PR.
- **Heading ink `#5a6673` is 3.2:1 on GitHub dark** — fine at 24 px/650 weight and for box titles, below 4.5
  for long body copy, which is why body text uses `#6f7b89` (4.1:1). A theme-aware SVG would allow more
  contrast but breaks under GitHub's theme/OS mismatch; the single-palette tradeoff is documented in
  `docs/assets/diagrams/README.md`.
- **Test count is stated as 1,785** (the exact root run on this base). It will move as Wave 2 merges; the README
  only uses it once, in CONTRIBUTING, and it is cheap to update.

## From 61-onboarding

1. `apps/cli/src/program.ts` — registered `doctor --json` and `init --yes/--dry-run/--max-parallel/--no-flock`. Reason: commander rejects unregistered flags, so DoD items 2 and the `--json` deliverable are impossible without it; no prompt in Wave 2 lists `program.ts` as anyone's lane. Diff is confined to the `doctor`/`init` registrations, their examples and the help text.
2. `apps/cli/src/program.test.ts` — four parse assertions for those flags (`--json`, `--yes`/`--dry-run`/`--max-parallel`, `--no-flock`). Reason: a flag change without a parse test would be untested; same file ownership situation as (1).

Integrator note: Epic 40 adds `run --budget` and `plan --json` to the same `program.ts` region, so expect a small, additive conflict there.

Also touched, inside the feature but not named in the lane list (call it out for the lane audit): new `apps/cli/src/doctor-probes.ts` + `doctor-probes.test.ts` (the probe split), and the regenerated `apps/cli/src/render/__snapshots__/doctor.test.ts.snap` (owned by `render/**` = Epic 40, but it is the snapshot of *my* renderer).

**Deliberately deferred / out of scope:**
- `run`/`plan`/`status`/`dash`/compose and the `perch`/`flock` commands (Epic 40/42) — untouched.
- No `--fast`/`--no-server-probe` CLI flag (a dependency-level switch exists for tests).
- No auto-`ollama pull`, no `opencode auth login` automation: doctor prints the command, it does not run interactive logins.
- No verification that the chosen profile can actually complete a model call (that is `starling run`; `init` points at it).

**Open questions / flagged tradeoffs:**
- The `opencode` profile routes **all six** roles through opencode (matching `applyProfile`), not just planner/worker/resolver. Cheapest-to-start (no pulled local model needed) but a local auditor would be free; if the product wants ARCHITECTURE's mixed default in the generated file, it is a one-line change in `modelRefs`.
- `suggestMaxParallel` counts RAM only in 2 GB units and knows nothing about model size; `--fully-open` with a 20 GB local model needs a much smaller number. The rule-of-thumb line is printed so a user can correct it.
- `tools/local-models/results/recommendation.json` does not exist on this machine (Epic 28 never ran a real benchmark), so the recommended-model branch is exercised only by fixtures here.
- `hostIdentity()` gained a `bun` field (`{platform, arch, bun}`); it is CLI-internal, but anyone importing it should know the shape changed.
- Pre-existing flake to watch on `main` (not mine, not fixed — outside my lane): the 250 ms boids
  budget in `apps/web/src/features/sky/sim.test.ts` fails under heavy machine load.

## From 68-swarm-stats

1. **Epic 41 — shell routing (`apps/web/src/app/`, `App.tsx`):** add `?page=about` to the shell's page switch and mount `AboutPage` from `@starling/web`-local `features/about` with `stats` loaded once (e.g. `fetch('/stats.json')` from `apps/web/public/stats.json`, written by `bun tools/stats/collect.ts --out apps/web/public/stats.json`). Exact ask: one route branch + one loader; the component is props-only and needs no store changes.
2. **Epic 59 — landing site (`site/`):** read `site/data/stats.json` as documented. The collector already writes that path with `bun tools/stats/collect.ts --out site/data/stats.json`; no file is written there by this lane. The JSON contract is `tools/stats/types.ts` v1 (`SWARM_STATS_VERSION`).
3. **Integrator / Epic 40 — `tools/` is outside the Bun workspace:** `tools/stats/exec.ts` and `collect.ts` import `packages/core/src/index.ts` by path because there is no `@starling/core` symlink under `tools/`. Proposed change: add `"tools/*"` to root `package.json#workspaces`, give `tools/stats/package.json` `{"name":"@starling/stats","private":true,"dependencies":{"@starling/core":"workspace:*"}}`, and extend the root `typecheck` loop to `packages/* apps/* tools/*` (or add a `tsconfig.json` project reference) so `tools/stats` is typechecked by `bun run check` instead of only manually.
4. **Epic 24/23 (root `package.json` scripts)** — optional, not blocking: root `test:packages` already includes `tools`, so the collector tests run in CI; only the typecheck gap in item 3 needs attention.

**Deliberately deferred / out of scope:**
- Shell routing (`?page=about`) — Epic 41; no `Playground.tsx`/Vite dev route was added for the same reason.
- `site/data/stats.json` writing and the landing page — Epic 59.
- Lane-level aggregation ("which lane churned most"), day separators on a multi-day axis, and a lockfile/fixture-excluding line count.
- A `*.live.test.ts` against real `gh` — the unit tests fake `gh` with `fixtures/gh-prs.json`; the real call is exercised by `bun tools/stats/collect.ts` itself (verified above).

**Open questions / flagged tradeoffs:**
- "Tests" means test declarations, not executed tests (1,873 declarations vs the handbacks' ≈1,785 executed). Executing the suite inside the collector was rejected (needs install, slow, cannot run while 23 agents edit the tree). Worth aligning with Epic 40's CI numbers when it lands.
- Line totals include `bun.lock`, fixtures (`openapi.json`, 13k lines) and generated snapshots: +140k is honest "lines changed", not "hand-written source". A filter is deferred rather than silently applied.
- Peak concurrency and agent-hours come from log mtimes (within seconds of a real session end). Starling's own event log would be exact once `starling run` produces these logs.

Closes #50

## From 69-security-review


1. **SEC-01 — `apps/server` (owner: apps/server / Epic 21 follow-up).** `startServer` (`apps/server/src/app.ts:133-140`) defaults `hostname: '0.0.0.0'` and no route outside `/api/flock/*` checks a token (`mountRuns`, `mountEvents`, `mountReplay` in `app.ts:83-92`). LAN peer → `POST /api/runs {goal, repoPath}` starts an agent with shell access (RCE-by-proxy), and `GET /api/events` streams everything. Fix: default `hostname: '127.0.0.1'`, add an explicit `--lan` / `hostname` opt-in for flock, and add one `requireFlockToken` middleware for all `/api/*` except `/api/health` and `/api/flock/join` (token in `x-flock-token`, verified via `FlockHub.verifyToken`). Teach `apps/web` and the CLI to attach the token. Probes: `tools/security/unauth-routes.test.ts`, `tools/security/replay-confinement.test.ts`.
2. **SEC-02 — `packages/flock/src/hub.ts` (owner: Epic 42).** `register` (`:143-182`) replaces any node with a matching id when the URL differs, including the hub's own `LocalNode` registered as `'hub'`; `heartbeat` (`:184-199`) calls `registry.touch` for any known id. Fix: in `register`, reject `info.id === 'hub'` and any id whose stored entry has `kind === 'local'` with `StarlingError('INVALID_ARGUMENT', …)` → the route maps it to 400/409; in `heartbeat`, ignore a touch whose stored entry is `kind: 'local'` unless it originates from the hub. Probe: `tools/security/node-impersonation.test.ts`.
3. **SEC-03 — `packages/flock/src/hub.ts` + `apps/server/src/routes/flock.ts` (owner: Epic 42).** `bundlePathFor` (`hub.ts:79-125`) spawns `git rev-parse --verify ${ref}^{commit}` and `git bundle create <tmp> ${ref}` with the request's ref, and the route (`flock.ts:105-108`) surfaces `EXEC_FAILED` messages that quote git stderr (including the absolute repo path). Fix: validate ref before spawning (length ≤ 200, `^[A-Za-z0-9._/-]+$`, reject leading `-`, any `..` segment, `@{`, `:`, whitespace) and throw `INVALID_ARGUMENT` → 400 `INVALID_QUERY`; replace the git message in the HTTP response with a generic "ref not found", logging the detail instead. Probe: `tools/security/bundle-ref.test.ts`.
4. **SEC-04 — `apps/server` replay (owner: apps/server) — ✅ FIXED by Epic 41 (merged in the trial merge).** Epic 41 added `apps/server/src/replay-paths.ts` (`resolveReplayPath`, `defaultReplayRoots`) and wired it into `mountReplay` via `deps.replayRoots`/`repoRoot`: the target is resolved and `realpath`-ed and must live under the repo's `fixtures/` or `.starling/`, otherwise 403 `FORBIDDEN`. The original request was: `loadReplayFile` calls `readFileSync(path)` on the raw body value; resolve `realpath(path)`, require it under a configured replay dir, else 403, and drop the path from the malformed-recording message. That is now the behaviour; the four probes were promoted in Fix 1. Remaining half (token) is SEC-01. Probe: `tools/security/replay-confinement.test.ts`.
5. **SEC-05 — body limits (owner: apps/server + Epic 42).** `parseJsonBody` (`apps/server/src/http.ts:52-64`) and `readJson` (`packages/perch/src/perch-app.ts:290-312`) call `c.req.json()` unconditionally. Fix: reject when `content-length` exceeds 256 KiB and count streamed bytes (read via `c.req.raw.body` reader) → 413 `PAYLOAD_TOO_LARGE` / `payload-too-large`. Probe: `tools/security/body-size.test.ts`.
6. **SEC-06 — `apps/server/src/sse.ts` (owner: apps/server).** `streamEvents` (`:46-129`) opens a stream and a bus subscription per request with no cap. Fix: keep a module-level (or deps-level) `Set` of open streams with a max (32), answer 429/503 past it, and remove on the existing `stop()`; optionally abort a stream whose queued write chain exceeds N bytes. Probe: `tools/security/sse-flood.test.ts`.
7. **SEC-07 — `packages/perch/src/perch-daemon.ts` (owner: Epic 42 / Epic 31).** `:244-253` passes `txt: { code: token, node: resolvedName }` to mDNS. Fix: advertise the code only when a new `--mdns-code` flag is set (default off), or publish a distinct discovery id and require a one-time code; update `docs/epic-31-perch.md` accordingly. Probe: `tools/security/secrets.test.ts`.
8. **SEC-08 — `packages/auditor/src/lane.ts` + `packages/core/src/glob.ts` (owner: Epic 44; core change is additive/normalisation-only, so needs Epic 40's sign-off under L30).** `checkLane` (`lane.ts:34-46`) normalises with `normalizeGlobPath` (`glob.ts:16-22`), which does not resolve `..`. Fix: `const path = posix.normalize(normalizeGlobPath(file).replace(/\\/g,'/'))` and treat any path that is absolute, starts with `../`, or still contains a `..` segment as a violation before glob matching. Probe: `tools/security/auditor-lane.test.ts`.
9. **SEC-09 — `apps/server/src/static.ts` (owner: apps/server).** `resolveStaticPath` (`:50-61`) does a lexical `isInside`, then `readFileIfPresent` (`:42-47`) follows symlinks. Fix: compare `realpathSync(candidate)` against `realpathSync(root)` (both normalised) before reading; 404 on escape. Probe: `tools/security/static-confinement.test.ts`.
10. **SEC-10 — `packages/perch/src/perch-app.ts` (owner: Epic 42).** `POST /perch/tasks` (`:92-118`) passes `branch` and `fromRef` straight to `node.startTask`. Containment holds, but the hub gets a 500 with git stderr. Fix: add a zod refinement for `branch`/`fromRef` (`^[A-Za-z0-9._/-]{1,200}$`, no `..`, no leading `-`, `fromRef` also no `@{`) and a `runId`/`taskKey` charset check; 400 `invalid-body`. Probe: `tools/security/perch-tasks.test.ts`.
11. **SEC-11 — policy, not code (owner: Epic 44 / Epic 17).** The auditor (`packages/auditor/src/commands.ts:57`) and merger (`packages/merger/src/merge.ts:36`) run repo-provided commands through `sh -c`/`bash -c`. Fix: document the accepted risk in the auditor/merger docs and add an opt-in `--no-tests` (already conceptually distinct from `testCommand: auto`) or a future sandboxed runner. `tools/security/exec-argv.test.ts` fails if any *new* shell site appears or if a request value reaches one of these two.

**Deliberately deferred / out of scope:**

- No live probes of `opencode serve`, the LLM providers or `gh` (L23/L29): they need real credentials/processes and belong to a prompt-injection/credential-scope review, not an HTTP-boundary one. Reviewed by reading (`spawn.ts` keeps the server password in the child env and never logs it; the LLM router does not log headers).
- No fuzzing/property tests for bodies, refs or paths; hand-picked hostile values only.
- No memory-size assertion for the SSE queue (heap measurements are noise with ~20 agents on the box); the cap fix makes it moot.
- No dependency/CVE audit (`bun audit`) and no web XSS/CSP review of the dashboard rendering model output.
- No TLS, identity or per-node credentials: L18 makes the join code a shared LAN secret, and this epic did not relitigate it.

**Open questions / flagged tradeoffs:**

- **SEC-01's fix is cross-cutting.** Token-on-every-route needs the web shell and CLI to carry `x-flock-token`; the cheaper demo-day mitigation is binding loopback by default. The integrator should pick one before demo day; both are one commit and both are listed in the finding.
- **`test.failing` collides with parallel fixes — expected, and it happened.** Epic 41 fixed replay confinement, so Fix 1 deleted `.failing` from the four affected probes, kept the assertions, and marked SEC-04 fixed. Epic 45 moved the merger's suite from `merge.ts` to `suite.ts` and Epic 61 added a constant `ulimit -n` shell site; `exec-argv.test.ts` now allowlists all three. **Until 41/45 merge, this branch alone is red on those five probes by design** (73 pass / 5 fail); the trial merge above is green (78/0). Do not "fix" the probes back at integration.
- **`repoRoot` in the probe harness is a cross-version bridge.** `tools/security/support.ts` passes `repoRoot` through an object assertion so it compiles both before and after Epic 41's `ServerDeps` change; once 41 is merged the field is simply part of the type and the assertion can be dropped.
- **SEC-07 (mDNS) is a product tradeoff, not just a bug.** Zero-config discovery is a headline feature; the code in TXT is how it authenticates. `--mdns-code` default-off keeps both, at the cost of typing the code once. Flagged for Epic 42/31 rather than decided here.

Closes #84

## From 70-load-test

- **F1 (engine 49, high):** `pipeline.ts:150` calls `merger.merge()` directly, bypassing `MergerService.queue()`. `--raw-merges`: 2/30 failed merges, service p50 987 ms. Use `queue().enqueue(...)` when available, or serialise inside `merge`.
- **F2 (engine 49, medium):** `transition()` pumps synchronously (`run-driver.ts:623`) before `node.cleanup()` (`pipeline.ts:168`), so a slot is free while the node session is alive; `--headroom 0` reproduces `at capacity` and a failed task. Pump after cleanup or count live handles.
- **F3 (engine 49 + store 41, high):** `RunDriver.publish()` (`run-driver.ts:637-639`) and `attachRecorder` (`store/src/recorder.ts`) both persist; following both docs doubles rows (18 466 vs 9 233) and DB size. Also `*`-scoped server logs are only persisted if the recorder is attached. Pick one owner.
- **F4 (runner 15, high for demos):** `ReplayRunner` re-emits recorded `ts` (`replay.ts:227`); used live, all 9 000 agent events are stale and a `?since=` reconnect loses the transcript. Add `retime` (default true for a live clock).
- **F5 (engine 49 + contract, high):** no `TaskRun.worktreePath`, so audits run tests in the hub repo (`auditor.ts:125`). See CONTRACT REQUEST 1.
- **F6 (server 46, medium):** `sse.ts:81-87` serialises the whole backlog synchronously; 20 clients × 9 002 backlog events took 19.5 s (no-retime run). Yield every few hundred events.
- **F7 (planner 12, low):** `maxTasks` ceiling is 12, so every 30-task plan carries a warning. Make the advisory bound configurable up to swarm scale.
- **F8 (web data 41, low):** `appendCapped` (`reducer.ts:67-71`) copies the cap on every event (5 000 elements at saturation); 89 ms worst-case pause is GC churn. Ring buffer.

**Deliberately deferred / out of scope:**
- Editing any package under test (F1–F8 are requests only).
- Remote perches, bundles, node loss/migration, cancellation storms, budget exhaustion and fixer loops.
- Real LLM/opencode latency and real code-writing agents (Wave 2 rule L29).
- Conflict resolution / large or binary diffs; every task writes one small file.
- Pushing the load test into CI as a performance budget (JSON is there for it; thresholds are not).

**Open questions / flagged tradeoffs:**
- Should `MergerService.merge` serialise internally (making it impossible to bypass the queue) or should the engine learn about `queue()`? Internally is safer; the port change is cleaner. Flagged in CONTRACT REQUEST 2.
- Is "one integration branch, serial merges" the intended swarm-scale design? At 30 tasks the merge queue, not dispatch or events, is the tail (queue wait p50 5.75 s). If that is unacceptable, the fix is a merge-queue policy discussion (batched merges, multiple integration branches), not a micro-optimisation.
- Should `ReplayRunner`'s `retime` default be true always? That changes `starling replay` semantics if reused there; the runner is used both for recordings and as a live demo agent.
- The machine was at load ≈ 70 with ~23 parallel agents; numbers should be re-baselined on a quiet machine before any budget is written down.

## From 71-web-e2e

1. **Epic 47 (Sky)** — `features/sky/SkyView.tsx`: add `data-testid="sky-tooltip"` on the hover card and a freeze hook (e.g. `data-paused` / `window.__STARLING_SKY_FREEZE__`) that stops the rAF sim without reduced motion. The suite currently masks the canvas in snapshots and computes wire geometry to click a bird; both become exact with a hook.
2. **Epic 52 (CI)** — add a job: `bun install`, `bunx playwright install --with-deps chromium`, `bun run --cwd apps/web e2e`, upload traces on failure; add `e2e/**/*.ts` + `playwright.config.ts` to `apps/web/tsconfig.json` `include` (currently `bun run check` does not typecheck the e2e directory); decide per-platform snapshot dirs (baselines are macOS/font-specific).
3. **Epic 23 / 26 (shell + queue)** — at 1280×720 the merge-queue board scrolls horizontally and clips "On the wire": all seven cards are in the DOM (asserted) but only one is visible on a 720p projector. Consider a compact board (wire-first or fewer columns) at ≤1280.

**Deliberately deferred / out of scope:**
- CI wiring (FIX REQUEST 2), fixing any UI finding (FIX REQUESTS 1 and 3).
- Firefox/WebKit projects, light-theme and `?playground=` coverage, `vite preview` of the production build.
- Snapshotting the Sky canvas itself (masked until Epic 47 lands a hook).
- Live-server / real-flock browser journeys — Epic 42/43 territory.

**Open questions / flagged tradeoffs:**
- The visual baselines are locked to macOS rendering (system font stack, dark theme, DPR 1). If CI runs Linux with a different font, the first CI run will need its own baselines — is that acceptable, or should Epic 52 bundle Inter and pin a font?
- The suite hardcodes only `TASK_COUNT = 7`; a re-recorded fixture with a different plan size needs that one constant (and the keyboard/queue assertions read the same number) — fine as is, flagged for whoever re-records it.
- `openEndState` depends on the dev-only `__STARLING_SKY__` handle and the Vite `/src/data/demo.ts` URL. Both are dev-only by design; if another lane removes the handle, ten tests break loudly rather than silently — worth keeping in mind for Epic 41/55.
- A 720p projector shows one wire card (FIX REQUEST 3). If the stage machine is 720p, is that acceptable for the demo, or does the queue need a compact layout before the demo?

Closes #86

