# Epic 169: sky-todo round 3: big-day, conflict-storm and fix-loop goals

**Wave 3 · Branch `epic/169-sky-todo-r3` · Issue: `gh issue list --search "Epic 169 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-169-sky-todo-r3.md` and `.orchestrator/handbacks/169-sky-todo-r3.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **D1 examples rules (Epics 168–171 run in parallel).**
  - Demo targets are **standalone projects**. Root `bun run test`, Biome and the root `tsc` loop all skip `examples/`, so you run your target's own suite yourself.
  - **Root test filter gotcha:** root `bun test packages apps/server apps/cli skills integrations tools evals` treats each word as a *substring filter*, not a directory. Any `*.test.ts` whose path contains `packages`, `apps/server`, `apps/cli`, `skills`, `integrations`, `tools` or `evals` (e.g. `examples/x/src/tools/a.test.ts`) gets pulled into the root suite. Never name a folder or test file like that.
  - **Frozen for other code:** the existing goal file names *and texts* (`apps/web/src/features/launch/goals.ts` copies them verbatim, and `fixtures/runs/*` plus Epic 40's `fixtures/real/*` recorded them), and the `make-demo-repo.sh` CLI (`make-demo-repo.sh /tmp/x`, `<example> [dir]`, `--list`, `--help`, `DEMO_SKIP_INSTALL`, `DEMO_SKIP_TESTS`, `SKY_TODO_SKIP_INSTALL`, `PY_LEDGER_SKIP_INSTALL`, last stdout line = absolute repo path). Epic 40, `tools/github-sandbox/setup.sh` and the docs all call it.
  - **Planner-evals coupling:** `evals/planner/cases.test.ts` asserts the number of sky-todo planner cases equals the number of `examples/sky-todo/demo-goals/*.expected.md` files. So a **new sky-todo answer key goes in `examples/sky-todo/.starling-answers/<goal>.expected.md`**, never in `demo-goals/`. Other targets aren't coupled yet.
  - **`examples/sky-todo/node_modules` breaks the root suite:** `packages/repomap/src/sky-todo.test.ts` `cp -r`s the folder and times out at 5 s. Test sky-todo through a demo copy (`bash examples/scripts/make-demo-repo.sh sky-todo /tmp/<x>`). If you do install in place, `rm -rf examples/sky-todo/node_modules` before any root run.
  - **Answer-key format v1** (what the existing `*.expected.md` use, and what Epic 171's validator parses): H1 `# Expected decomposition — <goal>`, a bold `**Goal (N tasks).**` sentence, a `## Task table` with columns `| # | key | title | depends on | lane owns |` (keys and globs in backticks, comma-separated; `—` for no dependency), and a line `Expected validator output: **no issues**` or one naming the expected issue codes (e.g. `lane-overlap`). Then `## Why the lanes are disjoint` and per-task details. Keep this format exactly.
- **Epic 171** (validator) parses your answer keys from both `demo-goals/` and `.starling-answers/` using format v1. Run its validator if it has landed on `origin/main`; otherwise eyeball the format against `launch-day.expected.md`.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **From 58-demo-targets, FIX REQUEST 1** (the `stage` answer key should move back to `demo-goals/` once `evals/planner` has a `sky-todo-stage` case): **decline here**. The move is only safe in the same merge as the eval case (Epic 161's lane), and nobody can order two parallel branches. Keep it in `.starling-answers/`. C3 note for the handback: "if Epic 161 added `sky-todo-stage`, run `git mv examples/sky-todo/.starling-answers/stage.expected.md examples/sky-todo/demo-goals/` and drop its 'Where this file lives' note".
- **From 58, FIX REQUEST 2** (`packages/repomap/src/sky-todo.test.ts` copies `node_modules`): not your lane (Epic 108). Mitigate as the D1 rules say, and mention it in the handback if you hit it.

## Your lane (you may write ONLY here)
`examples/sky-todo/**`
plus `docs/epic-169-sky-todo-r3.md` and `.orchestrator/handbacks/169-sky-todo-r3.md`. Read anything.

## Goal
sky-todo is the main stage app, and Wave 3 wants three new demo moments from it: a **12-task "big day"** that fills two laptops' worth of birds, a **conflict-heavy** goal that shows the lane validator, `merge-tree` prediction and the resolver doing real work, and a **fix-loop** goal that reliably fails audit once and passes on retry. Great looks like this: each goal is a single sentence a judge can read aloud, the answer keys are precise enough to grade a planner, the app affords every task without edits to shared files, and nothing that other code depends on moves.

## Deliverables
1. **Read first:** `examples/sky-todo/README.md`, `src/features/README.md` (the reserved-folder table), the five `demo-goals/*.expected.md`, `.starling-answers/stage.expected.md` and `BUGS.md`, plus Epic 40's notes on how the real planner split launch-day into 6 tasks (`git show epic/40-integration-captain:docs/epic-40-integration-captain.md`, "Deviations"). That tells you how a real model groups items.
2. **`demo-goals/big-day.md`** (12 tasks). Use the 12 reserved folders that already exist (`due-dates export help search shortcuts stats tag-count tags theme title-count today undo`) or swap in up to four new reserved folders, each with a `.gitkeep` and a row in the `src/features/README.md` table (e.g. `priority/`, `archive/`, `pin/`, `markdown/`). Requirements: ≥ 9 tasks ready at t0, ≤ 3 DAG edges, every lane a `src/features/<x>/**` folder, no task touching `src/ui/render.ts` or `src/main.ts`. Answer key: `.starling-answers/big-day.expected.md`.
3. **`demo-goals/conflict-storm.md`**: 3 tasks that genuinely must edit the same files (`src/ui/render.ts` footer plus `src/ui/styles.css`), e.g. a sort toggle, a "Delete done" button and an item-density switch. The answer key states the expected validator output (`lane-overlap` on which task pairs), which merges `git merge-tree` should predict to conflict, and what a correct resolver merge looks like (the final footer markup). It complements the 2-task `conflict-bait`, which stays untouched. Answer key: `.starling-answers/conflict-storm.expected.md`.
4. **`demo-goals/fix-loop.md`**: 1–2 tasks whose first attempt predictably misses a mechanically checkable item. Example: "Add undo/redo with tests for: redo is cleared after a new edit, undoing a delete restores the item at its old position, and history is capped at 50 steps". The answer key documents attempt 1 (the likely miss), the auditor's expected `dod` item that fails, the fixer instruction it should produce, and attempt 2. Answer key: `.starling-answers/fix-loop.expected.md`.
5. **Affordances.** If a new goal needs a hook the app lacks (a new slot, command or filter), add it **additively** to `src/ui/slots.ts`, `src/lib/commands.ts` or `src/ui/filters.ts` with tests. Keep every existing export, slot id and command name (the recordings and the repo-map fixture rely on them).
6. **Keep `stage` where it is:** `stage.expected.md` stays in `.starling-answers/` (see carryover). Re-check that all existing goals and answer keys still describe the code accurately, and fix stale facts in the keys, the README or `BUGS.md` without renaming anything or changing goal texts.
7. **One guard test** inside the app, `src/features/reserved.test.ts`: every folder listed in the `src/features/README.md` reserved table exists, and every folder under `src/features/` is either listed or a real feature (has `index.ts`). It runs in demo copies too, so it must not read `.starling-answers/` or `demo-goals/`.
8. **README:** the goals table now has all 9 goals (tasks, rough minutes, what each demonstrates, which laptop count). Add a "Which goal for which demo?" table (smoke, 3-minute stage, flock big-day, conflicts, audit retry). Mark the minute estimates as sizing estimates (no real runs in this wave).
9. **Hand the goal texts to C3:** list the exact text of the three new goals in the handback so Epic 136/C3 can add them as launch-form chips.

## Explicitly out of scope
- Moving `stage.expected.md` or adding any `*.expected.md` to `demo-goals/` (breaks `evals/planner/cases.test.ts`, Epic 161's lane).
- `examples/scripts/**` and `examples/README.md` (Epic 171), `evals/**`, `fixtures/**`, `apps/web/src/features/launch/**` (Epic 136).
- Implementing any demo feature (that's Starling's live work). Real Starling runs.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bash examples/scripts/make-demo-repo.sh sky-todo /tmp/st-169 && cd /tmp/st-169 && bunx tsc --noEmit` → the script reports `0 fail`, tsc is clean, and `ls demo-goals` shows the 3 new goals with no `*.expected.md` and no `.starling-answers/` (paste).
3. `bun test evals/planner packages/repomap/src/sky-todo.test.ts` at the repo root → 0 fail (proves the answer-key placement and repo-map floors still hold). Make sure `examples/sky-todo/node_modules` doesn't exist first.
4. `git diff origin/main --stat -- examples/sky-todo/demo-goals` shows only **added** files (no existing goal changed).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-169-sky-todo-r3.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/169-sky-todo-r3.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/169-sky-todo-r3`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
