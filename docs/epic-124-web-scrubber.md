# Epic 124 — Web: replay scrubber

## Goal

A presenter should not have to wait for a recorded run to reach the interesting bit. The scrubber is a
timeline strip over the active run: play/pause, 1×/4×/16× speed, a draggable head, and markers for
merges, failures, conflicts, perches joining/leaving, migrations, the plan and the finish.

The store cannot seek yet — Epic 204 adds that after Epic 40 lands — so the scrubber has two modes.
When the shell supplies `onSeek` it is **controlled** and every gesture is a seek request. Without it
the scrubber is a **preview**: it keeps a local head and shows what the dashboard would look like at
that event, clearly labelled *“preview: the live view keeps playing”*.

## How it works

### Markers (`markers.ts`)

`buildMarkers(events)` walks the log once and returns `{ index, ts, kind, label }` for:

| source | kind | example label |
|---|---|---|
| `merge.result` status `merged` | `merge` | `theme merged` |
| `merge.result` status `conflict` | `conflict` | `theme conflict` |
| `merge.result` status `tests-failed` | `fail` | `theme tests failed` |
| `audit.verdict` with `pass: false` | `fail` | `theme failed audit` |
| `task.status` to `failed` | `fail` | `csv-export failed` |
| `node.joined` | `node-join` | `MacBook Air joined` |
| `node.left` | `node-leave` | `MacBook Air left` |
| `task.migrated` | `migrate` | `search migrated air → hub` |
| `plan.created` | `plan` | `plan: 7 tasks` |
| `run.finished` | `finish` | `run finished` |

Node names are accumulated first, so a `node.left` says “MacBook Air left” rather than “air left”.
`skipped` merges and passing audits are not moments and produce no marker.

`nextMarker(markers, index, dir)` is the Shift+arrow primitive. `nextFailure` is the jump button’s
target (kind `fail` or `conflict`). `indexAtTime` is a rightmost-allowed binary search; `timeAtIndex`
clamps. Positions are **proportional to time**, not to event index (`positionOfTime` /
`timeAtPosition` / `indexAtPosition` / `indexAtOffset`), so the Air’s quiet 25-second minute is a
visible gap even though only eleven events sit in it.

`clusterMarkers(placed, widthPx, 4)` groups markers whose pixel positions are closer than 4 px. A
cluster renders as one dot with a count and a tooltip listing every label in it.

### Panel (`Scrubber.tsx`, `ScrubberTrack.tsx`)

The panel is a `panel`-kind feature. Header: play/pause, the shared `Tabs` speed control and a red
“next failure” button. Body: the track, filter chips, a marker legend and — in preview mode — the
preview card.

The head is a real `role="slider"` (`aria-valuemin/max/now`, `aria-valuetext` such as
`1:03, theme failed audit`) and the only tab stop for the track. Keys while it is focused:

- `←` / `→` — one event
- `Shift+←` / `Shift+→` — previous/next marker
- `PageUp` / `PageDown` — ±10 seconds of recording time
- `Home` / `End` — first/last event
- `Space` — play/pause

Pointer drag uses pointer capture. Moves are coalesced into at most one `onSeek` per animation frame;
release cancels the pending frame and emits one final seek at the release position, so the head can
never stop between events. Clicking a marker seeks to its exact event.

Filter chips (`merges`, `failures`, `nodes`) toggle marker groups with `aria-pressed`. A conflict is
both a merge and a failure. Plan and finish are always visible: a timeline with no bookends is harder
to read than one with two calm marks.

Reduced motion (`usePrefersReducedMotion` from `features/metrics`) removes the head’s transition
entirely rather than shortening it; otherwise it is a linear 120 ms glide, never an eased spring.

### Preview (`derive.ts`)

`previewAt(events, index)` applies the first `index + 1` events through the store’s own
`applyEvents(createInitialState(), …)` reducer, then reports: tasks landed / flying / failed /
waiting, API cost, `input + output` tokens (`cached` is a subset of `input`, so it is not added
again), a truthful intermediate run status and a one-line summary of the head event. The component
memoises by `(events, index)` through `createPreviewCache` and a `useMemo`.

### Playground

`Playground.tsx` + `playground.html` is a fully controlled example: it owns `index`, `playing` and
`speed`, re-derives a `SkyState` at the head, and renders a task-status summary, cost, the last event
and a raw event-index slider beside the scrubber. A simple 320 ms/event player makes the wiring move;
dragging the strip, pressing Shift+→ or changing speed is real there.

## Key decisions & reasoning

- **Time-proportional track, not index-proportional.** A demo recording is not uniform: the launch-day
  run has a 25 s gap while the Air’s lid is closed and a dense burst of merges around 64 s. Index
  spacing would imply the gap was busy and the burst was slow. Time spacing is what a video editor
  does and what the presenter expects.
- **Controlled-ness is inferred from `onSeek`, not a separate `controlled` prop.** One optional prop
  is less API than a boolean plus a callback that could disagree; if a parent can seek, it is by
  definition in charge of the head. This also makes the preview default safe: an old shell that has
  not been wired yet gets a working preview rather than a dead slider.
- **Preview uses the real reducer.** A second, lighter derivation would drift from the live dashboard.
  Replaying the same `applyEvents` guarantees the card tells the same story; the cost is O(index)
  work per new head, mitigated by the per-index cache (see limitations).
- **Markers are derived, never stored.** They are a pure function of the log, so a replay from JSONL,
  a live SSE backlog and the fixture all produce identical markers. A 5 000-event run costs one walk.
- **Clustering at 4 px, not a cap on marker count.** A long recording legitimately has many merges;
  hiding them past an arbitrary limit would silently lie. Clustering keeps every marker reachable
  (the cluster’s tooltip lists all labels and clicking it seeks to the first) while the visual density
  stays readable.
- **Plan and finish ignore the filters.** The “nodes” chip hiding the only two moments that explain
  the shape of the run would be a usability trap; the bookends stay.
- **rAF coalescing for drag.** With ~100 agents on one laptop, a pointermove handler that runs the
  binary search and a React commit per pixel is avoidable work. One seek per frame is imperceptible
  and bounded; the final release seek makes the result exact.
- **`aria-valuetext` includes the marker label.** A screen-reader user scrubbing with Shift+→ hears
  “1:03, theme failed audit”, not just a time they cannot map to the story.
- **No document-level hotkey listener.** The shell (Epic 112) owns the `.` hotkey. The panel only
  handles keys while its own slider has focus, which keeps 100 feature lanes from fighting over the
  keyboard.

## Interfaces for future epics

From `features/scrubber/index.ts`:

- `FEATURE = 'scrubber'`, `feature` manifest: `{ id: 'scrubber', title: 'Replay scrubber', kind:
  'panel', icon: 'Rewind', hotkey: '.', Component }`.
- `Scrubber` — props `ScrubberProps = FeatureProps & ScrubberExtras`; every extra is optional:
  `events?`, `index?`, `playing?`, `speed?`, `onSeek?`, `onPlayPause?`, `onSpeedChange?`.
- `ScrubberTrack` and `PreviewCard` are exported for composition/testing, not required by C3.
- Pure layer: `buildMarkers`, `markerOf`, `nextMarker`, `nextFailure`, `eventSpan`, `timeAtIndex`,
  `indexAtTime`, `positionOfTime`, `timeAtPosition`, `indexAtPosition`, `indexAtOffset`,
  `markerPositions`, `clusterMarkers`, `filterMarkers`, `isMarkerVisible`, `markerCategories`,
  `markerCounts`, `formatScrubTime`, `scrubClockLabel`, `scrubValueText`, `clampIndex`, `lastIndex`;
  types `Marker`, `MarkerKind`, `MarkerFilter`, `MarkerCluster`, `PlacedMarker`, `EventSpan`.
- Preview: `previewAt`, `createPreviewCache`, `describeEvent`, type `ScrubPreview`.

### C3 wiring (exact)

1. **Registry** — in the feature registry (Epic 112, wired by C3):

   ```ts
   import { feature as scrubberFeature } from '../features/scrubber';
   registerFeature(scrubberFeature);
   ```

2. **Panel mount** — in `apps/web/src/app/Layout.tsx`, next to the other selector-driven panels.
   Today (pre-Epic 204), preview only:

   ```tsx
   import { Scrubber } from '../features/scrubber';
   import { demoEvents } from '../data/demo';

   // inside Layout, above the return:
   const scrubberEvents = state.connection === 'demo' ? demoEvents() : state.events;

   // in the bottom strip / side panel region:
   <Scrubber state={state} events={scrubberEvents} />
   ```

   Once Epic 204 adds the store seek, make it controlled:

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

3. **Playground route** — add `'scrubber'` to `PLAYGROUNDS` in `apps/web/src/lib/route.ts` and a
   lazy branch + `TITLES` entry in `apps/web/src/app/PlaygroundHost.tsx`:

   ```tsx
   scrubber: lazy(() => import('../features/scrubber/Playground')),
   ```

4. **Hotkey** — the shell binds `.` from the manifest. The feature adds no key listener.

### Store API Epic 204 must add

```ts
interface SkyActions {
  /** Rebuild all derived state from the first `index + 1` events and reposition the demo player. */
  seek(index: number): void;
}
```

Requirements:

- Keep the **full** event log available (`replayEvents` / the un-truncated run log) separately from
  the derived `state.events`; otherwise seeking backwards shrinks the head’s `aria-valuemax`.
- Reset derived slices (`runs`, `agentsLog` for active keys, `verdicts`, `merges`, `metricsHistory`)
  and replay `events.slice(0, index + 1)` through `applyEvents`, or recompute from a snapshot.
- Stop the demo player’s pending timer, set its cursor to `index`, and resume from `index + 1` if it
  was playing.
- Clamp `index` to `[0, events.length - 1]` and ignore a seek to the current index.

## Deviations from plan

- **One extra marker kind appears in the fixture than the brief’s list implies:** the hub’s own
  `node.joined` is a node marker too. `buildMarkers(demoEvents())` therefore has 15 markers (7
  merges, 1 failed audit, 3 joins — hub, Air, Air again — 1 leave, 1 migration, 1 plan, 1 finish),
  not 14.
- **The preview card derives a display run status** (`running`) when the recording has no
  `run.status` events but tasks have landed or started. The fixture is a single `run.created`
  snapshot whose status stays `mapping` until `run.finished`; showing “mapping” halfway through would
  be technically true and practically wrong. Terminal statuses are never overridden.
- **The speed control updates local state even when a parent supplies `onSpeedChange` but no
  `speed`** — convenient for the playground and for a shell that only persists the preference. If
  `speed` is supplied it wins.

## Known limitations / deferred

- **Preview recomputes the reducer per new head.** Memoised by index, so scrubbing back to an already
  visited frame is free, but dragging across a 5 000-event run can do 60 reducer passes per second.
  Epic 204’s incremental seek (or a snapshot cache every N events) is the right fix; it is out of
  this lane because the store is off limits.
- **Clusters do not fan out.** A cluster shows a count and a tooltip; clicking seeks to its first
  marker. A zoom/fan-out interaction is polish, not needed for the demo.
- **Marker buttons are `tabIndex={-1}`.** The slider is the single keyboard path (arrows + Shift
  cover every marker); a tab stop per marker would make a 200-marker run 200 Tab presses.
- **The panel does not run the demo player.** Play/pause reports intent; the shell owns timing. In
  preview mode it only reflects local state, because nothing here can advance the live view.
- **Filters are not persisted.** They reset to all-on per mount; a URL/localStorage preference is
  shell work.
- **No touch-specific gestures** beyond pointer events (tap-to-seek and drag work; pinch/zoom does
  not).
- **Playground player is 320 ms/event** and stops at the end; it exists to make the controlled wiring
  visible, not to be the production player.
- **`run.status` is read structurally** (`describeEvent`) and core is not modified here.
