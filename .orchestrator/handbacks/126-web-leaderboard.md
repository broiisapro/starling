## Epic 126 Handback — Web: flock leaderboard

**Status:** Complete. Branch `epic/126-web-leaderboard` @ `51ab08f` (this handback lands on top).

**Delivered:**

- `apps/web/src/features/leaderboard/derive.ts` — `buildBoards(state: SkyState): Board[]` with six boards (fastest, hungriest, cleanest, stubborn, perch, thriftiest), top 5, key-stable tie-break, hidden empty boards, active-run scoping. Also `formatBoardSeconds`, `auditDurationMs`, `BOARD_SIZE`.
- `apps/web/src/features/leaderboard/avatar.ts` — `birdAvatar(seed): AvatarSpec` (FNV-1a + mulberry32 → hue band, accent hue, pattern, eye, wing, tilt, 4–7 clipped feathers) and `hashSeed`/`plumageColor`.
- `apps/web/src/features/leaderboard/BirdAvatar.tsx` — 16–24 px starling SVG, `aria-hidden`, focusable=false, unique gradient/clip ids per instance.
- `apps/web/src/features/leaderboard/rank-diff.ts` — `rankChanges(prev, next): Map<string, number>` (signed delta, `rankKey(boardId, entryKey)`), `rankChangeList`, `describeChange`, `flipTranslate`, `flockEasing` (reads `--ease-flock`, token value as fallback), `RANK_BADGE_MS = 2000`.
- `apps/web/src/features/leaderboard/Leaderboard.tsx` — panel: horizontal board strip (no page scroll), card per board with leader crown (`Crown`), avatar, rank, label, value, dynamic one-line blurb; task rows are buttons calling `onSelectTask(key)`, node rows are inert; selected-task highlight; FLIP slide + temporary ▲/▼ badge; reduced-motion gate (`data-rank-motion`); `EmptyState` when no run/boards.
- `apps/web/src/features/leaderboard/index.ts` — `FEATURE`, L39 `feature` manifest (`kind: 'panel'`, `icon: 'Trophy'`, `hotkey: 'L'`) and the public exports.
- `apps/web/src/features/leaderboard/types.ts` — `FeatureProps` + optional `LeaderboardExtras` (`reducedMotion`, `badgeMs`).
- `apps/web/src/features/leaderboard/{Playground.tsx,playground.html,playground-main.tsx}` — slider over `applyEvents(createInitialState(), demoEvents().slice(0, i))`, theme toggle, click-to-select.
- `docs/epic-126-web-leaderboard.md`.
- 56 new tests in 5 files: `derive.test.ts` (22), `avatar.test.ts` (6), `BirdAvatar.test.tsx` (6), `rank-diff.test.ts` (11), `leaderboard.test.tsx` (11 incl. the fixture DoD assertions).

**Key design decisions:**

- **Snapshots primary; events only for migration gaps.** `state.events` is capped and run-filtered, so a migrated task is credited via its final `TaskRun.nodeId`; `task.migrated` is consulted only for a task missing from the run snapshot (no double-counting).
- **Honest numbers.** `cached` is a subset of `input`; cleanest requires a non-empty check list that is entirely `ok`; `Σ durationMs` is trusted only when every check reported one, else `verdict.ts − startedAt`; missing timings skip the entry rather than ranking a fake `0`.
- **Thriftiest = per-node average cost per merged landing** ("lowest `costUsd` per merged task" read as a ratio). Pairs with busiest perch; flagged below.
- **Reduced motion disables the slide, not the badge.** The ▲/▼ glyph is information; hiding it would remove meaning rather than motion.
- **No panel chrome, no keydown listener.** The shell's `Panel` titles the region; the shell's registry owns `⇧L`. The strip scrolls horizontally inside itself so a 1280 projector layout never scrolls the page.
- **Avatars seeded by task/node key**, so a bird is the same in every board and stable through reorders.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 180 installs across 225 packages (no changes)` — `bun.lock` untouched.
- `cd apps/web && bun test src/features/leaderboard`: **56 pass / 0 fail**, 658 expect() calls, 5 files.
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/leaderboard`: `Checked 15 files … No fixes applied.`
- `bash .orchestrator/bin/heavy.sh bun run test` (root, after rebase onto `origin/main` @ `b493778`):
  - packages/apps/server/cli/tools: `1974 pass, 5 skip, 0 fail` — 1979 tests across 227 files.
  - apps/web: `637 pass, 0 fail` — 637 tests across 65 files.
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 1006 files in 654ms. No fixes applied.` + per-workspace `tsc --noEmit` loop clean.
- Fixture DoD check is a happy-dom test: `dates-fix` is first on `Fastest bird` (`data-rank-key="fastest:dates-fix"`, `33.4s`) and `MacBook Pro` is first on `Busiest perch` (`perch:hub`, `5 tasks`).

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. Epic 40's `TaskRun.nodeName` is read structurally (`nodeName ?? state.nodes[id]?.name ?? id`) and needs no further change.

**Carryover done (`.orchestrator/fix-requests-w2.md`):**

- **No request targets `apps/web/src/features/leaderboard/**`** (the folder is new in Wave 3), so none was implemented or declined by scope. Adjacent web requests are other lanes and untouched: #47 `SkyViewProps.paused` + `Layout.tsx` pause wiring, #53 launch panel/preview route, #55 queue column widths + `MergeQueueProps.selectedTask`, #41 shell routing/playground changes, #42/#43 flock/tracker, #68 stats page.

**C3 wiring (exact code C3 must add):**

1. `apps/web/src/lib/route.ts` line 12 — extend the tuple:
   ```ts
   export const PLAYGROUNDS = ['sky', 'dag', 'agents', 'queue', 'metrics', 'flock', 'leaderboard'] as const;
   ```
2. `apps/web/src/app/PlaygroundHost.tsx` — lazy import next to the others, plus title and branch:
   ```ts
   const LeaderboardPlayground = lazy(() => import('../features/leaderboard/Playground'));
   // TITLES:
   leaderboard: 'Leaderboard',
   // renderPlayground switch:
   case 'leaderboard':
     return <LeaderboardPlayground />;
   ```
3. Register the manifest (Epic 112's registry, wherever feature manifests are collected):
   ```ts
   import { feature as leaderboardFeature } from '../features/leaderboard';
   // add `leaderboardFeature` to the registry array the shell maps over
   ```
4. Shell mount: the registry supplies `state`, `onSelectTask`, `onSelectRun`, `onClose`; pass the reduced-motion preference if the shell owns it:
   ```tsx
   <Leaderboard
     state={state}
     onSelectTask={skyActions.selectTask}
     reducedMotion={prefersReducedMotion}
   />
   ```
5. Optional: add `'leaderboard'` to the `features` array in `apps/web/src/App.test.tsx` (currently only Wave 1/2 folders). The folder already exports `FEATURE = 'leaderboard'`.

**FIX REQUESTS:** none.

**Deliberately deferred / out of scope:**

- Persisting high scores across runs, ranking people, the flock panel (Epic 135) and Sky (Epic 130).
- Playwright/screenshot coverage; the playground is the visual check.
- Preserving the strip's horizontal scroll position across run switches; animating cards that appear/disappear.
- A per-task thriftiest reading, all-time stats, and a configurable board set.

**Open questions / flagged tradeoffs:**

- **Thriftiest interpretation.** Per-node average (`$0.0053` for the Air) vs a per-task "cheapest landing" ranking. I chose the ratio because the brief says "per merged task"; switching is one comparator in `thriftiestBoard` if product prefers per-task.
- **Reduced motion and the badge.** The brief says the badge is "off" with reduced motion; I kept the glyph and disabled the slide. If the intent was to hide the badge too, `RankBadge` can take the flag — but then a screen reader user who asked for less motion also loses "moved up".
- **`--ease-flock` read at animation time.** `flockEasing()` calls `getComputedStyle` once per animated row; on a 30-row strip that is negligible, and it keeps the token authoritative. If a future shell renders thousands of rows, hoist it to a module constant.
- **`TaskRun.attempts` is fix attempts**, not total attempts, so first-time passes never appear on "Most stubborn". That is the contract's meaning; the fixture's `theme` (1) and `search` (1, no failed verdict) exercise the tie-break.
