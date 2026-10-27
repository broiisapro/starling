# Epic 105: Workspace round 2: gc library, worktree locks, disk budget, dependency linking

**Wave 3 · Branch `epic/105-workspace-r2` · Issue: `gh issue list --search "Epic 105 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-105-workspace-r2.md` and `.orchestrator/handbacks/105-workspace-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- Epic 143 (CLI gc) and Epic 100 (engine) consume your API in parallel. Publish exact signatures in `docs/epic-105-workspace-r2.md` early (commit the doc stub first) and don't rename anything you announce.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **57 #1:** the `starling gc` library side for CLI Epic 143 (deliverable 1). The CLI half is Epic 143's.
- **57 #2/#3** (engine) and **57 #4** (CLI config plumbing): not this lane. List them as such.
- **57 open question:** allocated vs apparent size (deliverable 4).
- **Epic 40 open question:** `node_modules` linking belongs in `Workspace` (deliverable 5).

## Your lane (you may write ONLY here)
`packages/workspace/**`
plus `docs/epic-105-workspace-r2.md` and `.orchestrator/handbacks/105-workspace-r2.md`. Read anything.

## Goal
With ~100 worktrees on one laptop, disk and leftovers are real demo risks. `recoverWorkspace` already knows what a dead run left behind. Wrap it in the small, safe `gcWorktrees` API that CLI Epic 143 calls, make worktrees survive crashes honestly (git worktree locks that record who owns them), refuse to create a worktree when the disk budget is blown, and give dependency linking (`node_modules`) a proper home inside the workspace instead of a CLI decorator. Great looks like: `gcWorktrees({ dryRun: true })` prints a clear report with bytes to free, and nothing a live run owns is ever touched.

## Deliverables
1. **gc library** (new `src/gc.ts`, exported). `findStaleWorktrees(repo: string, worktreeRoot: string, opts?: RecoverWorkspaceOptions): Promise<RecoveryEntry[]>` (a dry-run `recoverWorkspace`, entries only). `gcWorktrees(repo: string, worktreeRoot: string, opts?: GcOptions): Promise<GcReport>` where `GcOptions = RecoverWorkspaceOptions & { dryRun?: boolean /* default TRUE */; includeBundles?: boolean }` and `GcReport = RecoveryReport & { freedBytes: number; freedHuman: string; bundles: { removed: string[]; freedBytes: number }; summary: string[] }`. It measures each collectable worktree with `diskUsage` before removing it, and with `includeBundles` also removes `<root>/bundles/*.bundle` (see `bundlePathFor` in `src/paths.ts`) older than the cutoff. `summary` holds 3–8 human lines for the CLI. Note that **gc defaults to dry-run**, unlike `recoverWorkspace`. Put the exact signature in the doc for Epic 143.
2. **Worktree locks.** `create()` runs `git worktree lock --reason "starling run=<runId> pid=<pid> ts=<ms>"` (runId from `runIdOf(branch)`) behind `CreateWorkspaceOptions.lockWorktrees?: boolean` (default `true`). `remove()` unlocks first. `WorktreeEntry` (`src/repo.ts` `listWorktrees`) gains an additive `locked?: string` parsed from `--porcelain`. Export `parseLockReason(reason): { runId?: string; pid?: number; ts?: number } | undefined`. `recoverWorkspace` takes `processAlive?: (pid: number) => boolean` (default `process.kill(pid, 0)` in a try). It keeps a locked worktree whose pid is alive (`kept.live`), and unlocks and collects one whose pid is dead once it is older than the cutoff. Tests on real temp repos.
3. **Disk budget.** `CreateWorkspaceOptions.diskBudget?: { maxBytes?: number; minFreeBytes?: number; checkEveryMs?: number /* default 30 000 */ }` and `freeSpace?: (path: string) => Promise<number>` (default `statfs` from `node:fs/promises`). Before `create`, a cached measurement of `worktreeRoot` usage plus free space is checked. Over budget throws `StarlingError('WORKSPACE_ERROR', 'disk budget exceeded: …', { details: { reason: 'disk-budget', usedBytes, maxBytes, freeBytes } })`. Export the pure `checkDiskBudget(usage, budget, freeBytes): { ok: boolean; reason?: string }`. Tests with injected probes and clock (no real disk filling).
4. **Allocated size** (57 open question). `DiskUsage.allocatedBytes` (additive, `st_blocks × 512`, falling back to bytes), and the gc report uses it.
5. **Dependency linking** (Epic 40's open question). `CreateWorkspaceOptions.linkDependencies?: boolean | string[]` (`true` = `['node_modules']`). After `create`, it symlinks `<repo>/<dir>` into the worktree when the source exists and the target doesn't, and makes sure the repo's **common** git dir (`git rev-parse --git-common-dir`) has the dir in `info/exclude`, so `commitAll` never commits the link. Port the logic from Epic 40's decorator (`git show epic/40-integration-captain:apps/cli/src/real/workspace-deps.ts`). Best effort: a link failure never fails `create`. Tests: link created, `commitAll` ignores it, no source = no-op, a linked worktree repo.
6. Write **at least 30 new tests** (real temp git repos where git matters, fakes elsewhere). The existing 135 tests stay green.

## Explicitly out of scope
- The `starling gc` command itself (Epic 143 builds `apps/cli/src/ext/gc/` against your API, with a local fallback).
- Calling recovery from the engine (Epic 100 adds the hook) and swapping Epic 40's decorators in the composition (C3/3b).
- Merger-owned integration worktrees (`packages/merger`, Epic 104). LFS and submodules.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/workspace` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p packages/workspace` clean.
4. Paste the `GcReport.summary` lines from a scripted temp repo with one dead run, one live (locked, alive pid) run and one integration branch (only the dead run is collectable).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-105-workspace-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/105-workspace-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/105-workspace-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
