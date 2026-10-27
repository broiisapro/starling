# Epic 32 — Web: flock panel

## Goal

Give the dashboard one honest answer to "who is in the flock, and how do I get my laptop into it?".
The flock panel lists every execution node as a **roost** — hub first — with capacity, hardware,
lent models, latency and the tasks it is carrying, and it puts the join code, the join command and a
scannable QR in the same card. A second laptop should be one scan away.

The panel is props-only (ARCHITECTURE §8). It never reads the zustand store, never fetches and never
imports a sibling Wave 1 package; the C1 shell wires store → props.

## How it works

### Roost cards

`FlockPanel` sorts `nodes` hub-first (`sortRoosts`: hub/local node, then name, then id) and renders
one `RoostCard` per node:

- status dot (emerald online, amber busy with a ping ring, slate offline) plus a visible status word;
- a hub/perch badge (`kind === 'local'` or id `hub` → HUB, otherwise PERCH);
- `platform · arch · cores · GB` hardware line and round-trip latency (`<2 ms`, `18 ms`, `no ping`);
- a **session meter**: `maxSessions` segmented pips, `activeSessions` filled, clamped when a node
  over-reports, with a `3/8` monospace readout and an `aria-label` ("3 of 8 sessions in use");
- local models as chips reading `lends qwen3.8:27b`;
- the tasks whose `nodeId` matches, sorted by key, as buttons that call `onSelectTask(key)`;
- offline roosts are dimmed (`opacity-50`, dashed border) and show `last seen 12s ago` plus the
  perch URL. The age ticks once a second when the shell does not pass `now`.

Cards enter with a one-frame lift/fade (`useEntered`, `transition-all duration-300`). When a node
disappears, `usePresence` keeps the old card mounted for `320 ms` with `data-leaving="true"` and a
fade-out, then removes it. With `reducedMotion`, there is no enter transition, no exit hold and no
busy pulse.

### Join card

`JoinCard` shows the join code in large monospace with its own copy button, the full
`starling perch --hub … --code …` command with a copy button (both via `CopyButton`/`useCopy`), the
hub URL, and a QR encoding the command (falling back to the hub URL if the command is empty). The
explainer is literal: "Run this on any laptop with opencode + Starling installed to add it to the
flock." Without `join`, the card degrades to "Flock mode is off for this run." instead of showing a
dead QR.

The QR is built synchronously with `qrcode`'s `create()` (matrix only) and rendered by hand as one
`<path>` inside an SVG with a two-module quiet zone, dark modules on a fixed white background and
`shape-rendering="crispEdges"`. Nothing about the QR is themed, because themed QRs stop scanning.

### Empty state and compact mode

When exactly one roost exists and it is the hub, `EmptyFlock` says "Your flock is just you." with an
"Add a laptop →" link to the join card.

`compact` (an addition beyond §8, documented below) swaps the card grid for a single scrollable row
of mini roosts: dot, name, `active/max`, task count, model count, and an "Add" tile that copies the
join command. It is for narrow dock regions where a card grid would wrap to four screens.

### Data derivation (replay and playground)

`deriveNodes(events)` folds `node.joined` / `node.stats` / `node.left` into `NodeInfo[]`:
heartbeats upsert, optional fields (`url`, `latencyMs`) are preserved when a heartbeat omits them,
`node.left` marks a node offline, zeroes its sessions and keeps its hardware, a later `node.joined`
brings it back, and a leave for an unknown id is ignored rather than invented. `deriveTasks(events)`
folds `run.created` / `task.status` / `run.finished` into the same `Record<string, TaskRun>` the
store will produce at C1.

`Playground` uses both: it loads the recorded launch-day log, reveals it event by event (play, pause,
scrub, or "Next roost event"), and passes the derived nodes and tasks to a real `FlockPanel`. The
fixture is reached through `fixture-log.ts`, which does a **static** `?raw` import and is only
dynamic-imported from `Playground`. That indirection matters: Vite inlines the JSONL into a lazy
116 kB chunk, whereas a dynamic `import('…?raw')` across the workspace root is left unresolved in a
production build (verified with a throwaway Vite build, see the handback). Bun tests never load
`fixture-log.ts`, so the Vite-only specifier never leaks into the test runner.

### Palette

`STATUS_PALETTE` is the local fallback status palette until C1: emerald/amber/slate for
online/busy/offline, a sky ring for the hub, a violet perch badge, and `taskTone(status)` for task
chips. Replacing `palette.ts` with shared theme tokens is a one-file change.

## Key decisions & reasoning

- **Extras are optional, never a second contract.** `compact`, `reducedMotion`, `now` and
  `onSelectTask` live in `FlockPanelExtras` and are intersected with the mirrored §8
  `FlockPanelProps`. A `FlockPanel` is still assignable wherever the §8 type is expected, and C1 can
  promote the additions to core without touching call sites.
- **`now` exists for replay honesty.** The fixture's timestamps are from the recorded day; using
  `Date.now()` would render "last seen 3 years ago". Pinning the clock also makes offline styling
  tests deterministic. When the shell does not pin it, `useNow` ticks every second.
- **`onSelectTask` was added because §8 omits it.** The deliverable requires clickable task chips;
  `DagViewProps`, `MergeQueueProps` and `SkyViewProps` all carry a selection callback, so the flock
  panel clearly meant to as well. Filed as a CONTRACT REQUEST rather than editing §6/§8.
- **QR: library matrix, own renderer.** `qrcode@1.5.4` gives a correct Reed–Solomon encoder without
  us becoming QR mathematicians. Rendering the matrix ourselves (instead of `toString`/`toDataURL`)
  keeps the path synchronous, avoids async effects and the canvas renderer, and lets the QR be
  themed by its container while staying black-on-white for scanners. A hand-rolled encoder was
  rejected: one silent ECC bug makes the demo's "scan to join" fail on stage.
- **Presence is a tiny local hook, not a motion library.** Two transitions and a 320 ms hold do not
  justify a dependency. Timers are keyed per node id and cleaned up, so repeated heartbeats cannot
  strand a leaving card.
- **Departed node semantics are conservative.** A `node.left` for an id we never saw is dropped;
  a leave or heartbeat only ever adds facts it actually carries. `activeSessions` is zeroed on
  departure because the engine migrates those tasks.
- **Copy failure is visible.** `writeClipboard` tries `navigator.clipboard` then a hidden textarea
  - `execCommand`; on failure the button says "Press ⌘C" and an `aria-live` region announces it.
    Swallowing the error would leave the user pasting stale clipboard contents.
- **Tests use a local harness, not RTL.** Epic 00 documented that `@testing-library/react`'s
  import-time `beforeAll` fights Bun's test callback model. `test-dom.ts` mounts with
  `react-dom/client` + `act`, dispatches real `MouseEvent`s, and every test file registers happy-dom
  defensively because the root `bun run test` does not load nested `bunfig.toml` files.
- **Hub-first order is computed, not trusted.** `GET /api/nodes` is specified to put the hub first,
  but a component that silently depends on server order breaks the first time a store sorts by
  `lastSeen`. Sorting locally by hub → name keeps cards stable across heartbeats.

## Interfaces for future epics

Everything below is exported from `apps/web/src/features/flock/index.ts`.

```ts
export const FEATURE = 'flock';

// ARCHITECTURE §8 (mirrored in ./handshake.ts until C1)
export interface JoinInfo { code: string; hubUrl: string; command: string }
export interface FlockPanelProps { nodes: NodeInfo[]; join?: JoinInfo; tasks: Record<string, TaskRun> }

// documented additions, all optional
export interface FlockPanelExtras {
  compact?: boolean;
  reducedMotion?: boolean;
  now?: number;
  onSelectTask?(taskKey: string): void;
}
export type FlockPanelAllProps = FlockPanelProps & FlockPanelExtras;

export function FlockPanel(props: FlockPanelAllProps): ReactElement;

// fixture playground
export interface PlaygroundProps {
  events?: StarlingEvent[];
  autoplay?: boolean;
  speed?: number;
  reducedMotion?: boolean;
  fixture?: string;
}
export function Playground(props: PlaygroundProps): ReactElement;
export const PLAYGROUND_JOIN: JoinInfo;
export function parseEventLog(jsonl: string): { events: StarlingEvent[]; skipped: number };

// pure helpers, safe for the C1 store
export function deriveNodes(events: readonly StarlingEvent[]): NodeInfo[];
export function deriveTasks(events: readonly StarlingEvent[]): Record<string, TaskRun>;
export function sortRoosts(nodes: readonly NodeInfo[]): NodeInfo[];
export function isHub(node: NodeInfo): boolean;
export function relativeTime(ts: number, now: number): string;
export function sessionTotals(nodes: readonly NodeInfo[]): { active: number; max: number; free: number };
export function qrMatrix(value: string): { ok: true; size: number; path: string } | { ok: false; message: string };
export const STATUS_PALETTE: Record<NodeStatus, StatusTone>;
```

Usage from the shell (Epic 23 / C1):

```tsx
import type { Run } from '@starling/core';
import { FlockPanel, deriveNodes } from './features/flock';

function FlockPanelContainer({ run, nodes, join, selectedTask }: Props) {
  return (
    <FlockPanel
      nodes={nodes} // GET /api/nodes, hub first, or deriveNodes(events) in replay
      join={join} // GET /api/flock/join
      tasks={run.tasks}
      reducedMotion={prefersReducedMotion}
      onSelectTask={(key) => selectTask(key)}
    />
  );
}

// Replay / recorded-run mode: no /api/nodes call needed.
const replayNodes = deriveNodes(events);
```

For a narrow sidebar, pass `compact`; for the fixture demo, render `<Playground />` (it is not wired
into `App.tsx` — the shell owns layout).

## Deviations from plan

- **Four additive props instead of one.** `compact` was required; `reducedMotion`, `now` and
  `onSelectTask` were added for the reasons above. All optional and documented.
- **`onSelectTask` is a CONTRACT REQUEST.** §8's `FlockPanelProps` has no selection callback while
  every other view does; see the handback for the exact proposed change.
- **`qrcode@1.5.4` + `@types/qrcode@1.5.6` added** to `apps/web/package.json`, pinned exact.
- **The fixture is loaded through `fixture-log.ts`** rather than a direct dynamic `?raw` import,
  because the latter is not inlined by a production Vite build.
- **Join card is a grid tile** after the roosts, not a separate rail. It keeps the panel a single
  self-contained block that can be dropped into any dashboard column.
- **Tests drive the DOM directly** instead of using `@testing-library/react`, following E00's
  precedent.
- **The busy pulse is suppressed under reduced motion** as well as the card transitions; the
  deliverable only mentioned card animations, but a pulsing dot is the same vestibular problem.

## Known limitations / deferred

- No drawer wiring: task chips report a key upward; opening the agent drawer is the shell's job.
- No node registration UI. The join card tells you what to run; it cannot start a perch. Backend
  work is out of scope (E30/E31).
- The panel is not virtualised. It is comfortable at a few dozen roosts; hundreds would need a
  virtual list or clustering.
- Exit transitions animate opacity/scale but there is no FLIP reordering; the hub-first + name sort
  keeps order stable, so cards do not jump between renders.
- `last seen` only ticks when `now` is not pinned, and it uses whole seconds.
- `STATUS_PALETTE`/`taskTone` are placeholders until C1's shared theme; the QR deliberately ignores
  the theme so it stays scannable.
- `Playground` is a dev surface: it reveals events on a timer, not at recorded timestamps, and its
  join details are canned.
- No browser/E2E test (Wave 1 forbids network and long-running servers). The bundle is covered by a
  one-off Vite build smoke check recorded in the handback, not by CI.
