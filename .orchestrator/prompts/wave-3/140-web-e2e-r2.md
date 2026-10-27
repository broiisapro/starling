# Epic 140: Web: Playwright round 2

**Wave 3 · Branch `epic/140-web-e2e-r2` · Issue: `gh issue list --search "Epic 140 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-140-web-e2e-r2.md` and `.orchestrator/handbacks/140-web-e2e-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Playwright is heavy**: always run it through the gate, e.g. `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e -- keyboard.pw.ts` while iterating. Chromium is already installed on this laptop (`bunx playwright install chromium` is a no-op); never `--with-deps`.
- It's not part of `bun run test` (files are `*.pw.ts`) and that stays true. `playwright.config.ts` and `apps/web/tsconfig.json` are outside your lane.
- Write selectors against `main`'s current DOM using roles, labels and the testids in the contract table. Siblings 112 and 130–137 are changing markup, so prefer roles over structure.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 71 #2 (typecheck)**: `bun run check` doesn't typecheck `e2e/` because `apps/web/tsconfig.json` only includes `src/**`, and that file is in no Wave 3 lane. Add `apps/web/e2e/tsconfig.json` (extends `../tsconfig.json`, `include: ["./**/*.ts", "../playwright.config.ts"]`) and make it pass. Add a FIX REQUEST for the root `typecheck` loop / Epic 150 to run `tsc -p apps/web/e2e`.
- **Epic 71 #2 (CI job, Linux baselines)**: decline. That's Epic 150 (`.github/workflows`), plus a FIX REQUEST for any `playwright.config.ts` change (e.g. a per-platform `snapshotPathTemplate`).
- **Epic 71 #1** (Sky tooltip testid + freeze hook): Epic 130 is doing it in parallel. Feature-detect it (deliverable 10).
- **Epic 71 deferred**: light-theme and `?playground=` coverage (deliverables 3 and 7).

## Your lane (you may write ONLY here)
`apps/web/e2e/**`
plus `docs/epic-140-web-e2e-r2.md` and `.orchestrator/handbacks/140-web-e2e-r2.md`. Read anything.

## Goal
Epic 71's 12 Playwright tests prove the demo boots, replays and clicks. Round 2 covers what a judge (or a nervous presenter) actually does:
- drive the dashboard with only a keyboard;
- flip to light theme;
- open the drawer from every entry point;
- fold and unfold the flock;
- fill the launch form;
- view it at 720p and 1080p with reduced motion.

The suite runs against demo mode with no server, so it's a pre-demo checklist anyone can run in two minutes. Bugs are recorded precisely, not "fixed" from this lane, and the README becomes the selector contract that the 15 web epics merging in parallel must keep.

## Deliverables
1. **Read first**: `playwright.config.ts` (Vite dev server on a per-worktree port, `*.pw.ts`, 1 worker, artifacts in `$TMPDIR`) and `e2e/support.ts` (`openReplay`, `openEndState` via the dev-only `__STARLING_SKY__` handle, `watchConsole`, `horizontalOverflow`, `wirePerchPoints`/`hoverBird`). Keep this model. Extend `support.ts` additively; existing helpers keep their signatures.
2. **`keyboard.pw.ts`**, from `openEndState`:
   - The first Tab reaches the "Skip to the sky" link, and Enter moves focus into `#region-sky`.
   - Tabbing through the top bar (run picker combobox "Active run", view toggle, speed tabs, help, theme) shows a visible focus indicator on each control (computed `outline-style`/`box-shadow` not none).
   - Opening a task's drawer with keyboard only works (Tab to a queue card, Enter). Arrow keys move between drawer tabs. Esc closes it, and focus isn't left on `<body>`.
3. **`theme.pw.ts`**: the theme toggle flips `html[data-theme]` and persists across reload (`starling.theme`). In the light-theme end state there's no `RegionPlaceholder`, and 10 key labels (top bar, queue header, metrics figures, roost names) have a computed contrast ≥ 4.5:1 against their effective background, computed in-page.
4. **`drawer.pw.ts`**: the drawer opens from a DAG node (`2`, click a node), from a queue card and from a Sky bird (`hoverBird`). All four tabs render content, the Audit tab shows verdict cards, ✕ closes, and the drawer region doesn't overlap the sky region's box at 1280×720.
5. **`flock.pw.ts`**: `f` folds and unfolds the rail. At 1280×720 the compact rail's "All roosts" sheet opens; Escape closes it and focus returns to its trigger (Epic 55 promise). At 1920×1080 both roost cards are visible, and clicking a task chip opens that task's drawer.
6. **`launch.pw.ts`**: the launch panel isn't in the shell yet, so test it at `/src/features/launch/playground.html`. A demo-goal chip fills the goal; an empty goal or a bad budget shows errors tied to their fields; the preview step renders the fixture plan; a confirmed launch adds the fake run to history. Use roles and labels only.
7. **`playgrounds.pw.ts`**: each `/?playground=sky|dag|agents|queue|metrics|flock` and each feature `playground.html`/`preview.html` that exists on main boots with zero console/page errors and a visible root.
8. **`viewports.pw.ts`**: the end state at 1280×720 and 1920×1080, dark and light. Check no page-level horizontal overflow, every region visible, and the smallest rendered font of visible text ≥ 12 px. **Screenshots are captures, not assertions**: write them to `e2e/__captures__/<name>.png` only when `STARLING_E2E_CAPTURE=1` (commit 4, each ≤ 300 KB). Don't add new `toHaveScreenshot` baselines; 15 web epics are changing pixels in parallel.
9. **Reduced motion** (extend `motion.pw.ts`): with `reducedMotion: 'reduce'`, there's no DAG status flash (`data-flash` or equivalent absent after a scrubbed status change), queue cards have no transform transition, and the flock pulse is static.
10. **Sky hooks**: Epic 130 is adding `data-testid="sky-tooltip"` and a freeze hook (`window.__STARLING_SKY_FREEZE__`) in parallel. Feature-detect them in `support.ts` (use them when present, else the current selectors). Don't wait.
11. **Bugs**: `test.fixme('BUG <area>: …', async () => { …real steps… })` (the Playwright equivalent of `test.todo`; never `test.fail`), plus a FIX REQUEST naming the owning Wave 3 epic.
12. **README**: the scenario list, capture mode, the typecheck command, and a **selector contract table** (every testid/role/label the suite depends on → owning lane).

## Explicitly out of scope
- The CI job, caching and per-platform snapshot directories: Epic 150 (`.github/workflows`), plus `playwright.config.ts` changes via FIX REQUEST.
- Fixing UI bugs. Testing unmerged Wave 3 features (stage, topology, health, …): list them in the README as "next round".
- Live-server or real-flock journeys.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bunx tsc --noEmit -p apps/web/e2e` clean (your new `e2e/tsconfig.json`), and `bunx biome check apps/web/e2e` clean.
3. `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e` → all pass (fixme allowed): the 12 existing tests + ≥ 20 new ones. Paste the summary line and the run time.
4. `STARLING_E2E_CAPTURE=1 bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e -- viewports.pw.ts` → 4 PNGs in `apps/web/e2e/__captures__/`, each ≤ 300 KB (paste `ls -l`).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-140-web-e2e-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/140-web-e2e-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/140-web-e2e-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
