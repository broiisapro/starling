# Starling — Roadmap (living document)

**Shape:** 4 waves with 2 integration checkpoints. In each wave, every epic owns a **lane** (the paths it may write), so 20–35 opencode sessions can run at once across two laptops without merge conflicts.
**Numbering:** Wave 0 = 0x · Wave 1 = 10–32 · Wave 2 = 40–54 · Wave 3 = 60–68.
**Machines:** 🅿 = MacBook Pro M5 Pro (primary) · 🅰 = MacBook Air M2. All sessions are API-bound (DeepSeek), so the split mostly balances terminals and RAM. Epics that need local models or heavy builds go on 🅿.

Status: ⬜ not started · 🟦 prompt written · 🟨 running · 🟪 PR open / auditing · ✅ merged + tagged

> **Update (2026-10-27, after C1):** all *development* agents run on the MacBook Pro only (it handles many dozens of opencode sessions; no local models during build waves). The Air is only for demoing Starling's **Flock** product feature. Wave 2 was widened to **23 parallel epics** (`prompts/wave-2/`): the original 12 plus 55–61, 68–71 pulled forward. **Wave 2b** (`prompts/wave-2b/`: 46, 50, 54) launches after Epic 40 merges. `epics.tsv` is the source of truth for numbering.

> **Update (Wave 3, 2026-10-27):** Wave 2's 22 PRs merged and Epic 40 is landing real composition (fix2). **Wave 3 is 100 parallel epics (100–199, `prompts/wave-3/`)**, all on the MacBook Pro, plus **Wave 3b** (11 epics in `prompts/wave-3b/`: 200–207 and the old 2b epics 46, 50, 54), which launches after Epic 40 merges. Rules L32–L39 (absolute lanes, additive APIs, no new deps, `heavy.sh` slot gate, `test.todo` for bugs, no real runs in 3a, manifests for C3 wiring) are in every prompt header. **Checkpoint C3** then wires the new web features, CLI extensions and server insights routes. The older Wave 3 table below (60–68) is superseded.

---

## Wave 0: Foundation (pre-event) · 3 sessions

| # | Epic | Lane (may write) | Depends | Machine | Status |
|---|---|---|---|---|---|
| 00 | Foundation & frozen contracts | root files (not `.orchestrator/`, `AGENTS.md`, `opencode.json`), all package/app skeletons, `packages/core/**`, `fixtures/**` | — | 🅿 | 🟦 |
| 01 | Demo target: `sky-todo` | `examples/**` | — | 🅿 | 🟦 |
| 02 | Repo ops: GitHub bootstrap + local model bring-up | `.github/**`, `tools/local-models/**`, `.orchestrator/bin/gh-bootstrap.sh`, `.orchestrator/issues.tsv` | GitHub repo exists | 🅿 | 🟦 |

**Gate G0:** 00 merged, contracts frozen, `bun run test` green. Wave 1 branches from `main` after G0. Wave 1 prompts get written while Wave 0 runs.

## Wave 1: Fan-out, every component against mocks · 23 sessions (🅿 13 · 🅰 10)

| # | Epic | Lane | Machine | Notes |
|---|---|---|---|---|
| 10 | LLM router | `packages/llm/**` | 🅿 | DeepSeek + Ollama providers, completeJson + repair, cost accounting |
| 11 | Repo mapper | `packages/repomap/**` | 🅰 | `git ls-files`, langs, regex symbols, test/lint detection, optional cached summaries |
| 12 | Planner | `packages/planner/**` | 🅿 | prompt + schema, validator (cycles, lane overlap), auto-repair |
| 13 | Prompt compiler | `packages/prompts/**` | 🅰 | worker / fixer / resolver templates from the methodology; snapshot tests |
| 14 | Workspace (git) | `packages/workspace/**` | 🅿 | worktrees, diffs, `merge-tree` conflict prediction, **bundle create/fetch helpers** |
| 15 | opencode runner | `packages/runner/**` | 🅿 | spawn/attach `opencode serve`, SDK per-dir sessions, SSE → AgentEvent, ReplayRunner |
| 16 | Auditor | `packages/auditor/**` | 🅿 | commands + lane check + LLM verdict |
| 17 | Merger | `packages/merger/**` | 🅿 | merge onto integration branch, regression run, rollback |
| 18 | GitHub tracker | `packages/github/**` | 🅰 | gh wrapper, issues from plan, PR bodies, NoopTracker |
| 19 | Store + record/replay | `packages/store/**` | 🅰 | bun:sqlite, JSONL import/export, replay emitter |
| 20 | Engine | `packages/engine/**` | 🅿 | state machine over ExecutionNodes + Scheduler; reschedule on node loss |
| 21 | Server | `apps/server/**` | 🅰 | REST + SSE + flock endpoints per locked API |
| 22 | CLI | `apps/cli/**` | 🅰 | all commands incl. `perch`, `flock`, composition root |
| 23 | Web shell + data layer | `apps/web` root + `src/{app,data,components,lib}/**` | 🅿 | layout, zustand store from SSE, fixture demo mode |
| 24 | Web: The Sky | `apps/web/src/features/sky/**` | 🅿 | canvas boids, **one roost per node**, birds migrate between roosts, the wire = main |
| 25 | Web: DAG + agent drawer | `apps/web/src/features/{dag,agents}/**` | 🅿 | xyflow DAG, logs, diff, verdicts |
| 26 | Web: queue + metrics | `apps/web/src/features/{queue,metrics}/**` | 🅰 | merge queue, cost meter, token charts |
| 27 | Agent Skill + opencode integration | `skills/**`, `integrations/**` | 🅰 | SKILL.md, `/swarm` command |
| 28 | Local model bench | `tools/local-models/**` | 🅿 | pick auditor models for the MBP **and** a small one for the Air |
| 29 | Evals harness | `evals/**` | 🅰 | planner + auditor evals |
| 30 | Flock core | `packages/flock/**` | 🅿 | LocalNode, RemoteNode, NodeRegistry, Scheduler, mDNS browse, bundle import |
| 31 | Perch daemon | `packages/perch/**` | 🅿 | Perch HTTP API over LocalNode, register + heartbeat, mDNS advertise, two-perches-on-one-machine test |
| 32 | Web: flock panel | `apps/web/src/features/flock/**` | 🅰 | roost cards (CPU/RAM/sessions/models), join code + QR, live node stats |

**Checkpoint C1 (~45 min, 🅿):** the integrator session merges in order: 10–19, 30 → 31 → 20 → 21–22 → 23 → 24–26, 32 → 27–29. It resolves `bun.lock`, runs the full suite after each merge, tags each epic and writes the C1 report.

## Wave 2: Integration, make it real · 15 sessions (🅿 9 · 🅰 6)

| # | Epic | Lane | Machine |
|---|---|---|---|
| 40 | **Integration captain**: real end-to-end on sky-todo with LocalNode only | cross-package fixes (the only epic allowed multiple packages) | 🅿 |
| 41 | Server ↔ engine live + web on real SSE | `apps/server/**`, `apps/web/src/data/**` | 🅰 |
| 42 | **Flock end-to-end**: loopback flock (2 perches on one machine), then a real MBP + Air test script | `packages/flock/**`, `packages/perch/**` | 🅿 |
| 43 | GitHub mode end-to-end | `packages/github/**`, `packages/engine/src/tracker-hooks.ts` | 🅰 |
| 44 | Auditor tuning with local model | `packages/auditor/**`, `evals/auditor/**` | 🅿 |
| 45 | Conflict-resolver loop | `packages/merger/**`, `packages/prompts/src/resolver*` | 🅿 |
| 46 | Golden demo run + replay polish | `packages/store/**`, `fixtures/demo/**`, `apps/cli/src/commands/replay*` | 🅿 |
| 47 | Sky polish: migrations, roost join animation, optional sound | `apps/web/src/features/sky/**` | 🅰 |
| 48 | Planner quality pass | `packages/planner/**`, `evals/planner/**` | 🅰 |
| 49 | Robustness: stalls, 429 backoff, budget cap, kill switch, perch-loss reschedule | `packages/runner/**`, `packages/engine/src/policies/**` | 🅿 |
| 50 | Skill end-to-end from inside opencode | `skills/**`, `integrations/**` | 🅰 |
| 51 | Fully-open mode + perch-lent local inference | `packages/llm/src/profiles/**`, `packages/perch/src/llm-proxy*` | 🅿 |
| 52 | CI: GitHub Actions | `.github/workflows/**` | 🅰 |
| 53 | Web: launch-a-run + run history | `apps/web/src/features/launch/**` | 🅿 |
| 54 | Dogfood: Starling runs a goal on its own repo across both laptops | `fixtures/dogfood/**` | 🅿 (after 40, 42) |

**Checkpoint C2 (~45 min):** same procedure. **Moksh field test:** one batched 25-check two-laptop sheet. **Feature freeze** after C2.

## Wave 3: Polish, proof, ship · 10 sessions

| # | Epic | Lane |
|---|---|---|
| 60 | README, architecture diagram, GIFs, CONTRIBUTING | `README.md`, `CONTRIBUTING.md`, `docs/assets/**` |
| 61 | Onboarding: `init`, `doctor`, 60-second perch quickstart | `apps/cli/src/commands/{init,doctor,perch}*` |
| 62–66 | Bug bash ×5 (25-check scenario sheet each; fix in-lane, file the rest) | per sheet |
| 67 | Release v0.1.0 + 10 good-first-issues + `hacktoberfest` topic | `CHANGELOG.md`, GitHub |
| 68 | "Built by the flock" stats page (PR graph, per-machine counts) | `apps/web/src/features/about/**`, `tools/stats/**` |

**Human + Orchestrator:** pitch deck (Claude Slides), demo script, 3 rehearsals, backup screen recording, MLH submission.

---


## Wave 3: the 100-agent wave (+ Wave 3b)

Launch: `spawn-wave.sh 3 --range 100-149`, then `--range 150-199` a few minutes later; Wave 3b with `spawn-wave.sh 3b` after Epic 40 merges.


**Packages + server**

| # | Epic | Lane | Status |
|---|---|---|---|
| 100 | Engine round 2: diff events, run.status, per-run budget, warn verdicts | `packages/engine/**` | 🟦 |
| 101 | Flock hardening: SEC-02/03/05, bundle cache, dispatcher constraints | `packages/flock/**` | 🟦 |
| 102 | Perch hardening: body limits, hostile refs, mDNS code opt-in | `packages/perch/**` | 🟦 |
| 103 | Auditor round 2: lane traversal (SEC-08), command policy (SEC-11), richer verdicts | `packages/auditor/**` | 🟦 |
| 104 | Merger round 2: queue fairness, regression bisect, SEC-11 | `packages/merger/**` | 🟦 |
| 105 | Workspace round 2: gc library, disk budget, worktree locks | `packages/workspace/**` | 🟦 |
| 106 | GitHub round 2: PR body polish, labels, check runs, rate-limit backoff | `packages/github/**` | 🟦 |
| 107 | Planner round 2: one repo-map renderer, lane suggestions, plan diffing | `packages/planner/**` | 🟦 |
| 108 | Repo map round 2: more languages, ownership hints, speed | `packages/repomap/**` | 🟦 |
| 109 | Prompts round 2: reviewer/explainer templates, prompt budgets, injection guards | `packages/prompts/**` | 🟦 |
| 110 | Server hardening: SEC-01/05/06/09, auth token, rate limits | `apps/server/**` except `apps/server/src/routes/insights*` | 🟦 |
| 111 | Server insights routes: report, compare, timeline, costs | `apps/server/src/routes/insights.ts`, `apps/server/src/routes/insights.test.ts`, `apps/server/src/insights/**` | 🟦 |

**Web shell + new features**

| # | Epic | Lane | Status |
|---|---|---|---|
| 112 | Web shell round 2: feature registry, overlay host, compact stage layout | `apps/web/src/{app,components,lib}/**`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/index.html`, `apps/web/vite.config.ts` | 🟦 |
| 113 | Web: flight report (post-run summary page) | `apps/web/src/features/report/**` | 🟦 |
| 114 | Web: timeline (Gantt of agents over time) | `apps/web/src/features/timeline/**` | 🟦 |
| 115 | Web: lanes map (who owns which files) | `apps/web/src/features/lanes/**` | 🟦 |
| 116 | Web: cost & tokens breakdown, open-weight savings | `apps/web/src/features/costs/**` | 🟦 |
| 117 | Web: event console | `apps/web/src/features/console/**` | 🟦 |
| 118 | Web: settings drawer | `apps/web/src/features/settings/**` | 🟦 |
| 119 | Web: guided tour for judges | `apps/web/src/features/tour/**` | 🟦 |
| 120 | Web: command palette (Cmd-K) | `apps/web/src/features/palette/**` | 🟦 |
| 121 | Web: toasts and notifications | `apps/web/src/features/toasts/**` | 🟦 |
| 122 | Web: compare two runs | `apps/web/src/features/compare/**` | 🟦 |
| 123 | Web: export and share card | `apps/web/src/features/export/**` | 🟦 |
| 124 | Web: replay scrubber | `apps/web/src/features/scrubber/**` | 🟦 |
| 125 | Web: file churn heatmap | `apps/web/src/features/heatmap/**` | 🟦 |
| 126 | Web: flock leaderboard | `apps/web/src/features/leaderboard/**` | 🟦 |

**Web round 2 + quality**

| # | Epic | Lane | Status |
|---|---|---|---|
| 127 | Web: presenter stage mode | `apps/web/src/features/stage/**` | 🟦 |
| 128 | Web: flock topology | `apps/web/src/features/topology/**` | 🟦 |
| 129 | Web: system health panel | `apps/web/src/features/health/**` | 🟦 |
| 130 | Web: Sky round 3 | `apps/web/src/features/sky/**` | 🟦 |
| 131 | Web: DAG round 2 | `apps/web/src/features/dag/**` | 🟦 |
| 132 | Web: agent drawer round 2 | `apps/web/src/features/agents/**` | 🟦 |
| 133 | Web: merge queue round 2 | `apps/web/src/features/queue/**` | 🟦 |
| 134 | Web: metrics round 2 | `apps/web/src/features/metrics/**` | 🟦 |
| 135 | Web: flock panel round 3 | `apps/web/src/features/flock/**` | 🟦 |
| 136 | Web: launch form round 2 | `apps/web/src/features/launch/**` | 🟦 |
| 137 | Web: about / built-by-the-flock round 2 | `apps/web/src/features/about/**` | 🟦 |
| 138 | Web: component gallery | `apps/web/src/gallery/**`, `apps/web/gallery.html` | 🟦 |
| 139 | Web: accessibility audit | `apps/web/src/__a11y__/**` | 🟦 |
| 140 | Web: Playwright round 2 | `apps/web/e2e/**` | 🟦 |
| 141 | Web: performance budgets | `apps/web/src/__perf__/**` | 🟦 |

**CLI extensions + infra**

| # | Epic | Lane | Status |
|---|---|---|---|
| 142 | CLI: `starling watch` live terminal view | `apps/cli/src/ext/watch/**` | 🟦 |
| 143 | CLI: `starling gc` | `apps/cli/src/ext/gc/**` | 🟦 |
| 144 | CLI: `starling explain` | `apps/cli/src/ext/explain/**` | 🟦 |
| 145 | CLI: completions, version, banner | `apps/cli/src/ext/completions/**` | 🟦 |
| 146 | CLI: `starling report` | `apps/cli/src/ext/report/**` | 🟦 |
| 147 | CLI: `starling config` | `apps/cli/src/ext/config/**` | 🟦 |
| 148 | CLI: `starling logs` | `apps/cli/src/ext/logs/**` | 🟦 |
| 149 | CLI: `starling try` (one-command demo) | `apps/cli/src/ext/try/**` | 🟦 |
| 150 | CI round 2 | `.github/workflows/**` | 🟦 |
| 151 | Packaging: single-file binaries | `tools/release/**` | 🟦 |
| 152 | Install script | `tools/install/**` | 🟦 |
| 153 | Devcontainer and Docker | `.devcontainer/**`, `Dockerfile`, `.dockerignore`, `tools/docker/**` | 🟦 |
| 154 | Stats round 2: the 100-agent wave | `tools/stats/**` | 🟦 |
| 155 | Load test round 2 | `tools/load/**` | 🟦 |

**Tools, evals, integrations**

| # | Epic | Lane | Status |
|---|---|---|---|
| 156 | Workspace stress round 2 | `tools/stress/**` | 🟦 |
| 157 | Security review round 2 | `tools/security/r2/**` | 🟦 |
| 158 | Flock demo kit | `tools/flock/**` | 🟦 |
| 159 | GitHub sandbox round 2 | `tools/github-sandbox/**` | 🟦 |
| 160 | Repo hygiene checker | `tools/hygiene/**` | 🟦 |
| 161 | Evals: planner round 2 | `evals/planner/**` | 🟦 |
| 162 | Evals: auditor round 2 | `evals/auditor/**` | 🟦 |
| 163 | Integration: VS Code extension | `integrations/vscode/**` | 🟦 |
| 164 | Integration: GitHub Action | `integrations/github-action/**` | 🟦 |
| 165 | Integration: MCP server | `integrations/mcp/**` | 🟦 |
| 166 | Integration: notifications | `integrations/notify/**` | 🟦 |
| 167 | Integration: shell prompt segment | `integrations/shell/**` | 🟦 |

**Demo targets + docs/content**

| # | Epic | Lane | Status |
|---|---|---|---|
| 168 | Demo target 3: a TypeScript API repo | `examples/birdwatch-api/**` | 🟦 |
| 169 | sky-todo round 3: more goals | `examples/sky-todo/**` | 🟦 |
| 170 | py-ledger round 2 | `examples/py-ledger/**` | 🟦 |
| 171 | Examples tooling | `examples/scripts/**`, `examples/README.md` | 🟦 |
| 172 | README round 2 | `README.md`, `docs/assets/**` | 🟦 |
| 173 | Community files and good first issues | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/good-first-issues.md` | 🟦 |
| 174 | CHANGELOG and release notes | `CHANGELOG.md`, `docs/release/**` | 🟦 |
| 175 | User guide | `docs/guide/**` | 🟦 |
| 176 | API reference | `docs/api/**` | 🟦 |
| 177 | Architecture deep dive | `docs/architecture/**` | 🟦 |
| 178 | Demo script and judge Q&A | `docs/demo/**` | 🟦 |
| 179 | Landing site round 2 | `site/**` | 🟦 |
| 180 | Blog post: 100 agents built this | `docs/blog/**` | 🟦 |
| 181 | Troubleshooting and FAQ | `docs/troubleshooting/**` | 🟦 |
| 182 | Open-weight models guide | `docs/models/**` | 🟦 |
| 183 | Flock guide | `docs/flock/**` | 🟦 |

**QA bug bash**

| # | Epic | Lane | Status |
|---|---|---|---|
| 184 | QA: engine | `tools/qa/engine/**` | 🟦 |
| 185 | QA: flock + perch | `tools/qa/flock-perch/**` | 🟦 |
| 186 | QA: auditor + merger | `tools/qa/auditor-merger/**` | 🟦 |
| 187 | QA: workspace | `tools/qa/workspace/**` | 🟦 |
| 188 | QA: repomap → planner → prompts | `tools/qa/plan-pipeline/**` | 🟦 |
| 189 | QA: github + store | `tools/qa/github-store/**` | 🟦 |
| 190 | QA: server API | `tools/qa/server-api/**` | 🟦 |
| 191 | QA: web shell + data | `apps/web/src/__qa__/core/**` | 🟦 |
| 192 | QA: web feature panels | `apps/web/src/__qa__/features/**` | 🟦 |
| 193 | QA: recorded runs and fixtures | `tools/qa/fixtures/**` | 🟦 |
| 194 | QA: config and environment | `tools/qa/config-env/**` | 🟦 |
| 195 | QA: docs accuracy | `tools/qa/docs/**` | 🟦 |
| 196 | QA: concurrency and races | `tools/qa/races/**` | 🟦 |
| 197 | QA: fuzz and property tests | `tools/qa/fuzz/**` | 🟦 |
| 198 | QA: demo targets | `tools/qa/examples/**` | 🟦 |
| 199 | QA: package performance budgets | `tools/qa/perf/**` | 🟦 |

**Wave 3b (after Epic 40)**

| # | Epic | Lane | Status |
|---|---|---|---|
| 200 | LLM round 2 | `packages/llm/**` | 🟦 |
| 201 | Runner round 2 | `packages/runner/**` | 🟦 |
| 202 | Core round 2: contract consolidation | `packages/core/**` | 🟦 |
| 203 | CLI round 2 + wire extensions | `apps/cli/**` | 🟦 |
| 204 | Web data round 2 | `apps/web/src/data/**` | 🟦 |
| 205 | Evals: end-to-end | `evals/e2e/**`, `evals/run.ts`, `evals/lib/**`, `evals/real.ts` | 🟦 |
| 206 | QA: CLI | `tools/qa/cli/**` | 🟦 |
| 207 | Real-run matrix | `tools/realrun/**`, `fixtures/real/**` | 🟦 |

| 46 · 50 · 54 | Golden demo · Skill e2e · Dogfood (moved from 2b) | see prompts | 🟦 |

**Checkpoint C3:** wire the web feature manifests, CLI `ext/*` extensions and the insights routes; flip `test.todo`s that got fixed; regenerate visual baselines; full suite. Then demo prep (golden recording, pitch deck, rehearsals).

---

## Event-day timeline (11 h window; Wave 0 done beforehand)

| Clock | What | Live sessions |
|---|---|---|
| H+0:00 | `spawn-wave 1` on both laptops | 23 |
| H+0:00–2:45 | Wave 1; Orchestrator audits PRs as they land and writes Wave 2 prompts | 23 |
| H+2:45–3:30 | **C1** | 1 |
| H+3:30–6:30 | Wave 2 | 15 |
| H+6:30–7:15 | **C2** + Moksh's two-laptop field test | 1 |
| H+7:15–9:15 | Wave 3 + record golden demo | 10 |
| H+9:15–10:15 | Rehearse ×3, backup video, submit | 0 |
| H+10:15–end | Buffer | — |

**Strongly recommended:** if there's at least an evening before the event, run **Wave 1 beforehand** (pre-built code is allowed). Event day then becomes Wave 2 + Wave 3 + a second integration wave. That gives the most polish and a much safer demo.
