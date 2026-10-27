# Epic 174: CHANGELOG and release notes for v0.1.0, generated from tags and handbacks

**Wave 3 · Branch `epic/174-changelog` · Issue: `gh issue list --search "Epic 174 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-174-changelog.md` and `.orchestrator/handbacks/174-changelog.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **D1 docs convention (shared by Epics 172–183, all writing in parallel).**
  - **Entry points:** every docs area has its index at `docs/<area>/README.md`. Link siblings by these planned paths even if they don't exist yet: `docs/guide/` (175), `docs/api/` (176), `docs/architecture/` (177), `docs/demo/` (178), `docs/blog/` (180), `docs/troubleshooting/` (181), `docs/models/` (182), `docs/flock/` (183), `docs/release/` + `CHANGELOG.md` (174), `CONTRIBUTING.md`, `SECURITY.md`, `docs/good-first-issues.md` (173), `examples/README.md` (171), `examples/birdwatch-api/` (168), `site/` (179).
  - **The pending marker:** anything not merged on `main` yet gets `⏳ Epic NN` (or `⏳ C3` for wiring) on the same line or table row. Checkers skip existence checks on marked lines but require the marker to name an epic. Never present unmerged behaviour as working.
  - **The real-run flow (Epic 40, branch `epic/40-integration-captain`, merging in parallel with you; read `git show epic/40-integration-captain:docs/epic-40-integration-captain.md`):** `starling run` is **real by default**: one private `opencode serve` on a free port, git worktrees under `worktreeRoot`, SQLite at `<repo>/.starling/starling.db`, the flock hub and the merge queue. It starts the dashboard server and prints its URL unless `--no-dash`, then prints a summary such as `✔ 5 merged · ✘ 0 failed · 0 conflicts / api $0.223 · local $0 / branch starling/3rcdzr/integration (7m 11s)`. Flags new in Epic 40 (all `⏳ Epic 40` until merged): `run --mock` (the old no-process demo stack), `run --budget <usd>` (overrides `budget.maxUsd`) and `status --repo <path>`. `plan --json` prints only `{ plan, issues }` on stdout. `starling dash` serves the repo's store read-only (`POST /api/runs` → 501, "use `starling run`"). The default LLM profile for real runs is `opencode` (`STARLING_LLM_PROFILE` overrides it; the library default stays `deepseek`). Recordings over 5 MB keep lifecycle events only. Real recordings: `fixtures/real/quick-wins.jsonl`, `fixtures/real/launch-day.jsonl`. Known limits: the auditor runs tests in the hub repo, opencode completions report `$0` for planner/auditor turns, a single machine only (perches come from Epic 42's `starling perch`), and no conflict-resolver wiring.
  - **Wave 3 CLI extensions** (built in `apps/cli/src/ext/*`, registered by C3/Epic 203, so mark them `⏳ C3`): `watch` (142), `gc` (143), `explain` (144), `completions` + `version --json` (145), `report` (146), `config` (147), `logs` (148), `try` (149).
  - **Verify against code, not memory.** The CLI surface is `createProgram()` in `apps/cli/src/program.ts`. Import it read-only (`import { createProgram } from '../../apps/cli/src/program.ts'`) and walk `program.commands` / `command.options` (`.long`, `.short`, `.negate`, `.required`, `.defaultValue`). It works from `docs/` today (verified). Core schemas: `../../packages/core/src/index.ts` (`StarlingEventTypeSchema.options`, `TaskStatusSchema.options`, `RunStatusSchema.options`, `defaultConfig`, `StarlingConfigSchema`). Never spawn the CLI binary, start servers or touch the network in a checker.
  - **Checker layout:** `docs/<area>/check.ts` (pure exported functions plus an `import.meta.main` CLI with `--check` (exit 1 on problems) and, where it generates content, `--write`), `docs/<area>/check.test.ts` beside it, and `docs/<area>/tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["*.ts"] }`. Generated blocks sit between `<!-- generated:<name>:start -->` / `<!-- generated:<name>:end -->` markers. Tests are offline, deterministic and finish in under 2 s.
  - **Root `bun run test` does not cover `docs/`** (its filters are `packages apps/server apps/cli skills integrations tools evals`; keep those words out of your file paths). Run `bun test docs/<area>` and `bunx tsc --noEmit -p docs/<area>` yourself. Biome **does** lint `docs/**/*.ts`, so `bun run check` must stay clean. C3 wiring for every docs epic: "add `bun test docs` and the `docs/*/tsconfig.json` typechecks to the CI docs job (Epic 150) / root scripts".
  - Mermaid fenced blocks are fine (GitHub renders them). Reuse images from `docs/assets/**` (Epic 172 owns that folder; link, don't copy).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`CHANGELOG.md`, `docs/release/**`
plus `docs/epic-174-changelog.md` and `.orchestrator/handbacks/174-changelog.md`. Read anything.

## Goal
Ship v0.1.0 with a real paper trail: a Keep-a-Changelog `CHANGELOG.md` generated from the swarm's actual history (the `epic-NN-complete` tags, `.orchestrator/epics.tsv` and the handbacks), human release notes a judge can skim, and a release checklist the maintainer can follow on demo eve. Great looks like this: re-running one script after Wave 3 merges regenerates the changelog byte-for-byte deterministically, `--check` catches a stale file, and every line traces back to an epic.

## Deliverables
1. **`docs/release/changelog.ts`:**
   - `type GitRunner = (args: string[]) => Promise<string>` (default: `Bun.spawn` of `git` in the repo root; injected in tests).
   - `collectEntries(git: GitRunner, repoRoot: string): Promise<ChangelogEntry[]>`. It reads `git tag --list 'epic-*-complete' --format='%(refname:short)%09%(creatordate:iso-strict)'`, joins each `NN` with `.orchestrator/epics.tsv` (columns `nn slug title wave machine lane depends`), and for epics missing from the TSV (Wave 3+) falls back to the first heading of `.orchestrator/handbacks/NN-*.md`, then to the merge subject `Merge branch 'epic/NN-slug'`.
   - `ChangelogEntry = { nn, slug, title, wave, date, section: Section, pr?: number }`, where `Section = 'Added' | 'Changed' | 'Fixed' | 'Security' | 'Deprecated' | 'Removed'`.
   An optional `--gh` flag adds PR numbers via `gh pr list --state merged --json number,headRefName --limit 500` (never in tests).
2. **`classify(entry, overrides)`:** deterministic keyword rules on slug/title. `security`/`SEC-`/`hardening` → Security; `fix`/`bug` → Fixed; `r2`/`r3`/`polish`/`tuning`/`round` → Changed; everything else → Added. `docs/release/overrides.json` (`{ "NN": "Section" }`) wins. Document the rules at the top of the file.
3. **`renderChangelog(entries, { version, date, unreleasedFromWave? })`:**
   - the Keep-a-Changelog header (link to keepachangelog.com and semver);
   - `## [Unreleased]` for entries newer than the release cut (a wave threshold option), then `## [0.1.0] - YYYY-MM-DD`;
   - within a version, sections in KaC order; within a section, sorted by wave then `nn`;
   - lines like `- **<area>**: <title> (Epic NN, wave W)`, where area is derived from the lane/slug;
   - stable output (no timestamps except the explicit `date`).
4. **CLI:** `bun docs/release/changelog.ts [--write] [--check] [--version 0.1.0] [--date 2026-10-28] [--gh]`. It prints to stdout by default. `--write` rewrites only the region between `<!-- changelog:start -->` and `<!-- changelog:end -->` in `CHANGELOG.md` (the intro above stays hand-written). `--check` exits 1 with a unified-diff-style summary when the file is stale.
5. **`CHANGELOG.md`** generated from the current history (28+ completion tags and the Wave 2 tags present on `main`), plus a short hand-written intro explaining that every entry is one epic built by one agent in one lane.
6. **`docs/release/notes-v0.1.0.md`:**
   - highlights for judges (real `starling run`, flock mode, open-weight routing, the murmuration dashboard, the Agent Skill, demo targets);
   - numbers from `tools/stats/out/stats.json` (cite `generatedAt`);
   - known limitations (copy them accurately from Epic 40's doc);
   - install (from source today; binaries and the installer `⏳ Epic 151/152`);
   - credits (the flock, opencode, the model makers).
7. **`docs/release/checklist.md`:** the step-by-step release checklist with exact commands:
   - freeze `main`;
   - `bash .orchestrator/bin/heavy.sh bun run test` and `… bun run check`;
   - `bun docs/release/changelog.ts --check`;
   - site build (`bun run --cwd site build`);
   - binaries (`⏳ Epic 151`: `tools/release/`) and checksums;
   - the version bump points (`apps/cli/src/program.ts` `.version('0.0.0')` is CLI-owned: a FIX REQUEST for Epic 203);
   - `git tag v0.1.0`;
   - `gh release create v0.1.0 --draft --notes-file docs/release/notes-v0.1.0.md`.
   Plus a rollback section.
8. **Tests** `docs/release/changelog.test.ts` (≥ 18):
   - TSV parsing (missing rows, extra columns);
   - tag parsing (non-epic tags ignored, malformed dates);
   - handback-title fallback;
   - classification table plus overrides;
   - rendering of a fixed fixture to an exact expected string;
   - idempotent `--write` region replacement (missing markers → clear error);
   - `--check` stale detection;
   - one integration test on a temp git repo (`git init`, 3 commits, 2 `epic-*-complete` tags, a tiny epics.tsv) under `os.tmpdir()`.
   Add `docs/release/README.md` (index + how to regenerate) and `docs/release/tsconfig.json`.

## Explicitly out of scope
- Publishing anything: no `git tag`, `gh release`, pushes of tags or uploads. Version bumps in `apps/cli` (Epic 203). Release binaries (Epic 151) and the installer (Epic 152).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test docs/release` → 0 fail, ≥ 18 tests, and `bunx tsc --noEmit -p docs/release` → clean.
3. `bun docs/release/changelog.ts --write && bun docs/release/changelog.ts --check; echo exit=$?` → `exit=0`. Paste `head -40 CHANGELOG.md`.
4. Run it twice and `git diff --exit-code CHANGELOG.md` after the second run → no diff (determinism).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-174-changelog.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/174-changelog.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/174-changelog`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
