# Epic 108: Repo map round 2: more languages, import graphs, CODEOWNERS hints, 10k-file budget

**Wave 3 · Branch `epic/108-repomap-r2` · Issue: `gh issue list --search "Epic 108 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-108-repomap-r2.md` and `.orchestrator/handbacks/108-repomap-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.


## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- No Wave 2 FIX REQUEST targets `packages/repomap`.
- **56 deferred, now in scope:** Go/Rust/absolute-Python imports and a cheaper `tokenEstimate` (deliverables 2, 4).
- **48 deferred:** the large-repo map-budget benchmark (deliverable 5).
- **56 #2** (stale `docs/epic-11` and `docs/epic-13`) is orchestrator-owned. List it as not yours.

## Your lane (you may write ONLY here)
`packages/repomap/**`
plus `docs/epic-108-repomap-r2.md` and `.orchestrator/handbacks/108-repomap-r2.md`. Read anything.

## Goal
The repo map is how every agent sees a codebase it has never met. Judges will point Starling at their own repos, which may be Java, Ruby, C# or Kotlin, so give those languages real symbols. Teach the import graph Go, Rust and absolute Python. Read CODEOWNERS so the planner can respect who owns what, and prove the mapper stays fast and bounded on a 10,000-file repo without flaky wall-clock tests. Great looks like: a polyglot fixture repo maps with sensible symbols and neighbours in every language, and the budget test asserts work counts, not milliseconds.

## Deliverables
1. **More symbol extractors** (`src/symbols.ts`). Go and Rust already exist. Add **Java, Kotlin, C#, Ruby, Swift and PHP** (regex, top-level and type members as the existing extractors do), plus each to `SYMBOL_LANGUAGES` (`src/languages.ts`). There are ≥ 3 tests per language: commented-out code and string literals yield no symbols, nesting is handled, file order is kept, and `SYMBOL_CAP` is respected.
2. **Import graph for more languages** (`src/imports.ts`, 56 deferred). Go: module path from `go.mod` → package directory. Rust: `mod x;` → `x.rs` / `x/mod.rs`, and `use crate::a::b` → `src/a.rs` / `src/a/mod.rs`. Python absolute: `import pkg.mod` / `from pkg import x` when `pkg/` sits at the root or under `src/`. Unresolvable imports are ignored, never thrown. Tests on small temp repos via `test-helpers.ts`.
3. **CODEOWNERS hints** (new `src/owners.ts`). `parseCodeowners(text): CodeownersRule[]`, `ownersFor(path, rules): string[]` (GitHub semantics: last match wins, with `*`, `/dir/`, `*.ext` and `docs/**`), and `loadOwnershipHints(root): Promise<OwnershipHints | undefined>` (reads `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`). `attachOwnership(map, hints)` and `ownershipOf(map)` follow the existing `attachImportGraph` / `importGraphOf` pattern, so `RepoMap` (core) stays unchanged. `renderRepoMap(map, { …, owners?: boolean })` adds a budgeted "Owners" block (top-level dir → owners).
4. **10k-file budget.** `RepoMapperOptions.budget?: { maxFiles?: number; maxReadBytesPerFile?: number; maxSymbolFiles?: number }` with documented defaults. Make `tokenEstimate` cheap (estimate from per-file line lengths instead of rendering the whole map, per 56's note that it was 193 ms of 580 ms on Django). Raise or make size-aware `MAX_ENTRIES = 5000` in `src/cache.ts`. Add a `mapperStats(map)` (or an `onStats` callback) reporting files listed, files read, bytes read and render calls.
5. **Benchmark without flake.** `src/bench.ts` (`bun packages/repomap/src/bench.ts --files 10000`) prints a timing table. The test (`src/budget.test.ts`) maps a synthetic 10k-file repo and asserts **work counts** (files read ≤ budget, render calls for `tokenEstimate` = 0, bytes read ≤ budget). Convert the wall-clock `BUDGET_MS = 2000` in `src/perf.test.ts` to the same kind of op-count assertions (L38: no wall-clock asserts with 100 agents on the CPU).
6. A polyglot fixture repo built in tests (one file per new language, a CODEOWNERS file and Go/Rust/Python imports) with a golden `renderRepoMap` snapshot.
7. Write **at least 35 new tests**.

## Explicitly out of scope
- Tree-sitter or any parser dependency (L34, and Epic 11's no-parser decision).
- `packages/planner` (Epic 107) and `packages/prompts` (Epic 109): they can opt into `owners` later. Note the C3 line.
- Changing `detectCommands`' nested-package rule (56 open question): document it, leave it.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/repomap` → 0 fail, ≥ 35 new tests, no wall-clock assertion left.
3. `bunx tsc --noEmit -p packages/repomap` clean.
4. Paste the `bench.ts --files 10000` table (time is informative only) and the polyglot fixture's rendered map.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-108-repomap-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/108-repomap-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/108-repomap-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
