## Epic 53 Handback — Web: launch a run + run history

**Status:** Complete. Branch `epic/53-web-launch` @ `86fedd3` (feature tip; the docs and this handback are on top).
**Delivered:**
- `apps/web/src/features/launch/LaunchPanel.tsx` — props-only launch screen: form, plan preview, confirm gate and run history in one responsive layout.
- `LaunchForm.tsx` — repo path with a `datalist` of recent repos, goal textarea with four sky-todo quick-pick chips (`launch-day`, `launch-day-xl`, `quick-wins`, `conflict-bait`), agents (`1…64`), budget (`0…1000`, 0 = plan only), dry-run toggle, `⌘/Ctrl+Enter` submit, per-field `aria-invalid`/`role="alert"` errors.
- `ConfirmLaunch.tsx` — inline confirm region with goal/repo/agents/budget/mode, estimated cost and time, budget-overrun warning, validator-error and lane-overlap warnings, dry-run notice, focus on the confirm button, Escape to cancel, launch errors in place.
- `PlanPreview.tsx` — task table (key/title, owned globs, dependencies, estimate), overlap badge (“Lanes clear” / “N lane overlaps” / “N plan errors”), validator issues, locked decisions, stale-input marker, loading/error/idle states with retry.
- `RunHistory.tsx` — newest-first run list with status pill, merged/failed counts, cost, duration, repo, relative start; whole row is a button that calls `onOpenRun(id)`; empty state.
- `types.ts` — `LaunchPanelProps`, `LaunchInput extends StartRunInput` (adds optional `budgetUsd`), `LaunchPreview`, `LaunchGoal`, form/preview state types. No changes outside the lane.
- `form.ts` — pure validation + `toLaunchInput` + `requestKey` + chip helpers; limits mirror `POST /api/runs`.
- `overlap.ts` — dependency-aware lane check: only concurrently runnable pairs are compared, using core’s conservative `globsOverlap`; validator issues are folded in.
- `estimate.ts` — documented cost/clock heuristics from `PRICING` (peak), per-task token profile, 1.35 retry factor, DAG depth/width.
- `history.ts` — pure run summaries (status label/tone, merged/failed, cost, duration; plan-authoritative task count).
- `goals.ts` — the four demo goals verbatim from `examples/sky-todo/demo-goals/`.
- `Playground.tsx` + `playground.html` + `playground-main.tsx` + `fixtures.ts` — fixture-driven playground (3 runs incl. conflict-bait, real expected lanes, fake engine, failure switches); a fixture launch prepends a `mapping` run to history.
- Tests (31): pure helpers (`launch-pure.test.ts`), panel interactions/validation/preview/overlap/error/history (`launch-panel.test.tsx`), playground fixture flows (`playground.test.tsx`).
- `docs/epic-53-web-launch.md` with the six required sections.

**Key design decisions:**
- Budget travels as `LaunchInput.budgetUsd`, a local superset of `StartRunInput`, so the deliverable’s prop signature still accepts a `(input: StartRunInput) => …` handler while the form can send the value. Editing `StartRunInput` is a CONTRACT REQUEST (below), not a lane edit.
- `onPreview` is optional and takes the same `LaunchInput` as `onLaunch`. No preview endpoint exists, so the panel degrades honestly (“Preview is not wired yet”) instead of fabricating a plan; launch still works.
- Overlap is recomputed locally for display (concurrent pairs only: a shared lane across a dependency edge is a hand-off), then unioned with the server’s `issues`. Core’s matcher keeps the semantics identical to the planner.
- The confirm gate shows a cost only for a **fresh** preview. Without a plan it says “preview to estimate”; a fake-precise number on stage is worse than an honest gap.
- Inline confirm, not a modal: keeps the form/preview visible, avoids a hand-rolled focus trap, focuses the confirm button, Escape cancels, and preserves typed input.
- Fixtures are typed literals mirroring `*.expected.md`, not the recorded JSONL: this panel starts runs rather than replays them, and literals are importable in tests and in a Vite production build (no root `?raw` specifier).
- UI tests use `@testing-library/react` with a lane-local `test-env.ts` (the precedent set by the agents/layout lanes); pure rules live in modules so most coverage needs no DOM.

**Verification (exact commands + results):**
- `bun install` (worktree root): `Checked 162 installs across 221 packages (no changes) [9.00ms]`.
- `bun run test` (root):
  - packages half: `1359 pass`, `4 skip`, `0 fail` — `Ran 1363 tests across 162 files. [17.90s]`
  - web half: `457 pass`, `0 fail` — `Ran 457 tests across 42 files. [2.61s]`
- `bun run check`: `Checked 724 files … No fixes applied` (Biome) and the per-workspace `tsc --noEmit` loop exited 0.
- `cd apps/web && bun run build`: `✓ 2412 modules transformed` / `✓ built in 584ms` (includes the new `@starling/core/browser` import; pre-existing 500 kB chunk warning unchanged).
- Feature tests: `cd apps/web && bun test src/features/launch` → `31 pass / 0 fail / 118 expect() calls` across `launch-pure.test.ts`, `launch-panel.test.tsx`, `playground.test.tsx`.
- Manual: the playground is a Vite page (`bun run dev:web`, open `/src/features/launch/playground.html`); it renders 3 fixture runs, previews 7/3/2 tasks for launch-day/quick-wins/conflict-bait, and the conflict fixture shows “1 lane overlap”.

**Dependencies added:** none.

**CONTRACT REQUESTS:**
1. `packages/core/src/handshake.ts` — add optional `budgetUsd?: number` to `StartRunInput`; then `apps/server` can accept it in `StartRunBodySchema` and `packages/engine` can override `config.budget.maxUsd` per run. Why: the launch form’s budget is currently advisory (the panel sends it, the shell can only drop it). Additive and optional, so no existing caller breaks. (Epic 40 owns core.)
2. `packages/core/src/handshake.ts` — add optional `preview?(input: StartRunInput): Promise<{ plan: Plan; issues: PlanIssue[] }>` to `EngineApi`. Why: the launch panel’s plan preview needs a way to get a plan without starting a persisted run; an optional method is non-breaking and lets the server return 501 while the engine catches up. (Epic 40 owns core; engine implementation is Epic 49.)

**FIX REQUESTS (lanes I do not own):**
1. **Epic 41 — shell wiring** (`apps/web/src/app/`): render `<LaunchPanel />` (e.g. a “Launch” region or sheet) with:
   - `runs={sortedRuns(state)}` from `data/selectors.ts`, `onOpenRun={(id) => skyActions.setActiveRun(id)}`;
   - `recentRepos` = unique `goal.repoPath` values across `sortedRuns(state)`, most recent first, plus `DEMO_REPO_PATH`; optionally persist locally under `starling.recentRepos`;
   - `goals={[...DEMO_GOALS]}` (re-exported from `features/launch`);
   - `onLaunch={(input) => fetch('/api/runs', {method:'POST', …}).then(r => r.json())}` — the body is `goal`, `repoPath`, `dryRun`, `maxParallel`, `budgetUsd`; after `{runId}` set the follow/active run so the Sky shows it;
   - `onPreview={(input) => postPreview(input)}` against the new endpoint below.
2. **Epic 41 — preview endpoint** (`apps/server/src/routes/runs.ts` + `apps/web/src/data/`): add `POST /api/runs/preview` accepting the same body as `POST /api/runs` and returning `{ plan, issues }` right before `start()` would merge→audit. Implementation options: call `EngineApi.preview` when present (CONTRACT REQUEST 2), else map the repo and call `Planner.plan` in a server-owned planner instance; never persist a run and never create a worktree. Return 501 with `{ error: 'PREVIEW_UNAVAILABLE' }` when neither is wired. Add a web client `previewRun(input)`.
3. **Epic 41 — budget plumbing**: accept `budgetUsd` in `StartRunBodySchema` and pass it to the engine once CONTRACT REQUEST 1 lands. Until then the UI must keep saying “cap” without enforcing it; ideally trim or hide the field if the server rejects it.
4. **Epic 41 — playground route**: add `'launch'` to `PLAYGROUNDS` in `apps/web/src/lib/route.ts` and a lazy `LaunchPlayground` branch (plus a `TITLES` entry) in `apps/web/src/app/PlaygroundHost.tsx`. The feature already ships `Playground.tsx` and `playground.html`.
5. **Epic 41 — initial repo**: read the last successful repo from the URL (`?repo=`) or localStorage and pass it first in `recentRepos`; the panel only starts from `recentRepos[0]`.

**Deliberately deferred / out of scope:**
- Server endpoints and the preview implementation (Epic 41; the panel only calls props).
- Shell wiring, routing and store access (Epic 41).
- Per-run budget enforcement (needs contract + engine changes).
- Repository browsing (native directory picker / server-side listing); the form takes a path, as specified.
- Run cancellation/abort, pagination, filters and diff previews in history.
- Visual polish of the rest of the dashboard (Epic 47/55).

**Open questions / flagged tradeoffs:**
- The cost heuristic is a stage aid, not a forecast: 40k/6k tokens per task and a 1.35 retry factor. If Epic 48/29 produces measured per-goal costs, replace the constants in `estimate.ts` (one file) rather than tuning the UI.
- `budgetUsd: 0` is described as “plan only”. That is true only once the engine reads the per-run budget; with a config budget it is advisory. The UI copy and the FIX REQUEST should land together.
- The overlap badge can be stricter than the planner (it also counts error-severity `issues`). That is intentional: a demo must never show “clear” over a plan the validator will reject.
- Late preview responses are not cancelled (no `AbortSignal` in the prop contract); the stale marker makes the mismatch visible instead. If Epic 41 adds cancellation, extend `onPreview`’s input with a signal or return an abortable handle.

Closes #40
