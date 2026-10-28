SPECS = []

SPECS.append(dict(nn="55", slug="web-panels-polish", title="Web panels polish (DAG, drawer, queue, metrics, flock)", sub="a",
lane="`apps/web/src/features/{dag,agents,queue,metrics,flock}/**`.",
carryover="""From the C1 web-wiring handback (Epic 34) and the screenshot review:
1. **Queue selection highlight**: `MergeQueueProps.selectedTask?` is being added to core (Epic 40). Highlight the selected card when present (optional, feature-detected).
2. **Flock panel**: on 720p the rail drops to compact mode and loses the task chips. Add a small **flock drawer/popover** opened from compact mode that shows the full roost cards. Also, the "Add a laptop · Flock mode is off for this run" card shows even when two nodes exist; it must show the join card whenever `join` is present, and a neutral "Join info unavailable" otherwise (never "off" while nodes > 1).
3. **Queue board**: column-level scrolling (no strip scroll-jump on click) and virtualisation for > 30 cards.
4. **Node names**: `TaskRun.nodeName?` is coming (Epic 40). Prefer it when present and fall back to the selector-mapped name.""",
goal="""Bring every non-Sky panel up to **projector quality**. Judges will see these from the back of a room, so they need to be legible, calm, informative and never janky, with a cohesive visual language across DAG, drawer, queue, meter and flock.""",
deliverables="""- A **legibility pass** at 1280×720 and 1920×1080: minimum 14 px body / 12 px meta text, contrast ≥ 4.5:1 on the dusk theme, tabular numerals for all counters, and truncation with tooltips instead of overflow.
- **DAG**: animated status transitions; the critical path highlighted (longest chain by estimate); a lane legend chip per node on hover; auto-fit when the plan changes; and a "follow the action" toggle that pans to running nodes.
- **Agent drawer**: a header with a live elapsed time and cost; an Activity tab with grouped tool calls ("ran tests ×3"), file-edit chips that link to the Diff tab, and a jump-to-latest; an Audit tab where DoD evidence (`AuditVerdict.dod`) renders as a checklist with evidence quotes; and a Diff tab with word-level highlights for small hunks.
- **Metrics**: a cost meter with an animated count-up, an off-peak vs peak note under the API number (from `PRICING` metadata if available), a "local calls" counter, and a "you saved" figure with a tooltip explaining the estimate.
- Items 1–4 from the carryover.
- Tests for every behaviour change (happy-dom), and updated Playgrounds.""",
oos="The Sky (Epic 47), data layer/layout (Epic 41), launch panel (Epic 53), stats page (Epic 68), and core types (FIX REQUEST to Epic 40).",
dod=["`cd apps/web && bun test` → 0 fail. If Playwright is available, commit 3 screenshots ≤ 300 KB each to `apps/web/src/features/dag/__screens__/` (DAG, drawer Audit tab, queue+meter)."]))

SPECS.append(dict(nn="56", slug="repomap-prompts", title="Repo map + worker prompts on real-world repos", sub="a",
lane="`packages/repomap/**` and `packages/prompts/**` **except** `packages/prompts/src/resolver*` (Epic 45).",
carryover="""From Wave 1: adopt `@starling/repomap`'s `renderRepoMap` inside `packages/prompts` (replacing its own minimal renderer), keeping the snapshot tests meaningful (update snapshots deliberately and explain the diff).""",
goal="""Starling must work on **real repos**, not just sky-todo. Stress the repo mapper and the worker prompts against real open-source projects of different shapes and languages, and fix what breaks: speed, noise, symbol quality, test-command detection, and prompt focus.""",
deliverables="""- `packages/repomap/bench/real-repos.ts`: shallow-clones (`git clone --depth 1`) **6 public repos** into a temp dir: one each of a TS monorepo (pnpm or bun), a Python package (pytest), a Go service, a Rust crate, a Vite/React app and a ~5k-file repo. Pick well-known small-to-mid projects and list them with their commit SHAs. It maps each one and reports files, languages, symbols/file, detected test/lint commands (correct? verify by hand), tokens and time.
- Fix what's wrong: missed or incorrect test commands (workspaces, `pyproject` scripts, `Makefile`/`justfile`, `cargo` workspaces), noisy symbols, slow paths, generated/vendored dirs that should be skipped (`vendor/`, `third_party/`, `*.generated.*`, `__generated__`, `.next`, `target/`). Add a regression test per fix using a minimal synthetic repo that reproduces it.
- **Prompt focus**: for each real repo, render a worker prompt for a plausible task (hand-written TaskSpec with a lane) and check that the repo-map excerpt is focused on the lane and its neighbours. Tune `renderRepoMap({ focus })` ranking (lane files → importers/importees → siblings) and the prompt budget. Snapshot one prompt per repo shape.
- Keep `bun test packages/repomap packages/prompts` offline: the clone bench is a script, not a test.""",
oos="The planner (Epic 48), resolver prompt (Epic 45), any LLM calls.",
dod=["Paste the real-repos bench table before and after the fixes (time, files, test command correct ✓/✗)."]))

SPECS.append(dict(nn="57", slug="workspace-hardening", title="Workspace hardening at swarm scale", sub="a",
lane="`packages/workspace/**`, `tools/stress/**`.",
goal="""Starling's selling point is *lots* of agents. Make the git layer hold up at **50+ concurrent worktrees**, on big repos, across crashes, and leave nothing behind.""",
deliverables="""- `tools/stress/worktrees.ts`: on a generated 5k-file repo, create **60 worktrees concurrently**, commit in each, compute diffs, predict conflicts pairwise for 20 pairs, create and fetch bundles for 10, then remove all. Report the p50/p95 per operation and the total; there must be zero failures. Run it and paste the results.
- Fix the bottlenecks you find (lock contention, `index.lock` retries, process spawn storms → a bounded exec pool, `git worktree prune` frequency).
- **Crash safety**: `recoverWorkspace(repo, worktreeRoot)` finds orphaned Starling worktrees and branches from dead runs (no live session, older than N hours), with `--dry-run`. Export it for a future `starling gc` command.
- **Edge cases**: repos with submodules (don't break; document limits), LFS pointers (diff must not explode), spaces/unicode in paths, a detached HEAD base, and a dirty main checkout (refuse to start the integration branch with a clear error). Each gets a test with a real temp repo.
- **Disk use**: report the per-worktree disk cost on the 5k repo, and document whether `git worktree add --no-checkout` + sparse checkout would help for lanes (prototype behind an option if it's a clear win).""",
oos="Merge logic (Epic 45 owns merger this wave), engine, and CLI command wiring (FIX REQUEST for `starling gc`).",
dod=["Paste the stress results (60 worktrees: all operations succeed, p95s).",
     "`bun test packages/workspace` → 0 fail, including the new edge-case tests."]))

SPECS.append(dict(nn="58", slug="demo-targets", title="Demo targets: sky-todo polish + a Python target", sub="a",
lane="`examples/**`.",
goal="""Give Starling great things to operate on during the demo: make sky-todo's demo goals decompose crisply, and add a **second, non-JavaScript target** so we can show Starling is language-agnostic.""",
deliverables="""- **Keep the contract stable**: the `examples/scripts/make-demo-repo.sh` CLI and the existing goal file names (`launch-day`, `launch-day-xl`, `quick-wins`, `conflict-bait`, `will-fail-audit`) must keep working. Other agents use them right now.
- sky-todo:
  - Review each goal against what a planner can infer from the code (make sure feature folders and slots clearly afford each task).
  - Add `demo-goals/stage.md`: a ~6-task goal tuned to finish in **≤ 8 minutes** with 6 agents and to produce one audit failure. Document the intended moments: which task should fail audit and why (e.g. it asks for tests explicitly in a way models often skip).
- `examples/py-ledger/`: a small, real Python 3.12 CLI app (a personal-finance ledger: add/list/report, CSV import, categories) with `pytest` tests, ruff config, `pyproject.toml`, ~600–900 lines, clear module boundaries for parallel features, and 2 seeded bugs (with an answer key in `.starling-answers/`, stripped by the demo script). Add `demo-goals/` with 3 goals plus `.expected.md` decompositions.
- Generalise `make-demo-repo.sh <example-name> [target-dir]` (default stays sky-todo), with a venv setup for py-ledger (`python3 -m venv .venv && pip install -e .[dev]`; skip gracefully if Python 3.12 is missing).
- Tests: both baselines green (`bun test`, `pytest`). The script works for both examples (run it, paste the output).""",
oos="Starling packages. Running real Starling runs (other epics do that).",
dod=["`bash examples/scripts/make-demo-repo.sh sky-todo /tmp/x1` and `… py-ledger /tmp/x2` both produce clean single-commit repos with green tests (paste the output)."]))

SPECS.append(dict(nn="59", slug="landing-site", title="Landing page for judges", sub="a",
lane="`site/**`.",
goal="""A one-page website judges can open from the submission: what Starling is, the 20-second pitch, the murmuration visual, how it works, the open-weight story, and quickstart, so the project looks finished and credible.""",
deliverables="""- `site/`: a static single page (vanilla HTML/CSS/TS bundled with Bun's bundler, no framework needed, under 300 KB total). Sections:
  - **hero** with a live canvas murmuration loop (your own lightweight boids; don't import the web app);
  - "One goal in, a flock out" explainer (3 steps: plan into lanes → flock runs in parallel → audited merge queue);
  - **The open-weight story** (DeepSeek V4.1 Flash, MIT weights, plus a local Qwen auditor; numbers from `tools/local-models/results` if present);
  - **Flock mode** (laptops in the room as roosts);
  - "Built by the flock" stats (placeholder JSON `site/data/stats.json` that Epic 68's tool can regenerate);
  - Quickstart (install, `starling init`, `starling run`) and the Agent Skill one-liner;
  - footer with repo link, MIT and Hacktoberfest badge text.
- Dark dusk theme matching the dashboard tokens (copy values; don't import). Responsive (phone width, 16 px gutters), accessible, `prefers-reduced-motion` aware.
- `bun run --cwd site build` → `site/dist/`. A deploy-to-GitHub-Pages workflow is a FIX REQUEST for Epic 52 (give them the exact YAML).
- No external CDNs except Google Fonts (optional).""",
oos="README (Epic 60). The web app. Actual deployment.",
dod=["`site/dist/index.html` builds. Paste the file sizes. If Playwright is available, commit `site/screens/hero.png` ≤ 300 KB."]))

SPECS.append(dict(nn="60", slug="readme", title="README, diagrams, CONTRIBUTING", sub="a",
lane="`README.md`, `CONTRIBUTING.md`, `docs/assets/diagrams/**`.",
goal="""Write the README a judge (or a Hacktoberfest contributor) reads first: crisp pitch, demo GIF/screens, how it works, quickstart, the open-weight model story, flock mode, the Agent Skill, and the "built by a swarm" story. Plus a CONTRIBUTING that turns our lane methodology into an on-ramp.""",
deliverables="""- `README.md`:
  - a logo line;
  - a one-sentence pitch;
  - badges (CI badge snippet from Epic 52's doc if present, MIT, Hacktoberfest);
  - a screenshot (use `docs/assets/c1-dashboard-1920.png`);
  - "Why" (the 4 problems from the PRD);
  - How it works (diagram);
  - Quickstart (`bun`, `opencode` login, `starling init`, `starling run`, `starling dash`);
  - Model routing table (roles → models, local vs API);
  - Flock mode (`starling perch`);
  - Agent Skill install;
  - Demo/replay (`starling replay`);
  - Architecture (packages table with one line each);
  - "Built by the flock" (how this repo was built: waves, lanes, ~60 epics, PR counts as placeholders Epic 68 fills);
  - Roadmap, License.
  Keep it scannable.
- `docs/assets/diagrams/`: **3 hand-authored SVGs** (readable in light and dark GitHub themes: transparent background, mid-contrast strokes):
  1. pipeline (goal → map → plan/lanes → flock → audit → merge queue → integration branch);
  2. flock topology (hub + perches, bundles, SSE);
  3. model routing (roles → DeepSeek via opencode vs local Ollama).
- `CONTRIBUTING.md`: setup, how lanes work, how to pick a good-first-issue, the handback format, Conventional Commits, running tests (`bun run test`, the web split), and the AGENTS.md rules for AI contributors.
- Verify every command in the README actually works against current `main` (where something is still being built in Wave 2, mark it "coming in v0.1" rather than inventing behaviour).""",
oos="The landing site (Epic 59). Release notes and CHANGELOG (later). Code changes.",
dod=["Every README command you could run is pasted with its output (or marked as pending with the epic that delivers it)."]))

SPECS.append(dict(nn="61", slug="onboarding", title="Onboarding: init, doctor, first-run magic", sub="a",
lane="`apps/cli/src/{init,doctor}.ts`, `apps/cli/src/commands/{init,doctor}.ts`, `apps/cli/src/render/doctor.ts` and their tests.",
carryover="""Moved here from Epic 40: make `starling init` default to the **`opencode` LLM profile** when an `opencode-go/…deepseek-v4.1-flash`-style model is listed by `opencode models` (that's this machine), then `deepseek` if `DEEPSEEK_API_KEY` is set, else `local`.""",
goal="""Make the first five minutes with Starling delightful for a judge or contributor: `starling doctor` diagnoses everything with exact fixes, and `starling init` writes a working config for *their* machine in one go.""",
deliverables="""- `doctor` checks, each with a ✔/✘/! and a one-line fix:
  - bun, git ≥ 2.38, gh auth;
  - opencode presence/version and **server reachability** (start and stop a `--standalone` serve on a free port, with no prompts);
  - available DeepSeek V4.1 Flash model ids across providers; DeepSeek key (optional); Ollama reachability and recommended local models present (from `tools/local-models/results/recommendation.json` when the repo is a Starling checkout);
  - config validity;
  - free RAM/disk with **guidance on how many parallel agents** fit (rule of thumb documented);
  - LAN IP and port 7777/7778 availability (for flock);
  - `ulimit -n`.
  `--json` output too.
- `init`: interactive by default (TTY) and `--yes` for defaults. It writes `starling.config.yaml` with the detected profile, `maxParallel` suggested from the hardware, flock settings, and comments explaining each field. Refuses to overwrite without `--force`, and prints "next steps" (`starling plan`, `starling run`, `starling dash`).
- Tests with injected exec/fs fakes for every check branch and the profile detection order.""",
oos="`run`/`plan`/`status`/`dash`/compose (Epic 40) and `perch`/`flock` commands (Epic 42).",
dod=["Paste real `bun run starling doctor` and `bun run starling init --yes --dry-run` output from this machine."]))

SPECS.append(dict(nn="68", slug="swarm-stats", title="Built-by-the-flock stats page", sub="a",
lane="`apps/web/src/features/about/**`, `tools/stats/**`.",
goal="""Turn this repo's own history into proof: a page (and JSON) showing how Starling was built by a flock of agents (epics, PRs, commits, lines, tests, waves, durations), pulled from git, GitHub and the orchestrator logs. It's the "one person and ~60 agents" slide, live.""",
deliverables="""- `tools/stats/collect.ts` writes `tools/stats/out/stats.json`:
  - per epic: number, title, wave, PR number, merged-at, commits, +/− lines, files and tests added, duration (first commit → merge), and handback status;
  - per wave: agents, wall time, total tests after the wave;
  - totals: epics, PRs, commits, lines, tests, peak concurrent agents.
  Sources: `git log` (tags `epic-NN-complete`), `gh pr list --state merged --json …`, `.orchestrator/epics.tsv`, and the agent log timestamps in `../starling-wt/_logs` when present. Each one is optional and degrades gracefully.
- Document `site/data/stats.json` as the path Epic 59's landing page reads (`site/` is their lane, so file it as a FIX REQUEST).
- `export function AboutPage(props: { stats: SwarmStats })` in `features/about`: a timeline of waves as horizontal swim lanes (epics as bars from start to merge), big-number tiles (epics, agents, PRs, tests, hours), and the "lanes" story in 3 sentences. Hand-rolled SVG, theme tokens, accessible. Shell wiring (`?page=about` route) is a FIX REQUEST for Epic 41.
- Tests: the collector against a fixture git repo with tags and fake `gh` JSON; the page rendering with fixture stats.""",
oos="Shell routing (Epic 41). The landing site (Epic 59).",
dod=["Run `bun tools/stats/collect.ts` on this repo and paste the totals."]))

SPECS.append(dict(nn="69", slug="security-review", title="Security & safety review", sub="a",
lane="`tools/security/**` (scripts and tests that *probe* the system). Findings go in your epic doc and as FIX REQUESTS. **You do not edit other packages.**",
goal="""Starling runs arbitrary agent-written code, exposes HTTP servers on the LAN, ships repos between machines and reads files on request. Do a focused security review **before** demo day, prove each finding with a probe, and hand precise fixes to the owning epics.""",
deliverables="""- A threat model in your doc. Assets: the hub repo, the user's machine, tokens, the opencode server. Actors: a LAN peer, a malicious repo, a misbehaving agent. Entry points: server, perch, SSE, bundles, replay, opencode.
- **Probes** in `tools/security/` (each a bun test that spins up the real component on port 0 and attacks it):
  - flock token checks (missing, wrong, timing);
  - path traversal in `/api/flock/bundle?ref=` and `/api/replay` (`../`, absolute paths, symlinks);
  - bundle ref injection (`--upload-pack`-style args, refs with `..`);
  - SSE flooding/backpressure;
  - oversized bodies;
  - perch `POST /perch/tasks` with a hostile `branch`/`fromRef`;
  - CORS on the server;
  - secrets in logs and recorded JSONL (API keys, tokens);
  - `exec` argv-only (grep for shell-string usage across packages).
  A probe that **finds** an issue should be written as an *expected-failure* test (`test.failing`) so it turns green when the owner fixes it.
- A worktree escape check: can a worker agent's lane-violating write outside its worktree (e.g. `../../`) be detected by the auditor? Probe via the auditor's lane check with crafted paths.
- **FIX REQUESTS**: one per finding, with owner epic, severity, exact fix, and the probe that proves it.""",
oos="Fixing other lanes' code (FIX REQUESTS only). Network attacks beyond the local machine.",
dod=["A findings table (severity, component, probe, owner, fix) pasted in the handback. All probes run (passing, or `failing` as expected)."]))

SPECS.append(dict(nn="70", slug="load-test", title="Load test: 30-task runs and a busy dashboard", sub="a",
lane="`tools/load/**`.",
goal="""Find out whether Starling stays smooth at **swarm scale** (30-task plans, 20 concurrent sessions, thousands of events per minute) without spending a cent: use the real engine, store and server with replay/mock runners.""",
deliverables="""- `tools/load/engine.ts` uses the **real** `createEngine` with real `createSqliteStore`, real `createMerger`/`createWorkspace` on a generated repo, the `ReplayRunner` (scripted agent events, ~300 per task) and a MockLLM planner returning a generated 30-task lane-disjoint plan. Run with `maxParallel` 20. Measure wall time, event throughput, store write latency, merge queue time, and memory.
- `tools/load/sse.ts` starts the real server on that run and attaches 20 SSE clients (simulated dashboards). Measure delivery latency p50/p95 and dropped frames, and confirm the backlog with `since` works under load.
- `tools/load/web-reducer.ts` feeds 20k events through the web reducer (`apps/web/src/data/reducer.ts`) and measures ms/event and memory caps.
- Report a table and **FIX REQUESTS** for any hotspot (owner epics: engine 49, store/server 41/46, web data 41).
- Keep each script < 3 min. No real LLM.""",
oos="Editing the packages under test (FIX REQUESTS only).",
dod=["Paste the three result tables."]))

SPECS.append(dict(nn="71", slug="web-e2e", title="Browser end-to-end tests (Playwright)", sub="a",
lane="`apps/web/e2e/**`, `apps/web/playwright.config.ts` (you may add `@playwright/test` to `apps/web/package.json` devDependencies, add-only).",
goal="""Lock in the demo's visual and behavioural guarantees with real-browser tests, because a broken dashboard on stage is the one failure we can't recover from.""",
deliverables="""- Install Playwright's Chromium (`bunx playwright install chromium`; document it).
- Tests against `bun run dev` (or `vite preview` of a build) with `?demo=1` at **16×** speed:
  - the page loads with no console errors;
  - every region renders;
  - the replay reaches the end state (7 on the wire);
  - keyboard shortcuts (`1`/`2`/`b`/`f`/`?`) work;
  - clicking a bird opens the drawer for the right task, and Esc closes it;
  - the DAG view toggles;
  - the flock panel shows 2 roosts;
  - the metrics show cost;
  - reduced-motion emulation renders the calm Sky;
  - 1280×720 and 1920×1080 both have zero horizontal overflow.
- **Visual snapshots** (`toHaveScreenshot`) at both sizes at the end of the replay, with a sensible pixel tolerance (canvas animation is masked or paused via a test hook; if a hook is needed in the Sky, file a FIX REQUEST for Epic 47 and mask meanwhile).
- `bun run --cwd apps/web e2e` script. Excluded from the default `bun run test` (CI wiring is a FIX REQUEST for Epic 52).""",
oos="Fixing the UI bugs you find (FIX REQUESTS to 41/47/55), and CI wiring.",
dod=["`bun run --cwd apps/web e2e` passes. Paste the summary. Snapshot images committed (≤ 300 KB each)."]))
