# Epic 135: Web: flock panel round 3 (join polish, perch drill-down, drain/remove, offline)

**Wave 3 · Branch `epic/135-web-flock-r3` · Issue: `gh issue list --search "Epic 135 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-135-web-flock-r3.md` and `.orchestrator/handbacks/135-web-flock-r3.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Legibility floor is enforced across lanes.** `apps/web/src/features/metrics/legibility.test.ts` (Epic 55, metrics lane) scans every non-test `.ts/.tsx` in `dag`, `agents`, `queue`, `metrics` and `flock`: no `text-[<12px]`, no `text-[13px]`, no `text-slate-500`…`900` (or gray/zinc/neutral/stone), no shell `text-micro`/`text-caption` tokens. New code in those folders must pass it; run it with your own tests (`cd apps/web && bun test src/features/metrics/legibility.test.ts`).
- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback.
- **The shell styles your DOM.** `Layout.tsx` restyles the panel through `[data-testid='compact-flock']`, `[data-testid='roost-card'] h3` and `section>div.grid`, and e2e reads `flock-panel`, `flock-summary`, `roost-card` and `data-reduced-motion` on roost cards. Keep those hooks and that structure.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/features/flock/**`
plus `docs/epic-135-web-flock-r3.md` and `.orchestrator/handbacks/135-web-flock-r3.md`. Read anything.

## Goal
Inviting a second laptop on stage is the demo's riskiest 20 seconds. Round 3 makes the join card impossible to fumble:
- copy buttons for every piece;
- a big scannable QR;
- an expiry countdown (when the hub provides one);
- a visible "MacBook Air joined" moment.

It also gives the operator real control: drill into one perch (hardware, models, latency, its tasks and recent events), drain it or remove it before closing the lid, and see clearly when a perch has gone away and where its tasks went. The panel only emits callbacks; the server and perch sides are built in parallel (Epics 102/110) and wired at C3.

## Deliverables
1. **Join polish** (`JoinCard.tsx`, `QrCode.tsx`, `CopyButton.tsx`, `use-copy.ts`):
   - Separate copy buttons for the command, the code and the hub URL, each with "Copied ✓" and an `aria-live` confirmation.
   - Clicking the QR enlarges it in a dialog (portal, Esc closes, focus returns).
   - Countdown: feature-detect an additive `join.expiresAt?: number` (epoch ms; not in core yet) → "expires in 4:32"; expired → greyed with "ask the hub for a new code"; absent → no countdown.
2. **Join moment**: while only the hub is online, a calm "Waiting for a perch…" pulse (static under reduced motion). When a new node id appears (reuse `use-presence.ts`/`use-entered.ts`), that roost shows "MacBook Air joined the flock" for 5 s.
3. **Per-perch drill-down**: Enter or click on a `RoostCard` opens `PerchDetail` (inline expansion in card mode, the existing portalled "All roosts" sheet in compact mode). It shows:
   - hardware (`formatHardwareParts`), models, sessions meter, latency, last seen;
   - tasks on that node grouped by status (chips → `onSelectTask`);
   - recent node events (`node.joined/left/stats` and `task.migrated` from/to it), which needs the additive extra `events?: readonly StarlingEvent[]` (C3 passes `state.events`). Without it the section hides.
4. **Drain/remove callbacks**: additive `onDrainNode?(nodeId: string): void | Promise<void>` and `onRemoveNode?(nodeId: string): void | Promise<void>` in `FlockPanelExtras`.
   - Buttons render only when the callback exists, and never for the hub.
   - Remove needs an inline confirm ("Remove MacBook Air? Its running tasks move to other roosts.").
   - While pending: a spinner and disabled state. On rejection: an inline error.
   - "Draining" badge: from local pending state, or a feature-detected `draining?: boolean` on the node, until a `node.left` arrives.
5. **Offline state**:
   - Offline roosts are dimmed and sorted last (`sortRoosts`), with "away 12s" and the `node.left` reason when events are given.
   - Tasks that migrated away show "moved → MacBook Pro".
   - In the compact rail an offline node gets a red ring + sr-only "offline".
   - The compact rail's bare task-count badge (Epic 55 deferred) gets the accessible name "5 tasks".
6. **Playground** scenarios: join → busy → drain → remove → rejoin, plus an expired code. Buttons drive local state.
7. **Tests (≥ 30 new)**: countdown with fake timers (absent, ticking, expired), copy fallbacks, QR dialog focus, drill-down content with/without `events`, callbacks absent/present/rejecting, hub never removable, offline sorting + migration hints, compact accessible names.

## Explicitly out of scope
- Perch drain and the server endpoints (Epics 102/110). The topology view (Epic 128) and Sky roosts (Epic 130).
- `JoinInfo.expiresAt` or a `draining` node status in core: Wave 3b CONTRACT REQUESTS, not edits.
- Shell wiring of the callbacks (C3).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/flock src/features/metrics/legibility.test.ts` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/flock` clean.
4. Commit 2 PNGs ≤ 300 KB (join card with countdown; perch drill-down with drain/remove) from the Playground (`?playground=flock` or the feature's own page) to `features/flock/__screens__/`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-135-web-flock-r3.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/135-web-flock-r3.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/135-web-flock-r3`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
