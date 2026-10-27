# Epic 103: Auditor round 2: lane traversal (SEC-08), command policy (SEC-11), verdict explanations

**Wave 3 · Branch `epic/103-auditor-r2` · Issue: `gh issue list --search "Epic 103 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-103-auditor-r2.md` and `.orchestrator/handbacks/103-auditor-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.


## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **SEC-08** (69): lane traversal. Fix it in `lane.ts`, and FIX REQUEST the core glob change to Epic 202 (deliverable 1).
- **SEC-11** (69), auditor half: policy, timeout, env scrub and the documented risk (deliverables 2–3, 6).
- **Epic 40 CONTRACT REQUEST 1 / 70 F5:** tests run in the hub repo when no worktree path is set (deliverable 4).
- **44's FIX REQUESTS** target `evals/real.ts`, `tools/local-models` and `apps/cli`, not this lane. List them as "not mine".

## Your lane (you may write ONLY here)
`packages/auditor/**`
plus `docs/epic-103-auditor-r2.md` and `.orchestrator/handbacks/103-auditor-r2.md`. Read anything.

## Goal
The auditor is Starling's quality gate, and the lane check is the only thing that stops a worker (or a hostile perch) from editing outside its assignment. Today `src/../secrets.env` sails through. Fix the traversal inside the auditor (core's glob is off limits until Wave 3b), put a written, tested policy around the repo-provided commands it runs, and give the dashboard a plain-English "why did this fail / pass with warnings" explanation it can show judges. Great looks like: three security probes flipped, no new shell call site, and an `explainVerdict` that reads well on every verdict in the recorded fixtures.

## Deliverables
1. **SEC-08 canonical lane paths** (`src/lane.ts`, without touching `packages/core/src/glob.ts`). Export `canonicalLanePath(raw: string): { path: string; problem?: 'traversal' | 'absolute' | 'invalid' }`. It turns `\` into `/`, applies `normalizeGlobPath`, then `posix.normalize`. Flag as a violation **any** raw path with a `..` segment (git never emits one, so it's a hostile signal), any absolute path (`/x`, `C:/x`), an empty path or a NUL byte. `checkLane` uses it before glob matching, and so does `isBookkeepingPath` (today `.starling/../package.json` may match `.starling/**` and be exempt: test it). Keep the violation strings the existing probes expect (`checkLane(['../escape.ts'], …).violations` is `['../escape.ts']`). Add an additive `LaneCheckResult.problems?: Record<string, 'traversal' | 'absolute' | 'invalid' | 'outside-lane'>`.
2. **SEC-11 command policy** (new `src/command-policy.ts`). `CommandPolicy = { mode: 'any' | 'allowlist' | 'off'; allow?: string[]; scrubEnv?: boolean }`, default `{ mode: 'any', scrubEnv: true }` so nothing changes for today's repos. `evaluateCommand(cmd, policy): { allowed: boolean; reason?: string }`. Allowlist mode accepts only commands that start with a `DEFAULT_ALLOWED_COMMANDS` prefix (`bun test`, `bun run test`, `npm test`, `npm run test`, `pnpm test`, `yarn test`, `npx vitest`, `npx jest`, `pytest`, `python -m pytest`, `go test`, `cargo test`, `make test`, `biome check`, `eslint`, `ruff check`, …) and contain no `;`, `&&`, `||`, `|`, backticks, `$(` or redirections. `scrubbedEnv(source)` returns overrides that set secret-looking vars to `''` (`TOKEN|SECRET|PASSWORD|API_KEY|_KEY$`, `^GH_`, `^GITHUB_`, `OPENCODE_SERVER_PASSWORD`, `^DEEPSEEK`, `^OPENAI`, `^ANTHROPIC`), because core `exec` merges `opts.env` over `process.env` (`packages/core/src/exec.ts:35`). It always sets `CI=1`. Add `CreateAuditorOptions.commandPolicy?` (additive). `'off'` gives a `tests` check `ok: true` with detail `skipped: tests disabled by policy` (the future `--no-tests`). A blocked command gives `ok: false` with `blocked by command policy: <reason>`. Table tests.
3. Wire the policy and env into `runShellCommand` (`src/commands.ts`) through a new optional parameter. **Keep the literal `['sh', '-c', command]` in `commands.ts`**: `tools/security/exec-argv.test.ts` allow-lists exactly that file, so don't move the call.
4. **Where the tests ran.** When `run.worktreePath` is missing, the `tests` check detail says `(no task worktree: ran in the hub repo)`, and `CreateAuditorOptions.requireWorktree?: boolean` (default false) fails the check instead. Epic 100 starts filling `worktreePath`, so test both.
5. **Verdict explanations** (new `src/explain.ts`, **type-only imports from core**, so a browser bundle could use it later). `explainVerdict(v: AuditVerdict): VerdictExplanation` returns `{ level: 'pass' | 'warn' | 'fail'; headline: string; blocking: ExplainedCheck[]; advisory: ExplainedCheck[]; passed: string[]; nextStep?: string }` with `ExplainedCheck = { name; label; why; detailTail }` (`detailTail` ≤ 300 chars). The level is `warn` when the verdict passes with advisory failures (non-blocking lint, hub-repo fallback, reviewer not consulted). `formatVerdictExplanation(e): string` gives ≤ 6 plain lines, e.g. "✘ Failed: 2 blocking checks. Lane: edited docs/readme.md outside src/**. Tests: exit 1, 3 failing…". Golden tests over every `audit.verdict` in `fixtures/runs/sky-todo-launch-day.jsonl`, plus hand-made verdicts for each check name (`lane`, `non-empty`, `tests`, `missing-tests`, `lint`, `llm-review`).
6. **Docs:** the SEC-11 accepted risk (repo commands run as the user, mitigated by worktree cwd, timeout, env scrub and the allowlist option) goes in your epic doc.
7. **Probes** (L36). Flip the three `lane check: traversal bypasses` probes in `tools/security/auditor-lane.test.ts`.
8. Write **at least 35 new tests**. Existing snapshots in `src/__snapshots__` change only where a detail string deliberately changed, and the handback lists each one.

## Explicitly out of scope
- `packages/core/src/glob.ts` (the core half of SEC-08 goes to Epic 202 in Wave 3b. File a FIX REQUEST with the exact normalisation).
- The engine's reaction to advisory or outage verdicts (Epic 100). The merger's copy of the command policy (Epic 104 keeps its own table; don't import across).
- Reviewer prompt or model choice changes, and `evals/auditor` (Epic 162).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/auditor` → 0 fail, ≥ 35 new tests.
3. `bunx tsc --noEmit -p packages/auditor` clean.
4. `bun test tools/security/auditor-lane.test.ts tools/security/exec-argv.test.ts` → 0 fail, with the three traversal probes flipped and no new shell site.
5. Paste `formatVerdictExplanation(explainVerdict(v))` for one failing and one passing verdict from the fixture.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-103-auditor-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/103-auditor-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/103-auditor-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
