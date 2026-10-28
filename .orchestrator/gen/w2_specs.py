RAILS = """- **L31 (memory rails for local models; this epic only)**: before loading any Ollama model, wait (poll every 60 s, up to 90 min) until **≤ 3 `opencode` processes** are running (`pgrep -fc opencode`) and free memory is ≥ 22 GB (`vm_stat` / `memory_pressure`). Unload with `keep_alive: 0` when done. If the quiet window never comes, finish everything else, mark the live part **deferred** in the handback, and stop. Never `ollama pull` a model > 20 GB."""

SPECS = []

SPECS.append(dict(nn="40", slug="integration-captain", title="Integration captain: the real end-to-end run", sub="a",
lane="""`apps/cli/src/compose.ts`, `apps/cli/src/real/**` (except `real/perch-compose.ts`, which is Epic 42's), `apps/cli/src/commands/{run,plan,status,dash,options}.ts`, `apps/cli/src/render/**` (except `render/doctor.ts`, which is Epic 61's), **`packages/core/**` (additive only; you are its sole owner this wave)**, `fixtures/real/**`. For a *blocking* bug in another package (one that stops the real run), you may make the **minimal** fix there and must list it in the handback. Non-blocking issues go in FIX REQUESTS.""",
carryover="""From the Wave 1/C1 handbacks:
1. **Core additions** (you own core this wave; all additive, all with tests):
   - `TaskRun.nodeName?: string`.
   - `MergeQueueProps.selectedTask?: string`.
   - `SkyViewProps.paused?: boolean`.
   - A new `StarlingEvent` **`run.status`** `{ from: RunStatus; to: RunStatus; run: Run }`. The engine will publish it (Epic 49 wires that), and the web reducer consumes it (Epic 41).
2. **CLI from Epic 27's requests**:
   - `starling run --budget <usd>` overrides `budget.maxUsd` for the run.
   - `starling plan --json` prints **only** the JSON (`{ plan, issues }`) to stdout, and everything else goes to stderr.
(The `init` profile default moved to Epic 61.)""",
goal="""Make `starling run` real. Implement `compose(config, { mode: 'real' })`, which builds the genuine stack from every package, and drive a **real run on the sky-todo demo repo** that ends with merged, audited, test-green work on an integration branch. You're the integration captain: when something doesn't fit, you find out why and make the smallest correct fix.""",
deliverables="""- `apps/cli/src/real/compose-real.ts` (called by `compose` for `mode: 'real'`). It wires:
  - config (`loadConfig`, profile from `STARLING_LLM_PROFILE` or config, default `opencode` on this machine), and the bus;
  - `createSqliteStore('<repo>/.starling/starling.db')` plus `attachRecorder`;
  - `createLLM`, `createRepoMapper({ llm })`, `createPlanner({ llm })`, `createPromptCompiler()`, `createWorkspace({ worktreeRoot })`;
  - `createOpencodeRunner({ mode: config.opencode.mode, … })`;
  - a flock hub with the hub's own `createLocalNode({ id: 'hub', … })` in a registry, plus `createScheduler()`;
  - `createAuditor({ llm })`, `createMerger(...)`, the tracker (`NoopTracker` unless `--github`, then `createGitHubTracker`), and `createEngine({...})` with `bundleUrlFor` pointing at the server's `/api/flock/bundle`.
  - It returns `{ engine, flock, store, bus, close() }`, where `close()` shuts down the opencode server, the store and timers. Use a disposal stack and run it on SIGINT too.
- `starling run "<goal>" --repo <path>`: real by default (`--mock` keeps the old behaviour for demos and tests). It starts the server (`startServer` from `apps/server`, serving `apps/web/dist` if built) unless `--no-dash`, prints the dashboard URL, renders the live view, and exits 0 on success with a summary (integration branch name, merged/failed, cost API/local).
- `starling plan` real (map + plan, `--json` purity), `starling status` reading the SQLite store, and `starling dash` serving the store's runs plus the live bus.
- **The real run** (L29, opencode profile, `maxParallel: 3`):
  1. `bash examples/scripts/make-demo-repo.sh /tmp/sky-e2e-1`
  2. `bun run starling run "$(cat examples/sky-todo/demo-goals/quick-wins.md)" --repo /tmp/sky-e2e-1 --no-dash --record fixtures/real/quick-wins.jsonl`
  3. Iterate until it finishes with every task merged and `bun test` green on the integration branch **inside the demo repo**.
  Then, **once**, the 7-task `launch-day.md` goal, recorded to `fixtures/real/launch-day.jsonl`. Paste both final summaries. Keep JSONL recordings under 5 MB each (truncate agent text if needed and document it).
- Fix integration bugs you hit (minimal, documented). Expected suspects: the session `directory` per worktree, runner ↔ node event demux, auditor `testCommand` for sky-todo (`bun test`), merge-queue worktree root, and bundle URLs for the hub-local node (should use `{kind:'local'}`).
- Tests: `compose-real.test.ts` builds the real composition against **fakes injected at the edges** (fake opencode server via the runner's test helpers, MockLLM) and runs a 2-task plan to completion. `*.live.test.ts` holds the real quick-wins run (gated by `STARLING_LIVE=1`; you run it once manually).""",
oos="Flock across two machines (Epic 42), GitHub mode end to end (Epic 43), the dashboard data layer (Epic 41), engine policies (Epic 49, to whom engine bugs go as FIX REQUESTS unless blocking), and the conflict resolver (Epic 45).",
dod=["`fixtures/real/quick-wins.jsonl` exists and the run summary shows **all tasks merged, integration branch tests green**. Paste the summary plus `git -C /tmp/sky-e2e-1 log --oneline <integration-branch> | head`.",
     "The launch-day real run was attempted once. Paste its summary (partial success is acceptable: document what failed and why)."]))

SPECS.append(dict(nn="41", slug="live-dashboard", title="Live dashboard: server ↔ web on real data", sub="a",
lane="`apps/server/**` and `apps/web/src/{data,app,lib,components}/**` (not the feature folders, except the one-line prop pass-throughs listed below).",
carryover="""From the C1 handbacks (Epics 23, 34):
1. **Adopt `@starling/core/browser`** in `src/data/demo.ts`, `src/data/sse.ts` and `src/lib/events.ts`. Then delete the `node:fs`/`node:path` aliases in `vite.config.ts` and `src/lib/browser-stubs.ts`. Confirm the bundle shrinks and paste the before and after sizes.
2. **`run.status` events**: core is gaining a `run.status` StarlingEvent (Epic 40). Handle it in the reducer *when present*, feature-detecting it so this compiles before and after 40 lands, so the run picker stops saying `mapping` all run.
3. **Flock join info**: the flock panel shows "Flock mode is off for this run" even with 2 nodes, because the data layer never supplies `join`. Fetch `/api/flock/join` in live mode, and synthesise a plausible `JoinInfo` in demo mode.
4. **Sky pause**: pass `paused: centreView !== 'sky'` into `SkyView` (optional spread until Epic 40 adds the prop).
5. **Selection in the queue**: pass `selectedTask` into `MergeQueue` (optional spread).""",
goal="""Turn the dashboard from a fixture player into a **live control room**. Starling's server runs alongside a real engine and store; the web app connects over SSE, lists real runs, and shows everything as it happens, while demo mode keeps working as the fallback.""",
deliverables="""- Server:
  - `startDashboard({ engine, store, bus, flock, webDist, port })` helper (Epic 40 calls it from the CLI).
  - The `POST /api/replay` path allow-list (only files under the repo's `fixtures/` and `.starling/`), closing E21's open question.
  - `GET /api/runs/:id/diff/:taskKey` returning the task's latest `DiffSummary` from stored events, or 404.
  - `GET /api/config/public` returning `{ version, profile, models (role → model id), flockEnabled }` for the UI header.
  - Graceful shutdown closes SSE streams.
- Web data layer:
  - Live mode by default when `/api/health` answers.
  - The run picker lists real runs from `/api/runs` and follows a newly started run automatically.
  - SSE resume via `since`, plus a connection badge.
  - Drawer diffs fetched lazily from the diff endpoint.
  - The header shows the model per role (from `/api/config/public`), e.g. "auditor: deepseek-v4.1-flash (opencode)".
  - The demo fallback stays one click away.
- An **end-to-end dev script** `apps/server/src/dev-live.ts`: it starts the server with an *in-process mock engine* (from core testing) that emits a realistic run, so the dashboard can be exercised live without any LLM. Document `bun run dev:live`.
- Tests: server route tests for the new endpoints; web data tests for live-mode switching, run following, `run.status` handling (with a synthetic event), lazy diff loading with a mocked fetch, and the join-info fallback.""",
oos="Engine/CLI composition (Epic 40). Visual polish of feature panels (Epic 47 for the Sky). The launch form (Epic 53).",
dod=["`cd apps/web && bun run build` OK. Paste the bundle sizes before and after dropping the node stubs.",
     "`bun run dev:live`, then `curl -N localhost:7777/api/events | head -5` shows live frames, and `curl localhost:7777/api/config/public` returns JSON (paste both)."]))

SPECS.append(dict(nn="42", slug="flock-e2e", title="Flock end-to-end: two perches, then two laptops", sub="a",
lane="`packages/flock/**`, `packages/perch/**`, `apps/cli/src/commands/{perch,flock}.ts`, `apps/cli/src/real/perch-compose.ts`, `tools/flock/**`.",
carryover="""From the Wave 1 handbacks (Epics 30, 31):
1. **Heartbeat carries the perch URL**, so the hub can re-register an unknown id; the hub answers 404 for unknown ids and the perch re-registers.
2. **Graceful leave** (no new server route; `apps/server` is Epic 41's lane): a graceful perch stop sends a final heartbeat with `status: 'offline'`, and the hub must treat that as an **immediate leave** (reason `perch-stopped`). Implement the hub side in `packages/flock`.
3. **SSE resilience**: `/perch/events` supports `Last-Event-ID` replay from a ring buffer of the last 500 events. `RemoteNode` resends it on reconnect, so a dropped stream can't lose `session.idle`.
4. Unify the `MdnsAdvertiser`/`MdnsBrowser` usage on the core port types (C1 moved them).""",
goal="""Prove **Flock mode** for real. A second machine (or a second perch on this one) joins the hub, gets tasks scheduled onto it, runs them through its own opencode, and ships the results back as git bundles, and the hub audits and merges them. Then make it a 60-second experience for the two-laptop demo.""",
deliverables="""- `apps/cli/src/real/perch-compose.ts`: builds a real perch (workspace in `~/.starling/perch/<name>`, an opencode runner in spawn mode, `createLocalNode`, `startPerch` with the hub URL and code). `starling perch --hub http://<ip>:7777 --code XXXX-XXXX [--max-sessions 5] [--name]` runs it until Ctrl-C, printing a friendly status line ("🪺 roosting on MacBook Pro · 2/5 sessions").
- `starling flock` lists nodes from the hub's `/api/nodes` and prints the join command (copy-pastable), printing the command only (a terminal QR code would need a CLI dependency, which is Epic 40's lane, so file it as a FIX REQUEST).
- **Loopback E2E** (`tools/flock/loopback.ts`): starts a hub composition **with the mock engine path replaced by real flock pieces**, meaning two real perches on ports 7781/7782 with separate cache dirs, real git bundles and the **ReplayRunner** (no LLM), and drives three tasks through `RemoteNode.startTask → events → collect → bundle → fetch into hub repo`. Then kill one perch mid-task and show the registry `left` and rescheduling. Make it a test (`*.e2e.test.ts`, runs in < 60 s, no LLM) and a script with readable output.
- **Real flock smoke (L29: opencode profile, quick-wins only, once)**: hub plus one perch on this same Mac (separate port and cache dir), with `maxSessions` 1 on the hub, so at least one task must run on the perch. Record it to `fixtures/real/flock-loopback.jsonl`. This needs Epic 40's real compose; **if it isn't on main when you get here, finish everything else and mark this step deferred** (don't build your own composition).
- Put the **two-laptop runbook** in your epic doc (not a separate file). Moksh runs it later, so make it plain steps per laptop: install, auth, `starling perch --hub … --code …`, what success looks like, and 6 troubleshooting checks (firewall prompt, same wifi, mDNS blocked → use `--hub`, hotspot fallback, clock skew, port in use).""",
oos="Web flock panel changes (Epic 41/47). Engine rescheduling logic itself (Epic 49; report engine bugs as FIX REQUESTS). LLM lending (Epic 51).",
dod=["The loopback E2E test passes. Paste its output, including the migration after the perch kill.",
     "The real flock smoke either passes (paste a summary showing ≥ 1 task with `nodeId` ≠ `hub` merged) or is explicitly deferred with the reason."]))

SPECS.append(dict(nn="43", slug="github-e2e", title="GitHub mode end-to-end (sandbox repo)", sub="a",
lane="`packages/github/**`, `tools/github-sandbox/**`.",
goal="""Prove GitHub mode against a **real repo**: a run's plan becomes issues, each audited task branch gets a PR with its verdict table, merges close issues, and the integration branch gets a final PR, all idempotent and safe to re-run.""",
deliverables="""- `tools/github-sandbox/setup.sh`: creates (or reuses) a **private** repo `<you>/starling-sandbox` via `gh repo create --private`, pushes a fresh sky-todo demo repo into it (`examples/scripts/make-demo-repo.sh`) and prints its URL. Idempotent. `teardown.sh` closes all `starling` issues and PRs and deletes `starling/*` branches, but **never deletes the repo**.
- A **tracker E2E script** `tools/github-sandbox/e2e.ts`, which drives the tracker directly, without an engine and without an LLM, using a hand-built `Run`/`Plan` (fixtures plan) and real branches:
  1. `syncPlan` creates 7 issues; re-running creates 0.
  2. For 2 tasks, create a branch with a tiny real commit, `openTaskPR` (PR into the integration branch with the verdict table), then `onMerged` (comment and close).
  3. `openFinalPR` opens the final PR to `main`.
  Print the URLs. Then run teardown.
- Fix whatever real `gh` behaviour breaks: JSON field names, the label-creation race, `--body-file` with long bodies, repo auto-detection from a worktree, rate limits (retry with backoff on secondary rate limits). Each fix gets a unit test with the fake exec that captures the real `gh` behaviour you saw.
- **Renderer polish** for judges reading PRs: the PR body shows a ✅/❌ verdict table, DoD checklist (from `AuditVerdict.dod` when present), cost (API vs local), the node that ran it, and a 🐦 footer linking the run.""",
oos="Engine integration of `--github` (Epic 40 wires the flag). CI (Epic 52). Deleting repos.",
dod=["`bash tools/github-sandbox/setup.sh` then `bun tools/github-sandbox/e2e.ts` succeed. Paste the issue/PR URLs. The second sync reports 0 created. Teardown runs clean."]))

SPECS.append(dict(nn="44", slug="auditor-tuning", title="Auditor tuning (evals, then the local model)", sub="a",
lane="`packages/auditor/**`, `evals/auditor/**`, `tools/local-models/results/**`, `tools/local-models/cases/**`.",
extra_locked=RAILS,
goal="""Make the auditor **right**, especially about the dangerous case of a false *pass*. First tune it against the auditor evals through the `opencode` profile (DeepSeek). Then, in a quiet window, run Epic 28's local-model bench and lock in which **local open-weight model** audits by default on each laptop.""",
deliverables="""- Run `bun evals/run.ts auditor --impl real` with `STARLING_LLM_PROFILE=opencode` and paste the baseline: accuracy, **false-pass rate**, false-fail rate, and fix-instruction quality.
- Tune `AUDITOR_SYSTEM_PROMPT`/`buildAuditPrompt` and the deterministic checks until **false-pass = 0** on the eval set, with accuracy ≥ 90%. Keep a changelog table in your doc (change → metric delta). Don't overfit: add **4 new held-out cases** to `evals/auditor/cases/` *before* tuning, and report them separately.
- **Local model (L31 rails)**: when the quiet window arrives, run `bun tools/local-models/bench.ts --profile mbp --models <2–3 candidates from candidates.json that are already pulled or ≤ 20 GB> --think off`, then `recommend.ts`. Commit the results JSON and `recommendation.json`. Then run the auditor evals once with `STARLING_LLM_PROFILE=local` against the recommended model and paste the comparison against DeepSeek.
- Make the auditor's default model **config-driven per profile**: `opencode` → DeepSeek via opencode; `local` → the recommended Ollama model; mixed (the demo default) → workers on DeepSeek, auditor local *if Ollama is reachable and the model is present*, else fall back to the opencode profile with a `log` warning. Put the profile mapping in `packages/auditor/src/model-choice.ts` (Epic 51 owns `packages/llm/src/profiles`; if you need a change there, file a FIX REQUEST).""",
oos="Engine fix-loop logic (Epic 49). Planner evals (Epic 48). Pulling models > 20 GB.",
dod=["The eval baseline and final tables pasted (DeepSeek via opencode). False-pass = 0 on the tuned set, and held-out results reported.",
     "Local bench run and recommendation committed, **or** explicitly deferred per L31 with the reason."]))

SPECS.append(dict(nn="45", slug="resolver", title="Conflict-resolver loop", sub="a",
lane="`packages/merger/**`, `packages/prompts/src/resolver*` (and its tests/snapshots).",
goal="""When two branches collide anyway (it happens when a plan's lanes were imperfect), Starling shouldn't just give up. It should spin up a **resolver agent** that merges both intents, prove the result with tests, and land it. Build that capability as a self-contained service the engine calls (Epic 49 wires the call).""",
deliverables="""- `createConflictResolver({ node: ExecutionNode, prompts: PromptCompiler, workspace, merger, clock })` → `resolve(ctx: { run, integrationBranch, taskA: TaskRun, taskB?: TaskRun, conflict: MergeResult, testCommand }): Promise<MergeResult>`:
  - Creates a branch `starling/<run>/resolve-<key>` from the integration branch.
  - Merges the conflicting task branch with the conflict **left in place** (commit the markers on that branch), then starts a resolver session with `prompts.resolver(...)`.
  - When the session goes idle, verifies there are no conflict markers (`git grep -n '^<<<<<<< '`), runs the tests, then `merger.merge`.
  - Bounded: 2 attempts, then `failed`.
- Resolver prompt polish in `packages/prompts/src/resolver*`: include both tasks' DoD, the conflict hunks (trimmed), "keep both behaviours and both sets of tests", and the handback.
- Tests with **real temp git repos** and a **scripted fake node** (one whose "agent" resolves the conflict by writing a scripted file content): resolved → merged; still-conflicted → retry → failed; tests fail after resolution → failed with detail.
- **Demo proof (no LLM)**: run the sky-todo `conflict-bait` goal's two tasks as hand-made branches (scripted edits to `src/ui/render.ts`), show preflight predicting the conflict, the resolver (scripted) fixing it, and the merge landing. Make it `tools`-free and a test.
- An `engine-hook.md` section in your doc giving Epic 49 the exact call site and the state transitions (`conflict → resolving(fixing) → merging → merged|failed`). Also file it as a FIX REQUEST for the engine.""",
oos="Editing `packages/engine` (Epic 49 owns it). Real LLM resolver runs (they come with the C2 integration).",
dod=["Resolver tests pass, including the conflict-bait proof test (paste its output)."]))

SPECS.append(dict(nn="47", slug="sky-polish", title="Sky polish: roosts, migrations, sound", sub="a",
lane="`apps/web/src/features/sky/**`.",
carryover="""From the C1 review of the dashboard screenshots: **roost labels are too small to read on a projector** ("MacBook Pro" at the bottom corners is a few px). The **bottom of the sky is empty for most of a run** once birds have left the roosts. And `SkyViewProps.paused` is coming (Epic 40): when `paused`, stop the rAF loop and resume seamlessly (optional prop, feature-detected).""",
goal="""Make the Sky the thing judges remember. Big readable roosts, a dramatic migration when a laptop joins, birds that visibly *work*, and an optional soundscape, all smooth on a projector at 1920×1080 and a 720p laptop.""",
deliverables="""- **Roosts**: large, readable labels (≥ 18 px at 1080p) with the node name and a small `3/5` sessions gauge; a hub crown; a gentle glow when busy.
- **Join moment**: on `node.joined` the new roost *grows* from the horizon with a ripple and a toast-like caption "🪺 MacBook Air joined the flock". On `node.left` the roost dims and "has flown away" fades.
- **Migration**: a long arc with a trail, and the flock reforms at the new roost.
- **Work cues**: birds near a task's roost show tiny sparks on `file.edited` and a beat on `tool.call`. Audit circling is amber, and the fix loop is clearly agitated.
- **The wire**: merged flocks land in merge order with the task key under them; a brief celebratory shimmer on each landing; a final "all landed" murmuration sweep when the run finishes.
- **Sound** (off by default; toggle stored per viewer in localStorage with try/catch): WebAudio synthesised chirps on landing, a soft whoosh on migration, and a low hum scaled to active agents. No audio files.
- Keep 60 fps at 360 birds (measure in the Playground and paste the fps). Reduced motion stays calm and static.
- Tests: the sim/behaviour additions (join growth, landing order, sparks decay), the paused flag stopping the loop (fake rAF), and the sound toggle persistence (mock storage that throws).""",
oos="Data layer or layout (Epic 41). Other panels.",
dod=["Feature tests pass. Paste the Playground fps measurement and (if Playwright is available) commit 2 screenshots ≤ 300 KB: mid-run, and the join moment."]))

SPECS.append(dict(nn="48", slug="planner-quality", title="Planner quality pass (evals with the real model)", sub="a",
lane="`packages/planner/**`, `evals/planner/**`.",
carryover="""From Wave 1: adopt `@starling/repomap`'s `renderRepoMap` in the planner (it replaces the planner's own `render-map.ts`) and compare eval scores before and after. Also from Epic 29: if the real planner emits `lane-overlap` only as a warning after repair, the evals treat it as clean, so decide whether that's right and document it.""",
goal="""Make the planner produce decompositions a senior engineer would sign off on: lane-safe, well-sized, correctly ordered, with sharp definitions of done. Measure with the planner evals against the real model (opencode profile), then improve.""",
deliverables="""- Baseline: run `bun evals/run.ts planner --impl real` with `STARLING_LLM_PROFILE=opencode` over all cases. Paste the table (score, validator, coverage, deps, lanes, DoD per case).
- Improve the prompt, the repair loop and the rendering until the **average score is ≥ 0.85**, with **every case passing the validator** and the `launch-day` case producing the expected 7-task shape (± 1 task). Keep a change → delta table.
- **Plan latency**: measure end-to-end plan time for launch-day. If it's above 60 s, try cheaper repo-map budgets and report the trade.
- **Determinism helpers**: `temperature` 0 by default for planning, and a stable task-key scheme (`tNN-kebab`).
- Unit tests for every new rule. Snapshot the final system prompt.""",
oos="The repomap package itself (file FIX REQUESTS). The engine. Auditor evals (Epic 44).",
dod=["Final eval table pasted: average ≥ 0.85, all validator-clean, launch-day shape OK (or an honest shortfall analysis)."]))

SPECS.append(dict(nn="49", slug="robustness", title="Robustness + engine ownership", sub="a",
lane="**`packages/engine/**` (sole owner this wave)**, `packages/runner/**`, `packages/llm/src/providers/opencode*` (and tests).",
carryover="""1. **One opencode V2 client.** `packages/llm` and `packages/runner` each wrote their own V2 REST client (Wave 1). Make `packages/runner`'s the single client: export it, and have `packages/llm`'s `opencode` provider use it (keep `createOpencodeCompletionClient`'s public signature).
2. **Engine `run.status`**: publish the new `run.status` StarlingEvent (Epic 40 adds it to core) on every run status change, feature-detected until it lands, and fill `TaskRun.nodeName` from the registry when dispatching.
3. **Wire the conflict resolver** from Epic 45 once its PR is on main (its doc has an `engine-hook.md` section): `conflict → fixing (resolver) → merging`. If it isn't merged by the time you finish everything else, leave a clearly marked hook and note it.""",
goal="""Starling must survive the real world on stage: agents that stall, providers that rate-limit, perches that vanish, budgets that run out, and a presenter who hits Ctrl-C. Make the engine and runner bulletproof, observable and politely self-healing.""",
deliverables="""- **Stall detection** (`packages/engine/src/policies/stall.ts`): no agent event for `stallAfterMs` (config, default 4 min) → abort the session and resend the prompt once (counts as an attempt) → else `failed` with a reason.
- **Rate limits**: the runner detects provider 429/overload errors in opencode session errors and backs off with jitter (shared across sessions: a token bucket per provider). The engine **reduces effective parallelism** temporarily (AIMD) and logs it.
- **Budget**: hard cap from `budget.maxUsd` and `--budget`; a warning at 80%; the stop at 100% lets running tasks finish; the summary says what was skipped.
- **Kill switch**: `cancel` aborts every session, removes worktrees (keeping branches) and leaves the store consistent. A second Ctrl-C force-exits. Test the cleanup.
- **Perch loss**: the reschedule path keeps the task's **attempt count** and its **latest commit**, if a bundle was collected before the loss.
- **Observability**: a `log` event for every policy action, with a stable `code` so the UI can show it.
- Tests for each policy with FakeClock and mocks, plus the client unification tests (both providers green).""",
oos="The CLI composition (Epic 40), flock transport (Epic 42) and resolver internals (Epic 45).",
dod=["`bun test packages/engine packages/runner packages/llm` passes. Paste a summary of each policy test group."]))

SPECS.append(dict(nn="51", slug="fully-open", title="Fully-open mode (all roles local)", sub="a",
lane="`packages/llm/src/profiles*`, `packages/llm/src/env*`, `tools/fully-open/**`.",
extra_locked=RAILS,
goal="""Prove Starling runs with **zero cloud**: every role, including the coding workers, on local open-weight models through Ollama and opencode's Ollama provider. It's slower, but it's the strongest open-source story, and the demo can show a one-flag switch.""",
deliverables="""- `local` profile finalised: planner/auditor/summarizer/writer → the recommended local model (read `tools/local-models/results/recommendation.json` if present, else `qwen3.8:27b-mlx`); workers → opencode with its **Ollama provider**. **Investigate** how the installed opencode version configures an Ollama/OpenAI-compatible local provider, and generate that config via `tools/fully-open/opencode-ollama.json` plus instructions. Don't edit the user's global config; use the project-level config or env.
- A `mixed` profile (the demo default): workers and planner on DeepSeek via opencode, auditor and summarizer local *if available*, else falling back to opencode with a warning (the same rule Epic 44 implements on the auditor side; agree on names via your doc).
- `tools/fully-open/smoke.sh` (L31 rails): with the quiet window, run **one** tiny task fully locally (a 1-task goal on a fresh sky-todo, e.g. "add a footer stat showing done/total") via `starling run --profile local` *if Epic 40's real run is on main*. Otherwise drive the opencode Ollama provider directly with a one-shot prompt and report tok/s.
- Tests for profile resolution and fallbacks (Ollama down, model missing, recommendation file missing).""",
oos="Perch-lent inference (deferred to Wave 3 stretch). The auditor's own model choice logic (Epic 44). Pulling models > 20 GB.",
dod=["Profile tests pass. The fully-local smoke either succeeded (paste the timing) or was deferred per L31 with the reason."]))

SPECS.append(dict(nn="52", slug="ci", title="CI: GitHub Actions", sub="a",
lane="`.github/workflows/**`.",
goal="""Add CI so every PR from here on is checked automatically: Biome, typecheck and both test halves. It must be fast and green.""",
deliverables="""- `.github/workflows/ci.yml` on `pull_request` and `push` to `main`:
  - Setup via `oven-sh/setup-bun` pinned to Bun 1.4.4.
  - `bun install --frozen-lockfile`, `bun run check` and `bun run test`, with a Bun install cache.
  - Runs on `ubuntu-latest`, plus a `macos-latest` job for `packages/workspace packages/merger packages/perch` (git and OS-specific code).
  - Concurrency cancel-in-progress.
- Make tests that assume macOS (`scutil`, `vm_stat`) skip cleanly on Linux. If a test in another lane needs a guard, file a FIX REQUEST with the exact one-line guard rather than editing it, **unless** CI can't go green without it, in which case make the minimal guard and list it.
- `.github/workflows/web-build.yml`: builds `apps/web` and uploads `dist` as an artifact.
- A README-ready status badge snippet in your doc.
- Prove it: push your branch and get the workflow green on your own PR (iterate). Paste the run URL.""",
oos="Release automation and publishing (Wave 3). Live tests in CI (never).",
dod=["Your PR's CI run is green on both jobs. Paste the URL."]))

SPECS.append(dict(nn="53", slug="web-launch", title="Web: launch a run + run history", sub="a",
lane="`apps/web/src/features/launch/**`.",
goal="""Let a presenter start a run **from the dashboard**: pick a repo, type or choose a goal, see the plan preview with lanes, press "Release the flock", and browse past runs. That makes the demo a single screen.""",
deliverables="""- `export function LaunchPanel(props: LaunchPanelProps)` (define `LaunchPanelProps` locally in `features/launch/types.ts`: `{ onLaunch(input: StartRunInput): Promise<{ runId }>; onPreview?(input): Promise<{ plan; issues }>; recentRepos: string[]; goals: { name: string; text: string }[]; runs: Run[]; onOpenRun(id: string): void }`). It's props-only, and the shell wiring is a FIX REQUEST for Epic 41.
- A form with a repo path (recent dropdown), a goal textarea with **quick-pick chips** for the sky-todo demo goals (`launch-day`, `launch-day-xl`, `quick-wins`, `conflict-bait`), max-parallel, a budget and a dry-run toggle.
- **Plan preview** (`onPreview`): a compact table of tasks with lanes and dependencies, and an overlap check badge.
- A big primary "🐦 Release the flock" button with a confirm step showing estimated cost.
- **Run history**: a list of runs with status, merged/failed, cost and duration; click to open.
- Validation and error states, keyboard-first, accessible.
- Tests (happy-dom): submit calls `onLaunch` with the right input, chips fill the goal, preview renders tasks and overlap state, history renders and opens runs, and error states.""",
oos="Server endpoints (they exist: `POST /api/runs`. A preview endpoint is a FIX REQUEST for Epic 41 if missing). Shell wiring.",
dod=["Feature tests pass. A Playground renders with fixtures."]))

# ---------------- Wave 2b (after 40 merges) ----------------
SPECS.append(dict(nn="46", slug="golden-demo", title="Golden demo run + replay polish", sub="b",
lane="`packages/store/**`, `fixtures/demo/**`, `apps/cli/src/commands/replay.ts`.",
goal="""Produce the **golden recording**, a real Starling run that looks great in the dashboard, and make replay bulletproof, so the demo works with no wifi and no API.""",
deliverables="""- Using Epic 40's real composition (opencode profile), run `launch-day` (or `launch-day-xl` if it completes in < 15 min) on a fresh sky-todo, with `--record fixtures/demo/golden.jsonl`. If a perch is available (Epic 42's loopback perch on this Mac counts), include it so the recording shows a join and a migration.
- Curate it, without fabricating anything:
  - Trim agent `text` events to keep the file ≤ 5 MB.
  - Keep every status/verdict/merge/node event.
  - Add a `fixtures/demo/golden.meta.json` (goal, date, duration, cost, nodes, model ids).
- `starling replay fixtures/demo/golden.jsonl --speed 8 --dash` opens the dashboard replaying it. (The server's replay endpoint allows `fixtures/` via Epic 41's allow-list.)
- Store: replay **seek** (`--from 50%`), pause/resume via SIGTSTP/SIGCONT or a keypress in the CLI, and a guarantee that replays never write to the live DB.
- The web demo mode switches its default fixture to the golden recording (a FIX REQUEST for Epic 41 if their PR isn't merged yet; one line in `data/demo.ts`).""",
oos="Editing the engine or composition. Fabricating events.",
dod=["`fixtures/demo/golden.jsonl` + meta committed. Paste the meta and a `starling replay … --speed 50` final summary."]))

SPECS.append(dict(nn="50", slug="skill-e2e", title="Skill end-to-end from inside opencode", sub="b",
lane="`skills/**`, `integrations/**`.",
goal="""Prove the Agent Skill works the way a user would use it: inside an opencode session, the agent recognises a multi-part goal, uses the Starling skill to plan (dry run), shows lanes, and on confirmation runs the flock.""",
deliverables="""- Install the skill and `/swarm` command into a fresh sky-todo demo repo (project scope).
- Run **one** opencode session (`opencode run --model "$STARLING_DEV_MODEL" --auto …` in that repo) with a natural user message such as "Add dark mode and CSV export and fix the date bugs, in parallel if you can". Capture the transcript to `skills/starling/examples/real-session.md` (trimmed) and check the agent picked the skill and called `plan.sh` with `--json`.
- Then `/swarm quick-wins goal` end to end (a real run via Epic 40's compose, opencode profile, quick-wins only). Record the outcome.
- Fix any skill/command friction found (paths, JSON parsing, exit codes, wording that didn't trigger the skill). Add tests for the fixes.""",
oos="CLI/engine changes (FIX REQUESTS). More than one real run.",
dod=["The real transcript is committed, and the `/swarm` quick-wins run summary pasted (or an honest failure analysis with FIX REQUESTS)."]))

SPECS.append(dict(nn="54", slug="dogfood", title="Dogfood: Starling improves Starling", sub="b",
lane="`fixtures/dogfood/**` (and whatever the Starling run itself changes, through its own PR flow).",
goal="""The ultimate meta-demo: point Starling at **its own repo** with a small, real, multi-part goal, let the flock build it, and keep the evidence.""",
deliverables="""- Pick a safe, real goal for this repo with 3–4 separable parts that don't touch core or engine. For example: "add `starling version --json`, add a `--quiet` flag to `starling replay`, add a CONTRIBUTING section on lanes, add a `docs/assets` README index". Write it to `fixtures/dogfood/goal.md`.
- Run it on a **clone** of this repo (`git clone . /tmp/starling-dogfood`), opencode profile, `maxParallel` 3, recording `fixtures/dogfood/run.jsonl`.
- If it succeeds, export the integration branch as a patch (`fixtures/dogfood/result.patch`) and open a PR to this repo from a branch `dogfood/<date>`. The PR body is the Starling run summary. **Don't merge it**; the Orchestrator reviews it like any other PR.
- Write `fixtures/dogfood/STORY.md`: what Starling planned, the lanes, which tasks needed fixes, cost and duration. This becomes a slide.""",
oos="Changing Starling's code directly (only via the run's own output PR).",
dod=["The run recording plus STORY.md committed. The dogfood PR URL pasted (or an honest failure write-up)."]))
