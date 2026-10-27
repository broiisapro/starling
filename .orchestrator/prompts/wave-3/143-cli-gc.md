# Epic 143: CLI: `starling gc` for stale worktrees and branches

**Wave 3 · Branch `epic/143-cli-gc` · Issue: `gh issue list --search "Epic 143 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-143-cli-gc.md` and `.orchestrator/handbacks/143-cli-gc.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **L39 CLI extension module.** `apps/cli/src/program.ts` and everything else in `apps/cli/src` belong to Epic 40 right now. You build a self-contained module in your own folder `apps/cli/src/ext/<name>/` that C3 registers with one line:
  ```ts
  import type { Command } from 'commander';
  export interface ExtIo { out(line: string): void; err(line: string): void; cwd: string; env: Record<string, string | undefined> }
  export const extension = {
    name: '<command name>', summary: 'one line for --help',
    register(program: Command, io: ExtIo): void { /* program.command(...).option(...).action(...) */ },
  } as const;
  ```
  Depend only on `commander`, `@starling/core` and other packages' public `index.ts` exports, plus `node:*`/`bun` built-ins. Don't import from `apps/cli/src/*.ts` (it's changing under Epic 40), except types re-exported by core. Tests register your extension on a fresh `new Command()` with `exitOverride()` and an in-memory `ExtIo`. Add a tiny `apps/cli/src/ext/<name>/try.ts` entry (`bun apps/cli/src/ext/<name>/try.ts <args>`) so the command can be used before C3 wires it, and paste a real invocation's output in the handback.
- **Imports from other packages (C1 CLI rule).** On the base you branch from, `apps/cli/package.json` lists only `@starling/core`, `@starling/perch`, `commander` and `picocolors` (Epic 40 adds the rest, but may not be merged when you start, and you must not touch `package.json`). So import any other workspace package **by relative path to its public entry**, exactly like `tools/load` does: `../../../../../packages/<pkg>/src/index.ts` and `../../../../server/src/index.ts`. Never import `apps/cli/src/*.ts` (Epic 40 is rewriting `commands/*`, `context.ts`, `compose.ts`, `program.ts`). If you need a pure helper from there (`render/format.ts`'s `fmtDuration`, `fmtUsd`, `fmtTokens`, `renderTable`, `stripAnsi`, `truncate`; `render/palette.ts`'s NO_COLOR/FORCE_COLOR rule), **copy** it into your folder with a one-line `// copied from apps/cli/src/render/format.ts (Epic 22)` comment. `picocolors` (already a CLI dependency) is fine for colour. In the handback, list the relative imports so Epic 203 can switch them to `@starling/<pkg>` later.
- **Read events leniently.** `readEventsJsonl` (CLI) and `@starling/store`'s `parseJsonl` both throw on any event type they don't know, and newer recordings will carry types this base doesn't have (Epic 40 adds `run.status`, Epic 100 may add `task.diff`). Write your own small reader: per line `JSON.parse`, then `StarlingEventSchema.safeParse` from `@starling/core`; an object whose `type` isn't in `StarlingEventTypeSchema.options` is **skipped and counted** (report "skipped N unknown events" in dim text), a malformed *known* event is a `StarlingError('INVALID_ARGUMENT', '<file>:<line>: …')`. Blank lines are fine.
- **Server facts** (from `apps/server/src`): SSE frames are `data: <StarlingEvent JSON>\n\n`, with `: connected` and `: keep-alive` comment lines; `GET /api/runs` (array of `Run`), `GET /api/runs/:id/events?since=<ts>` (backlog then live), `GET /api/events` (all runs plus `runId: '*'` node events), `GET /api/health`. Default URL `http://127.0.0.1:7777`, overridable by `--url` or `STARLING_URL`. Epic 110 may add an auth token in parallel: accept `--token` / `STARLING_TOKEN` and, when set, send it as both `x-flock-token` and `authorization: Bearer <token>`.
- **Testable shape.** Put the logic in `run<Name>(options, deps): Promise<number>` (returns the exit code) where `deps` injects `out`, `err`, `now`, `sleep`, `fetch`, `exec` (core `exec` signature), `isTTY`, `columns`, `env`, `cwd`. `register()` only parses flags, builds real deps from `ExtIo` + `process`, calls `run<Name>`, and sets `process.exitCode` when the code is non-zero. Unit tests call `run<Name>` with fakes; a few tests go through commander to pin flag parsing and `--help` text. Your folder's `index.ts` exports `extension` (and your public functions/types).
- **Test data.** `fixtures/runs/sky-todo-launch-day.jsonl` (252 events, 7 tasks, 3 nodes, an `air` node that drops and a `search` task that migrates back to the hub, one audit fail on `theme` fixed on attempt 2, final `metrics` with `apiCostUsd`/`estSavedUsd`) and `fixtures/plans/sky-todo-launch-day.json` (a raw `Plan`) exist on your base. `fixtures/real/*.jsonl` arrive with Epic 40: use them if present, never require them.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **57-workspace-hardening, request 1:** add `starling gc [--repo .] [--worktree-root <dir>] [--dry-run] [--older-than-hours 12] [--include-integration] [--json]` implemented as `recoverWorkspace(...)`, printing `report.entries` / `report.removed`, exit 1 when `report.errors` is non-empty. This epic **is** that request; implement it as an extension (not in `program.ts`).
- **57, request 4** (`worktree.maxGitConcurrency` / `worktree.pruneIntervalMs` config plumbing): decline here (config schema is core, Wave 3b); note it in the handback.

## Your lane (you may write ONLY here)
`apps/cli/src/ext/gc/**`
plus `docs/epic-143-cli-gc.md` and `.orchestrator/handbacks/143-cli-gc.md`. Read anything.

## Goal
A crashed or interrupted run leaves task worktrees (tens of thousands of files each) and `starling/<run>/<task>` branches behind, and on demo day, after a dozen rehearsals, that fills a laptop. `starling gc` is the safe broom Epic 57 asked for: it shows exactly what would be removed and why, never touches live runs or integration branches unless asked, and frees the space in one command. Great looks like: a clear table with ages and reasons, a "would free 2.3 GB" line, `--json` that scripts can trust, and zero chance of deleting someone's work.

## Deliverables
1. `index.ts` exporting `extension` (`name: 'gc'`) registering `starling gc` with exactly Epic 57's interface: `--repo <path>` (default `.`), `--worktree-root <dir>`, `--dry-run`, `--older-than-hours <n>` (default `DEFAULT_OLDER_THAN_HOURS` = 12, `0` allowed, negative or NaN → exit 2), `--include-integration`, `--json`. Add `--live <runIds>` (comma list, extra protection) and `--yes` (see 5).
2. `gc.ts`: `runGc(options, deps): Promise<number>` calling `recoverWorkspace(repo, worktreeRoot, { dryRun, olderThanHours, includeIntegration, liveRunIds, clock })` from `packages/workspace/src/index.ts` (it already exists from Epic 57 and does the real work; do not reimplement git logic). `repo` is resolved and must be a git repo (`resolveRepo` from the same package), else exit 2 with a hint.
3. Worktree root: `--worktree-root` if given, else `worktreeRoot` from `loadConfig(undefined, repo)` (core), resolved **relative to the repo** when relative (same rule as Epic 40's `worktreeRootFor`: copy the one-liner), which for the default `../.starling-worktrees` equals Epic 57's `join(dirname(repo), '.starling-worktrees')`.
4. Live runs: protect every id passed with `--live`, plus every run in `<repo>/.starling/starling.db` whose status is not `finished|failed|cancelled`, when that file exists (open it with `createSqliteStore` from `packages/store/src/index.ts`, read `listRuns()`, close it). Convert run ids to the `<run>` segment format that `runIdOf` returns (read `packages/workspace/src/recover.ts` and `paths.ts` to get this exactly right) and test it.
5. Safety: in a TTY without `--yes` and without `--dry-run`, run the dry run first, print the plan, and ask `Remove N worktrees and M branches? [y/N]` (injectable `prompt` dep); non-TTY without `--yes` behaves like `--dry-run` and says so. `--json` never prompts (requires `--yes` or `--dry-run`, else exit 2).
6. `render.ts`: `renderGcReport(report, { palette, width })` showing a table of `entries` (kind, reason, branch or path, age in hours, actions), a "kept" summary (live / young / protected / foreign / unknown counts), errors in red, and a footer `would free ≈ X` / `freed ≈ X` using `diskUsage` + `formatBytes` from the workspace package on each worktree directory **before** removal (skip sizes when there are more than 50 entries or with `--no-size`).
7. `--json` prints `{ report, freedBytes?: number }` with the `RecoveryReport` passed through unchanged (it is JSON-serialisable as is), one object, nothing else on stdout.
8. Exit codes: 0 success (including "nothing to collect"), 1 when `report.errors` is non-empty (Epic 57's rule), 2 for bad arguments.
9. `try.ts`: `bun apps/cli/src/ext/gc/try.ts --repo <path> --dry-run`.
10. Tests (≥ 25) on **real temp git repos** under `os.tmpdir()`: a repo with two `starling/<run>/<task>` worktrees plus an integration branch; dry run lists both task worktrees and keeps integration; `--include-integration` lists it too; `--live` protects a run; a non-terminal run in a real SQLite store at `.starling/starling.db` protects its worktrees; an injected clock makes "older than 12 h" deterministic (no sleeps, no touching mtimes in the past unless via `utimesSync`); non-TTY without `--yes` changes nothing; `--yes` removes and the second run reports nothing; `--json` parses and has no extra stdout lines; bad `--older-than-hours` → 2; not a repo → 2.

## Explicitly out of scope
- Changes to `packages/workspace` (Epic 105 owns it in this wave; it is adding `findStaleWorktrees`/`gcWorktrees` in parallel). Don't wait for those: `recoverWorkspace` is the interface. If you find a bug in it, write a FIX REQUEST for Epic 105 with a repro.
- Engine-side automatic gc at run start (Epic 57's request 2 goes to the engine, Epic 100).
- Deleting bundle files, `.starling/` state or SQLite rows.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test apps/cli/src/ext/gc` → 0 fail, ≥ 25 tests.
3. `bunx tsc --noEmit -p apps/cli` clean.
4. Create a scratch repo with `bash examples/scripts/make-demo-repo.sh sky-todo /tmp/gc-demo` (set `DEMO_SKIP_INSTALL=1 DEMO_SKIP_TESTS=1`), add two worktrees on `starling/abc123/t01-x` and `starling/abc123/integration` under `/tmp/.starling-worktrees`, then run `bun apps/cli/src/ext/gc/try.ts --repo /tmp/gc-demo --older-than-hours 0 --dry-run` and paste the table (the integration branch must be listed as protected), then `--yes` and paste the result.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-143-cli-gc.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/143-cli-gc.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/143-cli-gc`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
