## Epic 124 Handback — Web: replay scrubber

**Status:** Complete. Branch `epic/124-web-scrubber` @ 26370da (+ docs and this handback on top).

**Delivered:**
- `apps/web/src/features/scrubber/markers.ts` — `buildMarkers`, `markerOf`, `nextMarker`, `nextFailure`,
  `eventSpan`, `timeAtIndex`, `indexAtTime` (binary search), `positionOfTime` / `timeAtPosition` /
  `indexAtPosition` / `indexAtOffset`, `markerPositions`, `clusterMarkers` (4 px), `filterMarkers`,
  `markerCategories`, `markerCounts`, `formatScrubTime`, `scrubClockLabel`, `scrubValueText`,
  `clampIndex`, `lastIndex`; types `Marker`, `MarkerKind`, `MarkerFilter`, `MarkerCluster`,
  `PlacedMarker`, `EventSpan`.
- `apps/web/src/features/scrubber/derive.ts` — `previewAt`, `createPreviewCache`, `describeEvent`,
  `ScrubPreview`. Preview replays the real `applyEvents` reducer (landed/flying/failed/waiting, cost,
  `input + output` tokens, last event, derived run status).
- `apps/web/src/features/scrubber/Scrubber.tsx` — `panel` feature: play/pause, 1×/4×/16× `Tabs`,
  marker legend + merges/failures/nodes filter chips, jump-to-next-failure, preview label.
- `apps/web/src/features/scrubber/ScrubberTrack.tsx` — time-proportional rail, clustered markers with
  tooltips, `role="slider"` head with `aria-valuemin/max/now/valuetext`, pointer capture drag with
  one seek per animation frame + exact release seek, keyboard (arrows, Shift+arrows, PageUp/PageDown,
  Home/End, Space), reduced-motion-aware head.
- `apps/web/src/features/scrubber/PreviewCard.tsx` — clearly labelled
  “preview: the live view keeps playing” card with numbers at the head.
- `apps/web/src/features/scrubber/Playground.tsx` + `playground.html` + `playground-main.tsx` — fully
  controlled example: owns index/playing/speed, re-derives `SkyState` at the head, renders a task
  status summary, cost/tokens, last event and a raw event-index slider.
- `apps/web/src/features/scrubber/index.ts` — `FEATURE`, all pure exports, and the L39 manifest
  (`id: 'scrubber'`, `kind: 'panel'`, `icon: 'Rewind'`, `hotkey: '.'`).
- 58 tests (35 pure, 23 component/DOM), including DoD 4: Shift+→ from index 0 walks
  `[2, 5, 57, 72, 90]` and asserts `onSeek` received the theme failed-audit event index.

**Key design decisions:**
- **Time-proportional positions.** The fixture’s 25 s Air-lid gap and dense 64 s merge burst read
  correctly; index spacing would lie about both. Binary-searched `indexAtTime` keeps pointer math
  O(log n).
- **Controlled mode inferred from `onSeek`.** One optional prop instead of a `controlled` boolean plus
  a callback that can disagree; an unwired shell still gets a working preview rather than a dead
  slider.
- **Preview uses the store’s reducer**, not a parallel derivation, so the card cannot drift from the
  live dashboard. Memoised per index via `createPreviewCache`.
- **Clusters instead of a marker cap.** Every marker stays reachable (tooltip lists all labels, click
  seeks the first); density stays readable on a projector.
- **Plan/finish ignore filters.** The two moments that explain the run’s shape should not disappear
  behind a “nodes” chip.
- **rAF-coalesced drag with a final release seek** — bounded work under 100-agent machine load and an
  exact final position.
- **No document-level key listener.** The shell owns `.`; the slider handles keys only while focused,
  which keeps parallel feature lanes from competing for the keyboard.

**Carryover done:**
- Scanned `.orchestrator/fix-requests-w2.md` for requests targeting `apps/web/src/features/scrubber/**`
  (a new Wave 3 folder): **none**. No request was implemented or declined; nothing pre-existing in
  this lane.

**C3 wiring (exact):**
1. Feature registry (Epic 112):
   ```ts
   import { feature as scrubberFeature } from '../features/scrubber';
   registerFeature(scrubberFeature);
   ```
2. Panel mount in `apps/web/src/app/Layout.tsx` (preview mode today):
   ```tsx
   import { Scrubber } from '../features/scrubber';
   import { demoEvents } from '../data/demo';
   const scrubberEvents = state.connection === 'demo' ? demoEvents() : state.events;
   <Scrubber state={state} events={scrubberEvents} />
   ```
   After Epic 204:
   ```tsx
   <Scrubber
     state={state}
     events={scrubberEvents}
     index={state.replayIndex}
     playing={demoPlaying}
     speed={speed}
     onSeek={(index) => skyActions.seek(index)}
     onPlayPause={(playing) => demoPlayer.setPlaying(playing)}
     onSpeedChange={onSpeedChange}
   />
   ```
3. Playground route: add `'scrubber'` to `PLAYGROUNDS` in `apps/web/src/lib/route.ts` and
   `scrubber: lazy(() => import('../features/scrubber/Playground'))` plus a `TITLES` entry in
   `apps/web/src/app/PlaygroundHost.tsx`.
4. Hotkey `.` comes from the manifest; the component adds no listener.

Epic 204 store API (detailed in `docs/epic-124-web-scrubber.md`): `seek(index)` must keep the full log
separately from derived `state.events`, reset derived slices and replay `events.slice(0, index + 1)`
through `applyEvents`, clamp the index, and stop/reposition the demo player’s timer.

**Verification (exact commands + results):**
- `bun install` in the worktree: `Checked 172 installs across 225 packages (no changes)` — `bun.lock`
  untouched.
- `cd apps/web && bun test src/features/scrubber`:
  `58 pass / 0 fail — 177 expect() calls — Ran 58 tests across 3 files. [456.00ms]`
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/scrubber`:
  `Checked 14 files in 12ms. No fixes applied.`
- `bash .orchestrator/bin/heavy.sh bun run test` (root, exit 0):
  packages half `1938 pass / 0 fail — Ran 1942 tests across 223 files. [62.54s]`;
  web half `639 pass / 0 fail — Ran 639 tests across 63 files. [5.89s]`.
- `bash .orchestrator/bin/heavy.sh bun run check` (root, exit 0):
  `Checked 990 files in 335ms. No fixes applied.` then the per-workspace `tsc --noEmit` loop
  finished with no errors.
- DoD 4 test: `Shift+→ walks marker to marker until the theme audit failure (DoD 4)` passes; the
  recorded seeks are `[2, 5, 57, 72, 90]`, ending on the `audit.verdict` failure index.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none (no core/root changes needed; `run.status` is read structurally).

**FIX REQUESTS:**
- none.

**Deliberately deferred / out of scope:**
- Store/demo-player seek (`seek(index)`) — Epic 204, Wave 3b; this epic emits seek requests only.
- Editing `app/`, `App.tsx`, `Layout.tsx`, `lib/route.ts`, `PlaygroundHost.tsx` — C3.
- The Gantt (Epic 114).
- Incremental preview (snapshot cache / incremental reducer) for very long runs; current preview is
  memoised per index but O(index) on a new head.
- Cluster fan-out/zoom, persisted filters, touch gestures beyond pointer events, and making the panel
  own playback timing.

**Open questions / flagged tradeoffs:**
- **Preview card run status is derived.** The fixture carries one `run.created` snapshot whose status
  stays `mapping`, so a frame at 63 s would otherwise read “mapping”. The card shows `running` once
  tasks have landed or started and keeps terminal statuses exact; if product prefers the raw
  snapshot status, it is one branch in `previewAt`.
- **Clusters jump to their first marker.** A presenter aiming for the second of two moments 1.35 px
  apart lands on the first, then presses `→`. A fan-out would be nicer; the tooltip names both, so the
  behaviour is at least discoverable.
- **Marker counts include the hub’s join** (15 fixture markers, not 14): the hub is a real
  `node.joined` event and the legend’s “nodes” chip counts it. Filters make it easy to ignore.
- **`onSeek` fires during drag at most once per frame.** A test that flushes frames manually sees the
  coalescing; a browser user sees the head track the pointer closely enough that the difference is
  invisible.
