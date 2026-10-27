# Epic 34 (Checkpoint C1-b): Wire the dashboard together

**Checkpoint C1 · Branch `epic/34-c1-web-wiring` · No GitHub issue (it's a checkpoint epic, so skip `Closes #`) · Model: DeepSeek V4.1 Flash · Budget: 45–90 min**

## Where you are
Starling's Wave 1 is merged into `main` (read `.orchestrator/PRD.md` §2 item 7 and §7 for what the dashboard must do on demo day). The dashboard was built as **seven parallel pieces**:
- **Epic 23 shell**: `apps/web/src/{app,data,components,lib}`. Layout with regions, a zustand store, a pure reducer, SSE, demo mode, and **prop selectors** (`skyProps`, `dagProps`, `drawerProps`, `queueProps`, `metricsProps`, `flockProps`) in `src/data/selectors.ts`. Every region currently renders a `<RegionPlaceholder>` with a `// WIRED AT C1:` comment.
- **Feature components** (props-only, ARCHITECTURE §8): `features/sky` → `SkyView` (Epic 24), `features/dag` → `DagView` and `features/agents` → `AgentDrawer` (Epic 25), `features/queue` → `MergeQueue` and `features/metrics` → `MetricsPanel` (Epic 26), and `features/flock` → `FlockPanel` (Epic 32).

Read the six handbacks in `.orchestrator/handbacks/23-*.md` … `32-*.md` and the epic docs in `docs/` for each piece's exports and quirks before you start.

A sibling checkpoint epic (**33, core consolidation**) runs **in parallel**. It owns root config, `packages/**`, `apps/server`, `apps/cli`, and **every `handshake.ts` file** (including the ones under `apps/web`). Don't touch those. Keep importing types from the existing local `handshake.ts` files; Epic 33 turns them into re-exports of core without changing their names.

## Tech decisions already locked
ARCHITECTURE §7 L1–L25 and §8. L11: React 19 + Vite + Tailwind v4 + zustand + @xyflow/react + dagre, with the Sky on Canvas 2D. **Never import runtime values from `@starling/core`'s root in browser code** (it pulls in `node:fs`). Type-only imports are fine. L23: no real LLM, opencode or GitHub calls.

## FIRST TASK: carryover from the Wave 1 handbacks
1. **One status palette.** Epics 24, 25, 26 and 32 each shipped a *local fallback palette* until the shell's `STATUS_COLORS` (`src/lib/status.ts`) existed. Switch every feature to the shell's palette and delete the fallbacks, so all panels show identical colours per `TaskStatus`. If a feature needs a token the shell lacks, add it to `src/lib/status.ts` (your lane).
2. **Node names, not ids.** Epic 25 notes the DAG/drawer badge shows `run.nodeId` because `NodeInfo` isn't in its props. In the selectors, map `nodeId → NodeInfo.name` when building `dagProps`, `drawerProps` and `queueProps` (the feature prop types allow `TaskRun` objects; use a derived display field the components already render, or extend the selector output without changing the prop *types*. If a type change is truly unavoidable, note it as a CONTRACT REQUEST instead).
3. **Flock selection.** `FlockPanelProps` is getting an optional `onSelectTask` from Epic 33. Wire the panel's task chips to `selectTask` in a way that compiles **both** before and after that lands (e.g. spread an object typed with an optional field).
4. **Audit durations and DoD.** Epic 33 adds optional `AuditCheck.durationMs` and `AuditVerdict.dod`. Make the agent drawer read them **if present** (feature-detect with `in`/optional chaining), and fall back to the current behaviour.
5. **Metrics liveness.** Pass `live: run.status === 'running'` into `MetricsPanel` once the prop exists. Until then, keep it compiling via an optional spread, the same way as item 3.

## Deliverables
6. **Wire every region** in `src/app/Layout.tsx`: replace each `RegionPlaceholder` with its feature component fed by its selector, exactly as the `WIRED AT C1` comments say:
   - sky → `SkyView`; dag → `DagView`; drawer → `AgentDrawer` (open when `selectedTask`, close → `selectTask(undefined)`); bottom strip → `MergeQueue` + `MetricsPanel`; flock region → `FlockPanel` (compact when the region is narrow).
   - Keep `RegionPlaceholder` only as an error-boundary fallback: wrap each region in an **error boundary**, so one crashing panel can't blank the dashboard on stage.
   - Selecting a task anywhere (Sky click, DAG click, queue card, flock chip) opens the drawer, and the selection is highlighted in every view.
7. **Layout polish for the projector.** Usable at **1280×720** and great at 1920×1080:
   - Sky gets the most space.
   - A view toggle in the top bar: **Sky** (default) vs **DAG** in the centre region, keyboard `1`/`2`.
   - The bottom strip is collapsible.
   - `?` opens a small keyboard-help overlay.
   - Respect `prefers-reduced-motion` globally.
8. **Dev playgrounds route.** A `?playground=sky|dag|agents|queue|metrics|flock` URL param renders that feature's existing `Playground.tsx` full-screen, so each piece can be shown on its own (and serves as a demo backup).
9. **Demo-mode smoke.** With `?demo=1`, the fixture run must play end to end with every panel live. Verify it with a test that drives the store through the full fixture (use the existing demo controller with fake timers or `ingestMany`) and then renders `Layout`:
   - all six components mount without throwing;
   - the Sky receives 7 tasks and 2 nodes;
   - the queue shows 7 on the wire at the end;
   - the metrics panel shows non-zero API cost and local calls;
   - selecting `t03-…` (whatever the fixture's CSV-export key is) opens the drawer with its verdict history.
10. **Production build.** `cd apps/web && bun run build` must succeed with **no `node:` externalisation warnings**. If any feature imports a runtime value from `@starling/core`, replace it with a local pure helper inside your lane or the feature's own folder (feature folders are yours *for this fix only*), and note it for Wave 2 to switch to `@starling/core/browser`.
11. **Screenshots.** If Playwright is available (`bunx playwright --version`; don't download browsers if it isn't, and say so), capture `docs/assets/c1-dashboard-1280.png` and `-1920.png` from `bun run dev` + `?demo=1` near the end of the replay (≤ 400 KB each). Otherwise describe the final layout precisely in your doc.

## Your lane (you may write ONLY here)
`apps/web/src/{app,data,components,lib}/**` (excluding `apps/web/src/data/handshake.ts`), `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/index.html`. Inside `apps/web/src/features/*/`, only the palette swap (item 1), node-name display (item 2), drawer optional fields (item 4) and runtime-import fixes (item 10), never their `handshake.ts`. Plus `docs/assets/c1-*`, `docs/epic-34-c1-web-wiring.md` and `.orchestrator/handbacks/34-c1-web-wiring.md`.

## Explicitly out of scope
Real backend wiring (Wave 2, Epic 41). New features (launch form, sound, stats page). Any `packages/**`, root config or `handshake.ts` change (Epic 33).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean.
2. `cd apps/web && bun test` → 0 fail (paste the summary), including the new end-to-end demo smoke test.
3. `cd apps/web && bun run build` → success, with no `node:` warnings (paste the tail).
4. For each `apps/web` workspace file you touched, `bunx biome check <your paths>` is clean, and `bunx tsc --noEmit -p apps/web/tsconfig.json` is clean.
5. Doc + handback written. PR opened (`gh pr create --base main --title "epic(34): C1 web wiring" --body-file …`). Print the PR URL last.

## Git
Branch `epic/34-c1-web-wiring`. Conventional Commits (`feat(web): wire sky region`, `refactor(web): one status palette`, …), at least 8 commits. Rebase on `origin/main` before pushing. No merging, no tags.
