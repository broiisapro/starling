# Starling — Roadmap (living document)

**Shape:** 4 waves with 2 integration checkpoints. In each wave, every epic owns a **lane** (the paths it may write), so 20–35 opencode sessions can run at once across two laptops without merge conflicts.
**Numbering:** Wave 0 = 0x · Wave 1 = 10–32 · Wave 2 = 40–54 · Wave 3 = 60–68.
**Machines:** 🅿 = MacBook Pro M5 Pro (primary) · 🅰 = MacBook Air M2. All sessions are API-bound (DeepSeek), so the split mostly balances terminals and RAM. Epics that need local models or heavy builds go on 🅿.

Status: ⬜ not started · 🟦 prompt written · 🟨 running · 🟪 PR open / auditing · ✅ merged + tagged

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
