# Epic 115 — Web: the lanes map (who owns which files)

**Branch** `epic/115-web-lanes` · **Lane** `apps/web/src/features/lanes/**` ·
**Ship date** 27 Oct 2026

## Goal

Make lane safety visible. A hundred agents can work at once only because every task owns a disjoint
set of paths; the lanes map is the two-second answer to "who owns which patch of sky?". It is a
treemap of the repo, coloured by owning task, with read-only areas faded, paths claimed twice hatched
and conflicts or lane violations outlined in red — plus a table for anyone who needs the actual paths.

Product rule from the assignment: the judge should understand it from the picture, not a paragraph;
the engineer should be able to copy a path out of a table and check the claim.

## How it works

### Derivation (`derive.ts`, pure)

`buildLaneTree(state)` / `buildLaneModel(state)` read the active run only:

| Signal | Source | Effect |
| --- | --- | --- |
| ownership | `plan.tasks[*].lane.owns` | owner list; the static prefix becomes a directory (`src/features/theme/**` → `src/features/theme`), an exact path stays a file |
| read access | `plan.tasks[*].lane.reads` | reader list; a node with readers but no owners is drawn faded and flagged read-only |
| touched lines | `agentLog[key]` `file.edited` (`data.path/added/removed`), `state.diffs[diffKey(runId, key)]`, structural `task.diff` events | line count and treemap weight |
| conflicts | `merge.result` with `status: 'conflict'` → `conflictedFiles` | red outline on the file and every ancestor frame |
| violations | `verdicts[key][*].laneViolations` | red dashed outline |
| overlap pairs | `globsOverlap(a.owns, b.owns)` for every task pair | `LaneOverlap[]` and the warning strip |

`LaneNode` is the deliverable's shape plus two additive fields (`kind`, `overlap`) so the view can
draw frames and the list can flag a hatch without re-deriving it. Directory `owners`/`readers` are
the union of their descendants; `touched` is lines added + removed at or below the node.

Weights fall back in the documented order — touched lines, else 1 per file, else 1 per lane glob —
so a plan paints immediately after `plan.created`, before any agent has touched anything.

`formatLaneSummary` produces the strip: **"7 lanes · 0 overlaps · 8 files touched · 0 conflicts"**
for the recorded launch-day run. `laneOverlapIssues` surfaces `plan.created` issues with
`code: 'lane-overlap'` when that event survived the 5,000-event cap.

### Layout (`squarify.ts` + `layout.ts`, pure)

`squarify(nodes, rect)` is the classic squarified-treemap algorithm (Bruls et al.): rows are placed
along the shorter side and a candidate joins a row only while the worst aspect ratio improves.
Areas are proportional to weight, tiles do not overlap, and order is deterministic.

`layoutLanes` applies one squarified pass per directory level. A directory with at least 46×34
viewBox units becomes a frame with a 2-unit gutter and a label row; a smaller one collapses to a
single tile so the map never draws unreadable slivers. `nearestTile` turns arrow keys into geometric
movement (right neighbour, not "next in tree order").

### View (`LanesView.tsx`, `LaneTable.tsx`, `palette.ts`)

- SVG treemap with nested directory frames; tile fill is the owner's colour from a fixed walk over
  the `--color-irid-*` tokens in plan order, so the same plan always paints the same task.
- Read-only tiles render at 0.22 fill opacity. Overlaps get an amber `<pattern>` hatch. Conflicts
  use `#fb7185` solid; violations `#f87171` dashed. Selecting a task keeps its patches at full
  opacity and dims everything else to 0.18.
- Legend with every task title; a summary strip; a warning badge row for `lane-overlap` plan issues.
- "View as list" renders the same tree as a table (path, owner, readers, touched lines, flags).
- Tiles are `role="button"` `<g>` elements with roving tabindex: exactly one tab stop, arrows move
  focus geometrically, Enter/Space select the owner. Keys are handled on the tile, never on
  `document`, so the shell's own hotkeys stay unaffected.
- Semantic design tokens only (`bg-panel`, `text-ink-*`, `border-hairline`), so light and dark mode
  both work; no new dependency was needed.

### Playground

`?playground=lanes` (dev route) renders `Playground.tsx`: an event-index slider replays
`applyEvents(createInitialState(), demoEvents().slice(0, i))`, and a toggle swaps in
`test-fixtures.ts` — three hand-made lanes where `theme` and `search` both own `src/ui/**`, one file
is edited by both, a merge conflicts and the auditor flags a write outside the lane. The fixture
summary is `3 lanes · 1 overlap · 5 files touched · 1 conflict`.

## Key decisions & reasoning

- **Direct claims, not inherited ownership, decide the hatch.** `src/` is owned by every task that
  owns anything below it; hatching shared ancestors would turn most of the map yellow. A path is
  hatched when two tasks *explicitly* claim it (glob targets) or two agents edit the same file.
  `owners` still aggregates upward for colour, dimming and the table.
- **The editing task becomes a de-facto owner.** A touched file outside every lane still gets a
  colour (the agent that wrote it) and any declared lane owner is added by `matchesGlob`. That is
  what lets a violation appear on the map instead of an orphan grey tile; the red dashed outline
  says the ownership is suspect.
- **Two conflict sources, event first.** `merge.result` events are run-scoped; `state.merges` is not
  and survives the event cap. We read events for the active run and only fall back to `merges` when
  the log no longer contains a merge result, so switching runs cannot paint another run's conflicts.
- **Files are counted once per agent event.** `filesTouched` is the number of distinct paths, so the
  fixture's eight `file.edited` events are eight files even though two belong to `theme`.
- **The table is not a fallback.** A treemap is the wrong instrument for reading a path; the list is
  a first-class mode, keyboard reachable, with the same data and flags.
- **No document key handler.** L39 gives the shell the `l` hotkey; this component only handles keys
  while focus is inside its tiles, which keeps the roving tabindex honest and avoids stealing arrows
  from the Sky.

## Interfaces for future epics

```ts
buildLaneModel(state: SkyState): LaneModel          // tree + overlaps + summary + issues
buildLaneTree(state: SkyState): LaneNode
laneOverlaps(tasks: readonly TaskSpec[]): LaneOverlap[]
laneRows(tree: LaneNode): LaneNode[]                // pre-order, root excluded
layoutLaneTree(tree: LaneNode): LaneLayout          // frames + interactive tiles
squarify(nodes: readonly LaneNode[], rect: Rect): Tile[]
nearestTile(tiles, index, direction): number
formatLaneSummary(summary: LaneSummary): string
feature = { id: 'lanes', kind: 'view', icon: 'LayoutGrid', hotkey: 'l', Component }
```

- Epic 125 (heatmap) owns churn ranking; it can import `laneRows`/`LaneNode.touched` but should not
  duplicate the tree.
- Epic 107 (planner lane suggestions) can reuse `laneOverlaps` and `globTarget` for its preview.
- A future `task.diff` producer in core needs no change here: the extractor already accepts
  `{ taskKey, diff }` and `{ taskKey, files }` shapes structurally.

## Deviations from plan

- `LaneNode` gained additive `kind` and `overlap` fields. The required fields are unchanged; the
  extras are what the nested SVG and the list need without a second derivation pass.
- `overlap` is direct-claim ownership (see above), not `owners.length >= 2`; shared parent
  directories are normal, not a collision.
- The summary counts files from the touched map (not from every lane glob), so an untouched lane
  file does not inflate "files touched".
- `LanesView` accepts one optional prop beyond `FeatureProps` (`initialMode`), as L39 requires extra
  props be optional.

## Known limitations / deferred

- `agentLog` is capped at 500 events per task, so a very chatty early edit can age out before the
  map is opened; the diff cache and `task.diff` are the fallbacks, not a complete history.
- The same file reported by both `file.edited` and a fetched diff is summed, which can over-count
  lines when both are present. Preferring the diff would hide the agent's own view; the discrepancy
  is bounded and only affects tile weight, not the touched-file count.
- `state.verdicts` is keyed by task only, so a verdict from an older run with the same task key can
  paint a violation. The plan's task keys filter most of it; a run-scoped verdict key is a core
  change and is not requested here.
- No virtualisation: a 5,000-file plan would lay out thousands of `<g>` nodes. The current plans are
  ten to twenty tasks; a large-repo mode would aggregate leaves by directory.
- The playground is a Vite page (`/src/features/lanes/playground.html`); `?playground=lanes` needs the
  C3 route entry listed in the handback.
- No screenshot test: layout is covered by pure invariants (area, overlap, bounds, determinism)
  rather than pixels.
