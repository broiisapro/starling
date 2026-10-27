# Epic 11: Repo mapper

**Wave 1 · Branch `epic/11-repomap` · Issue: find it with `gh issue list --search "Epic 11 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/repomap/**`
plus `docs/epic-11-repomap.md` and `.orchestrator/handbacks/11-repomap.md`. Read anything; write nothing else.

## Goal
Implement `RepoMapper`: turn any git repo into a compact `RepoMap` (file list, languages, exported symbols, a token-budgeted tree, detected test and lint commands). The planner uses it to pick lanes and the prompt compiler uses it to orient workers. It must be fast (under 2 s for a 2k-file repo) and cheap.

## Deliverables
- `createRepoMapper(opts?: { exec?: typeof exec; llm?: LLM; cacheDir?: string; clock?: Clock }): RepoMapper`.
- File listing via `git ls-files -co --exclude-standard` (tracked plus untracked-but-not-ignored). Skip binaries (NUL-byte sniff on the first 8 KB), files > 256 KB, lockfiles, and `node_modules`/`dist`/`.starling`.
- Language detection by extension (TS/TSX/JS/JSX/MJS, Python, Go, Rust, Swift, Kotlin, Java, C/C++, C#, Ruby, PHP, CSS/SCSS, HTML, Markdown, JSON, YAML, TOML, shell, SQL…) into `languages: Record<lang, fileCount>`.
- **Symbols** via fast regexes (no parser deps) for at least TS/JS (exported functions, classes, consts, types, interfaces, default exports), Python (top-level def/class), Go (func/type), Rust (pub fn/struct/enum/trait), CSS (top-level class selectors, max 20), Markdown (h1/h2). Cap at 40 symbols per file.
- `tree`: an indented directory tree with file counts, collapsing big directories ("src/components/ (42 files)"), with the budget enforced through `renderTree(files, { maxChars })`.
- **Command detection**: `testCommand` and `lintCommand` from package.json scripts (`test`, `lint`, `check`, `typecheck`). Pick the runner from the lockfile (bun.lock → `bun run test`, pnpm-lock → `pnpm test`, yarn.lock → `yarn test`, package-lock → `npm test`). Also pytest (pyproject/pytest.ini/tests dir), `cargo test`, `go test ./...`, and a Makefile `test` target. Document the precedence order.
- `tokenEstimate` ≈ total chars / 4 over the rendered map, plus `createdAt`.
- Optional **summaries** (`opts.summarize`): for up to N most "central" files (most imported or most symbols, your heuristic), ask `llm.complete` with role `summarizer` for a one-line summary. Concurrency 4. Cache by content SHA-1 in `cacheDir` (JSON file) so reruns are instant. Missing LLM means no summaries and no error.
- Export `renderRepoMap(map, { maxTokens, focus?: string[] /* globs to expand */ }): string`, a prompt-ready text rendering. The planner and prompt compiler will adopt it at C1.
- Tests: temp git repos built in the test (`git init`, write files, commit) for each language family. Also run against a copy of `examples/sky-todo` and assert the shape matches `fixtures/repomaps/sky-todo.json` (same languages, `testCommand` detected, symbols found in `src/lib/dates.ts`). Plus a perf test: a generated 2,000-file repo maps in < 2 s.

## Explicitly out of scope
Tree-sitter or any parser dependency. Import-graph analysis beyond a cheap heuristic. Embeddings or semantic search. Planner logic.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/repomap` passes, ≥ 20 tests including the perf test and the sky-todo shape test.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-11-repomap.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/11-repomap.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/11-repomap`. Conventional Commits scoped to your lane (`feat(repomap): …`, `test(repomap): …`, `docs(epic-11): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
