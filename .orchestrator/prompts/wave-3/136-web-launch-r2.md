# Epic 136: Web: launch form round 2 (templates, preview step, validation, recent goals)

**Wave 3 · Branch `epic/136-web-launch-r2` · Issue: `gh issue list --search "Epic 136 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-136-web-launch-r2.md` and `.orchestrator/handbacks/136-web-launch-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 53 open question (budget copy)**: the hint says "USD cap · 0 = plan only" (`LaunchForm.tsx:237`). A per-run budget is advisory until the engine honours `budgetUsd` (Epic 100, in parallel). Reword it, e.g. "Spend cap (USD) · enforced once the hub supports per-run budgets · 0 = plan only (dry run)", and tie `0` to dry-run (deliverable 4).
- **Epic 53 #1–#5** (shell render, preview endpoint, budget plumbing, `?playground=launch`, initial repo): decline. They belong to Epic 112 (shell/routes), Epic 110 (server) and Wave 3b (data). Deliverable 6 makes the C3 wiring a single line.

## Your lane (you may write ONLY here)
`apps/web/src/features/launch/**`
plus `docs/epic-136-web-launch-r2.md` and `.orchestrator/handbacks/136-web-launch-r2.md`. Read anything.

## Goal
The launch panel (Epic 53) is finished but **not mounted anywhere**: the shell never wired it. Round 2 makes it ship-ready. It gets goal templates for every demo target (sky-todo and py-ledger today, the birdwatch API when it lands), an explicit Goal → Preview → Launch flow that degrades gracefully when the hub can't preview, strict validation of anything that goes into a request, and a recent-goals list. It also ships a self-contained container + manifest so C3 can mount it with a single line. Great looks like this: a judge picks "py-ledger · bug-hunt", sees the plan and its lanes, and launches.

## Deliverables
1. **Carryover**: fix the budget copy (below).
2. **Templates per target** (`goals.ts`):
   - `GOAL_TEMPLATES: Readonly<Record<string, readonly LaunchGoal[]>>` keyed by repo path: `examples/sky-todo` (the existing `DEMO_GOALS` + `will-fail-audit`) and `examples/py-ledger` (`quick-wins`, `bug-hunt`, `feature-day`). Copy the texts verbatim from `examples/*/demo-goals/<name>.md`.
   - `goalsForRepo(repoPath: string): readonly LaunchGoal[]` matches by trailing path/basename and falls back to sky-todo. The chips follow the repo field.
   - Keep `DEMO_GOALS`/`DEMO_REPO_PATH` exports unchanged (L33).
   - A drift test reads the `.md` files with `node:fs` and asserts the texts match exactly.
   - Epic 168 (`examples/birdwatch-api`) is being written in parallel: don't add it, and list the one-line addition in the handback for C3.
3. **Three-step flow** (Goal → Preview → Launch) with a labelled stepper (`aria-current="step"`), built on the existing `PlanPreview.tsx`/`ConfirmLaunch.tsx`.
   - Back keeps the form state.
   - When `onPreview` is absent, or rejects with an error whose message or code contains `PREVIEW_UNAVAILABLE`/501, show "This hub can't preview yet: Starling will plan when you launch" and allow skipping.
   - Overlap report + estimates use the existing `overlapReport`/`estimatePlanCostUsd`/`estimateMinutes`.
4. **Validation** (`form.ts`, additive):
   - `repoPathError`: non-empty, ≤ 300 chars, no `..` segments, no shell metacharacters ``; | & $ ` < >``, no newline.
   - Goal ≤ 4,000 chars.
   - Optional `capacity?: number` prop: warn (don't block) when `maxParallel` exceeds the flock's total sessions.
   - Budget `0` forces dry-run on, with an explanation.
   - On submit, focus moves to the first invalid field. Errors use the existing `aria-invalid`/`aria-describedby` pattern.
5. **Recent goals** (`recent-goals.ts`): the last 8 launched goals per repo in localStorage `starling.recentGoals` (schema guard, try/catch, dedupe by trimmed text, newest first, clear button), shown as a "Recent" chip row above the templates.
6. **Container + manifest** so C3 needs one line:
   - `launch/api.ts` (local tiny client; `apps/web/src/data` is off-limits): `postRun(input, opts)` → `POST /api/runs` (body: `goal`, `repoPath`, `dryRun`, `maxParallel`, `budgetUsd`) and `postPreview(input, opts)` → `POST /api/runs/preview` (501 → `PREVIEW_UNAVAILABLE`). Both accept `fetchImpl`, `headers` (for Epic 110's optional token) and `signal`.
   - `LaunchContainer(props: FeatureProps & { fetchImpl?: typeof fetch; headers?: Record<string, string> })` derives `runs = sortedRuns(state)`, `recentRepos` (unique `goal.repoPath`, newest first, plus `DEMO_REPO_PATH`), and `onOpenRun = onSelectRun`.
   - Export `feature = { id: 'launch', title: 'Launch a run', description: 'Pick a goal, preview the plan, launch the flock', kind: 'overlay', icon: 'Rocket', hotkey: undefined, Component: LaunchContainer } as const` from `index.ts`, with `FeatureProps` = `{ state: SkyState; onSelectTask?(key: string): void; onSelectRun?(runId: string): void; onClose?(): void }` (the Wave 3 manifest shape Epic 112's registry accepts; declare it locally).
7. **Tests (≥ 30 new)**: template lookup + drift, every validation rule, the 3-step flow incl. a preview that's unavailable or rejected, recent goals with throwing storage, `api.ts` with a mocked `fetchImpl` (status codes, 501, network error), the container's derived props, and manifest shape.

## Explicitly out of scope
- The server routes `POST /api/runs/preview` and budget plumbing (Epic 110), the data client (Wave 3b, Epic 204), shell mounting/routing and `?playground=launch` (Epic 112 + C3), storing the token in settings (Epic 118).
- Don't add `examples/birdwatch-api` goals (Epic 168 isn't merged).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/launch` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/launch` clean.
4. Playground `/src/features/launch/playground.html`: walk py-ledger · bug-hunt through Goal → Preview → Launch and commit 1 PNG ≤ 300 KB of the preview step to `features/launch/__screens__/`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-136-web-launch-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/136-web-launch-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/136-web-launch-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
