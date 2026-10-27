## Epic 115 Handback — Web: lanes map (who owns which files)

**Status:** Complete. Branch `epic/115-web-lanes` @ TBD.

**Delivered:**
- `apps/web/src/features/lanes/derive.ts` — `buildLaneTree` / `buildLaneModel`, `globTarget`, `laneOverlaps`, `laneOverlapIssues`, `laneRows`, `formatLaneSummary`, `primaryLaneOwner`; lane globs → nested `LaneNode` tree, touched aggregation from `agentLog`/`diffs`/structural `task.diff`, conflict and violation flags, deterministic plan-order ownership.
- `apps/web/src/features/lanes/squarify.ts` — pure squarified-treemap `squarify(nodes, rect): Tile[]` + `tileArea`; proportional areas, no overlaps, deterministic order.
- `apps/web/src/features/lanes/layout.ts` — nested directory frames (`layoutLanes`, `layoutLaneTree`) and geometric arrow navigation (`nearestTile`).
- `apps/web/src/features/lanes/LanesView.tsx` — SVG treemap, legend, summary strip, overlap hatch, red conflict/violation outlines, selected-task highlight/dimming, roving-tabindex tiles with Enter/Space selection, map/list toggle, empty state.
- `apps/web/src/features/lanes/LaneTable.tsx` — accessible table twin (path, owner, readers, touched lines, flags) with `laneFlags`.
- `apps/web/src/features/lanes/palette.ts` — deterministic `--color-irid-*` palette and task-title lookup.
- `apps/web/src/features/lanes/index.ts` — `FEATURE = 'lanes'` and the L39 manifest (`id: 'lanes'`, `kind: 'view'`, `icon: 'LayoutGrid'`, `hotkey: 'l'`).
- `apps/web/src/features/lanes/Playground.tsx` + `playground.html` + `playground-main.tsx` — event-index slider over the recorded launch-day run plus a hand-made overlap/conflict scenario.
- `apps/web/src/features/lanes/test-fixtures.ts` — three-lane fixture with `theme`/`search` both owning `src/ui/**`, a shared edit, a conflicted merge, an auditor lane violation; summary `3 lanes · 1 overlap · 5 files touched · 1 conflict`.
- Tests: `derive.test.ts` (24 tests), `squarify.test.ts` (12 tests including layout/arrow navigation), `LanesView.test.tsx` (15 tests). 51 total, including the DoD end-state summary assertion.

**Key design decisions:**
- **Hatch on direct claims, not inherited ownership** — `src/` is every task's parent, so hatching aggregated owners would paint most of the repo. A node is `overlap` when two tasks explicitly claim that exact path or two agents edit the same file; `owners` still aggregates for colour/dimming/table.
- **Editing task is a de-facto owner** — a touched path outside every lane still gets a colour and any declared lane owner is added via `matchesGlob`; violation styling marks the ownership as suspect rather than leaving grey orphans.
- **Run-scoped conflicts, with a cap fallback** — `merge.result` events are filtered by active run; only if the event log has none do we fall back to `state.merges` (not run-scoped) filtered by plan task keys.
- **Weight fallback order exactly as specified** — touched lines, else 1 per file, else 1 per lane glob, so a fresh plan draws before any work.
- **Table is a first-class mode**, not a fallback; the treemap is unreadable for copying paths.
- **No document key handler** — the shell owns `l`; arrows/Enter/Space only act while a tile has focus.
- **Additive `LaneNode.kind` / `LaneNode.overlap`** — required fields unchanged; extras let the nested SVG and list avoid a second derivation pass.

**Verification (exact commands + results):**
- `bun install` (worktree root): `Checked 172 installs across 225 packages (no changes)`; `git status --short bun.lock package.json apps/web/package.json` printed nothing.
- `cd apps/web && bun test src/features/lanes`: `51 pass · 0 fail · 145 expect() calls`, 3 files.
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/lanes`: `Checked 15 files … No fixes applied`.
- `bash .orchestrator/bin/heavy.sh bun run test` (root): packages `1938 pass · 4 skip · 0 fail` (1942 tests / 223 files); web `632 pass · 0 fail` (63 files).
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 991 files … No fixes applied`; the per-workspace `tsc --noEmit` loop printed no errors and exited 0.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. The view reads `SkyState`, `PlanIssue`, `TaskSpec`, `MergeResult` and `AgentEvent` from `@starling/core/browser`; no core shape was missing. Optional `LaneNode` extras are local to this feature.

**Carryover done:** none — no request in `.orchestrator/fix-requests-w2.md` targets `apps/web/src/features/lanes/**`. (Requests aimed at `apps/web/src/app/`, `apps/web/src/data/` or core belong to Wave 3b/Epic 40 and were not touched.)

**C3 wiring (exact code C3 must add):**
1. **Feature registry** (Epic 112 registry; path per that epic) — one import and one array entry:
   ```ts
   import { feature as lanes } from '../features/lanes';
   // register alongside the other L39 manifests:
   export const FEATURES = [/* …existing… */, lanes];
   ```
   The registry's hotkey binder then makes `l` select it. No store access is needed: `feature.Component` takes `FeatureProps`.
2. **`apps/web/src/app/Layout.tsx`** — extend `CentreView` and render the centre view from the registry (or the one-line equivalent until the registry lands):
   ```tsx
   import { LanesView } from '../features/lanes';
   // CentreView = 'sky' | 'dag' | 'lanes'
   {view === 'lanes' ? (
     <LanesView state={state} onSelectTask={actions.selectTask} />
   ) : view === 'dag' ? (
     /* existing DAG branch */
   ) : (
     /* existing Sky branch */
   )}
   ```
3. **`apps/web/src/app/TopBar.tsx`** — add a centre-view tab if C3 keeps the explicit tab list:
   ```ts
   { id: 'lanes', label: 'Lanes', badge: <span aria-hidden="true"><Kbd size="sm">l</Kbd></span> }
   ```
4. **`apps/web/src/lib/route.ts`** — add `'lanes'` to `PLAYGROUNDS`; **`apps/web/src/app/PlaygroundHost.tsx`** — add the lazy branch:
   ```ts
   const LanesPlayground = lazy(() => import('../features/lanes/Playground'));
   // TITLES: lanes: 'Lanes'
   case 'lanes': return <LanesPlayground />;
   ```
   The standalone Vite page `src/features/lanes/playground.html` already works without any shell change.

**FIX REQUESTS:** none.

**Deliberately deferred / out of scope:**
- File-churn ranking / heatmap (Epic 125) and planner-side lane suggestions (Epic 107).
- Virtualised rendering for plans with thousands of files; current plans are 10–20 tasks.
- Screenshot/visual-regression tests; the pure layout invariants (area within 1%, no overlap, inside rect, deterministic) are the assertion layer.
- Playwright route coverage for the playground (`?playground=lanes`) — needs the C3 route entry above.

**Open questions / flagged tradeoffs:**
- **Double-counting touched lines.** The same file reported by both `file.edited` and a fetched diff is summed. Preferring one source would make the tile weight disagree with either the agent transcript or the committed diff; the touched-file count is unaffected. Worth a tie-break rule if a future epic wants exact churn here.
- **`state.verdicts` is task-keyed, not run-keyed.** Filtering by the active plan's task keys stops most cross-run bleed; a run-scoped verdict key is a core change, and Epic 125/auditor work may want to own it.
- **Agent-log cap.** Early edits can age out of the 500-event per-task transcript; `state.diffs` and `task.diff` cover the common case but not a full history. If the map becomes a post-mortem tool, read diffs for every task rather than the transcript.
- **Direct-claim hatch is a product call.** It shows real collisions without yellowing every shared directory; if a reviewer wants "any node with two owners is hatched", change one condition in `finalize()` and update the two overlap tests.
- **`nodeName` / `run.status` drift.** The view does not render node names or run status, so Epic 40's additive contract changes do not touch it; it also avoids exhaustive switches over `StarlingEvent['type']`.
