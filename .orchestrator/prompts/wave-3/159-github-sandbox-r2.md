# Epic 159: GitHub sandbox round 2: idempotent, dry-run, rate-limit aware

**Wave 3 · Branch `epic/159-github-sandbox-r2` · Issue: `gh issue list --search "Epic 159 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-159-github-sandbox-r2.md` and `.orchestrator/handbacks/159-github-sandbox-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Your folder is outside the Bun workspace.** `tools/`, `evals/` and `integrations/` are not workspace members, so bare `@starling/*` and `zod` specifiers do not resolve there. Import other packages by relative path to their public entry (`../../packages/core/src/index.ts`, exactly like `tools/stress/harness.ts` and `evals/lib/core.ts`). Validate with core's exported zod schemas (`StarlingEventSchema`, `PlanSchema`, `RunSchema`, …) instead of importing `zod`. The root `typecheck` loop only covers `packages/* apps/*`, so give every new folder its own `tsconfig.json` (copy `tools/flock/tsconfig.json`, widen `include` if you add subfolders) and typecheck it yourself.
- **Root `bun run test` runs every `*.test.ts` under `tools`, `integrations` and `evals` in one process**, next to everyone else's. Your tests must be offline, deterministic and quick (budget given below), restore any env var they set, stop every server they start and delete every temp dir.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- No Wave 2 FIX REQUEST targets `tools/github-sandbox/**`.
- Epic 43 deferred, *a real secondary-rate-limit run was deliberately not provoked*: keep it that way; the budget gate and pacing (deliverable 4) are the mitigation, tested against the fake.
- Epic 43 deferred, *duplicate reconciliation beyond the 2.4 s settle budget*: `check` must detect duplicates (two issues with the same marker) and report them as a failed check, without fixing them.

## Your lane (you may write ONLY here)
`tools/github-sandbox/**`
plus `docs/epic-159-github-sandbox-r2.md` and `.orchestrator/handbacks/159-github-sandbox-r2.md`. Read anything.

## Goal
GitHub mode (an issue per task, a PR per task with the audit verdict, a final PR) is something judges can click through, so it has to work every time we need it. Epic 43 proved it once with `setup.sh`, `e2e.ts` and `teardown.sh`. Round 2 makes the sandbox a reusable tool: one `sandbox.ts` with `setup | status | check | teardown | reset`, where every mutating step is planned from the observed state (so running twice does nothing the second time), `--dry-run` shows exactly what would happen, the tool refuses to start when the API budget is too low, and `check` walks issue → PR → merge as about 20 verified checks with a pass/fail table at the end. None of it runs in tests; tests drive an in-memory fake GitHub.

## Deliverables
1. **gh port** `tools/github-sandbox/gh-port.ts`: `export type GhRunner = (argv: string[], opts?: { input?: string; mutating?: boolean }) => Promise<{ code: number; stdout: string; stderr: string }>`; `realGh(opts?: { sleep?, warn? })` over core `exec(['gh', ...])` with retries from `packages/github/src/index.ts` (`isRetryableGhFailure`, `backoffMs`); `dryRunGh(inner)` that runs read calls and **records** mutating calls instead (prints `[dry-run] gh …` via `shellJoin`).
2. **State, then plan, then act** `tools/github-sandbox/state.ts` + `plan.ts`: `readSandboxState(gh, repo): Promise<SandboxState>` (exists, visibility, default branch, has `main`, labels, open `starling`-labelled or marker-bearing issues, open PRs with `starling/` heads, `starling/*` branches); pure `planSetup(state, opts): SandboxAction[]` and `planTeardown(state): SandboxAction[]`, where `SandboxAction` is a union (`create-repo`, `seed-main`, `ensure-label`, `close-issue`, `close-pr`, `delete-branch`); `describeAction(a): string`; `actionArgv(a, repo): string[]`. A second `planSetup` after applying the first is empty; `planTeardown` on a clean sandbox is empty.
3. **Hard safety rails, enforced in the planner and tested as properties:** never plan deleting the repo, `main`, or labels; refuse a public repo (same rule as `setup.sh`); refuse any repo whose name doesn't end in `-sandbox` unless `--i-know-this-is-not-a-sandbox` is passed.
4. **Rate-limit awareness** `rate.ts`: `parseRateLimit(json)` for `gh api rate_limit` (core, graphql, search: remaining/limit/reset); `estimateCalls(command: 'setup' | 'check' | 'teardown', tasks: number): number`; `ensureBudget(...)` that exits 3 with "needs ~N calls, M left, resets at HH:MM" when remaining < estimate + margin (default 100). Pace content-creating calls (default 1 s apart, injectable `sleep`) per GitHub's secondary-limit guidance.
5. **One CLI** `tools/github-sandbox/sandbox.ts setup|status|check|teardown|reset [--repo owner/name] [--dry-run] [--offline] [--json] [--min-remaining N] [--keep]`. `--offline` with `--dry-run` assumes an empty or unknown state, so the plan can be shown without `gh`. `status` prints the state and the teardown plan. Same env vars as today (`STARLING_SANDBOX_OWNER`, `_NAME`, `_RESET`, `_DIR`, `STARLING_SANDBOX_REPO`).
6. **Keep the old entry points working (L33):** `setup.sh` and `teardown.sh` keep their names, env vars, exit codes and "URL on the last stdout line" contract. Either leave them as they are or turn them into thin bash 3.2 wrappers around `sandbox.ts`. `bun tools/github-sandbox/e2e.ts [--keep] [--repo] [--dir]` keeps working, either as is or by delegating to `check`.
7. **Scripted flow check** `check.ts` (`sandbox.ts check`): refactor the `e2e.ts` flow into `CheckStep { id: string; title: string; run(ctx): Promise<{ ok: boolean; detail: string; url?: string }> }`, each verified by an **independent read** (issue exists, is labelled and carries the marker; re-sync creates 0; task branch has a commit; PR base is the integration branch; PR body has the verdict table; after merge the issue is closed with the merged comment; final PR targets `main`; teardown leaves 0 open). About 20 checks in one session, ending in a numbered pass/fail table plus every URL. A failing step doesn't hide the rest unless later steps depend on it (mark those `skip`). Use `createGitHubTracker` from `packages/github/src/index.ts` exactly as `e2e.ts` does; `--dry-run` passes `dryRun: true` and prints `tracker.dryRunLog()`.
8. **In-memory fake GitHub** `fake-github.ts` for tests: repos, visibility, branches, labels, issues, PRs, comments, rate limit, and a scriptable secondary-limit failure, answering the exact `gh` argv shapes your code emits. (You may also reuse `packages/github/src/testing/fake-gh.ts` by relative path where it fits; don't edit it.)
9. **Tests (never real gh):** plan idempotency (apply plan → re-read → empty), the safety properties over generated states, dry-run makes zero mutating calls, the budget gate, `--offline` dry-run, check-step reporting with an injected failure, argv quoting with odd titles, and a `bash -n` syntax check of both `.sh` files. At least 30 tests; `bun test tools/github-sandbox` under 5 s.
10. `tools/github-sandbox/README.md`: what each command does, the env vars, the safety rails, and a sample `check` table.

## Explicitly out of scope
- `packages/github/**` (Epic 106 is adding backoff, labels and check runs in parallel; FIX REQUESTS only).
- `integrations/github-action/**` (Epic 164), `.github/workflows/**` (Epic 150), `tools/qa/github-store/**` (Epic 189).
- Deleting the sandbox repo, touching any non-sandbox repo, running `gh` from a test.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/github-sandbox` → 0 fail, ≥ 30 tests, under 5 s.
3. `bunx tsc --noEmit -p tools/github-sandbox/tsconfig.json` and `bunx biome check tools/github-sandbox` clean.
4. `bun tools/github-sandbox/sandbox.ts setup --dry-run --offline` and `teardown --dry-run --offline`: paste both plans.
5. If `gh auth status` succeeds on this laptop: run `sandbox.ts status`, then `check` once against `starling-sandbox`, and paste the pass/fail table and the rate-limit line. Otherwise mark it deferred with the reason.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-159-github-sandbox-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/159-github-sandbox-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/159-github-sandbox-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
