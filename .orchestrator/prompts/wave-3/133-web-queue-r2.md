# Epic 133: Web: merge queue round 2 (720p board, column widths, batch/bisect)

**Wave 3 · Branch `epic/133-web-queue-r2` · Issue: `gh issue list --search "Epic 133 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-133-web-queue-r2.md` and `.orchestrator/handbacks/133-web-queue-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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
- **e2e selector contract** (Epic 71 suite): `data-testid="queue-landed"` with text `7 of 7`, `[data-starling-queue] [data-column="wire"]` matching exactly one element per landed task, and `data-reduced-motion` on the section. All three must hold in **both** modes (compact wire chips keep `data-column="wire"`; don't render a task twice with that attribute).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 41 #4** (honour `selectedTask`): already done by Epic 55 (`aria-current`, column scroll in `MergeQueue.tsx`). Verify and list as done.
- **Epic 55 #1 / #2** (`TaskRun.nodeName`, `MergeQueueProps.selectedTask` in core): decline. Core is Wave 3b (Epic 202), and both are already read structurally here.
- **Epic 55 #3** (column widths: six equal `flex-1` columns, five empty ones take five sixths): deliverable 2.
- **Epic 71 #3** (at 1280×720 the board scrolls horizontally and shows only one "On the wire" card): deliverable 3. The component side is yours; the strip height is Epic 112's.

## Your lane (you may write ONLY here)
`apps/web/src/features/queue/**`
plus `docs/epic-133-web-queue-r2.md` and `.orchestrator/handbacks/133-web-queue-r2.md`. Read anything.

## Goal
"7 of 7 on the wire" is the run's headline, but on a 1280×720 projector the queue board scrolls sideways and shows exactly one wire card (Epic 71), while five mostly empty columns take five sixths of the width (Epic 55). Round 2 makes the board show what matters at any size. Occupied columns grow, and below a width threshold a compact, wire-first board shows every landed task at once. It also gets ready for Epic 104's batched merges: a batch is bracketed on the wire, and when a batch breaks the suite the bisect visibly halves its way to the culprit.

## Deliverables
1. **Carryover** (below): verify and record that `selectedTask` is done, then do column widths and the compact board.
2. **Column weights (pure)**: `columnWeights(board: QueueBoard): Record<QueueColumnId, { grow: number; collapsed: boolean }>`.
   - Empty columns collapse to a slim header (about 3.5 rem: icon + count, with a vertical or abbreviated label).
   - Occupied columns grow ∝ `sqrt(cards)` (min 7 rem), and `wire` gets at least 1.5× the largest other weight once it has cards.
   - Apply it via inline `flexGrow`/`flexBasis` on the column `<section>` (today `flex-1 min-w-[7rem]`, `MergeQueue.tsx:187`). Width transitions are 0 ms under reduced motion.
3. **Compact board**:
   - Pure `boardMode(widthPx: number, compact: 'auto' | 'always' | 'never'): 'full' | 'compact'` with `COMPACT_BELOW_PX = 840`, plus `useBoardWidth(ref)` (ResizeObserver; fall back to `window.innerWidth` when RO is missing, e.g. happy-dom).
   - Compact layout: "On the wire" is a wrapping chip grid (`#3 dark-mode`), with all 7 chips visible in the shell's 12 rem strip at 1280×720. The other stages collapse into one summary row ("2 flying · 1 auditing · 1 landing · 1 grounded"), where each segment is a button that expands that stage's list in place.
   - Additive prop `compact?: 'auto' | 'always' | 'never'` in `queue/types.ts` (default `'auto'`).
4. **Batch/bisect visualisation** (Epic 104 adds batched merges + regression bisect in parallel; don't wait for it):
   - Code against a local, feature-detected shape: `type MergeResultExtras = { batchId?: string; batchSize?: number; bisect?: { step: number; steps: number; suspects: string[]; culprit?: string } }` read structurally from each `MergeResult`.
   - Pure `batchGroups(wire: WireEntry[], merges: MergeResult[]): BatchGroup[]` and `bisectView(merges: MergeResult[]): BisectView | undefined`.
   - Render: consecutive wire cards of one batch get a bracket with "batch ×4". While a bisect is in progress, a strip above the wire shows the suspects as chips and "step 2 of 3 · 2 suspects", and highlights the culprit, which lands in Grounded with a "regression culprit" reason.
   - Put the exact shape in the handback as a CONTRACT note to Epics 104/202 so the producer matches it, or C3 maps it.
5. **Grounded reasons**: a reason chip (conflict / tests failed / regression), keeping the `title` + sr-only detail (Epic 26).
6. **Keep working**: virtualisation (`window.ts`, more than 30 cards) in both modes, `selectedTask` highlight + `aria-current` in chips, and the slide-in animation (off under reduced motion).
7. **Playground**: a width slider (720p strip / 1080p strip / phone), and a synthetic 12-task scenario with a 4-task batch and a 3-step bisect.
8. **Tests (≥ 30 new)**: weights (all empty, one column, wire-heavy), `boardMode` thresholds, compact rendering in happy-dom with `compact="always"` (every wire task visible as a chip, summary counts), batch grouping and bisect view (missing fields → no UI), `selectedTask` in compact mode.

## Explicitly out of scope
- The strip's height and the shell grid (`Layout.tsx` `h-48` footer) belong to Epic 112. Mention the 720p strip-height part of Epic 71 #3 there as a FIX REQUEST if you need more room.
- The merger itself (Epic 104); core `MergeResult`/`TaskRun`/`MergeQueueProps` fields (Wave 3b, Epic 202).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/queue src/features/metrics/legibility.test.ts` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/queue` clean.
4. Run the existing e2e queue checks through the gate: `bash .orchestrator/bin/heavy.sh bun run --cwd apps/web e2e -- replay.pw.ts shell.pw.ts` → pass, and commit 2 PNGs ≤ 300 KB (1280×720 compact board with 7 wire chips; batch/bisect scenario) to `features/queue/__screens__/`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-133-web-queue-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/133-web-queue-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/133-web-queue-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
