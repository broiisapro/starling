# Epic 119 — Web: a guided tour for judges

**Branch** `epic/119-web-tour` · **Lane** `apps/web/src/features/tour/**` · **Ship date** 27 Oct 2026

## Goal

A judge walks up to the laptop mid-demo. In under a minute the dashboard should explain itself: the
Sky, the flight plan, the flock, one agent's transcript, the landing strip and the cost meter —
spotlighted on the **real** UI, with a card that says why each region matters.

The hard requirement is not the copy, it is that the tour can never get stuck: a region that is
missing, collapsed, resized away or not mounted yet degrades to a centred card and the tour keeps
going. "Restart tour" is just opening the overlay again.

Deliverables, all in one self-contained module so checkpoint C3 can wire it with a manifest import:

- `tour/steps.ts` — `TOUR_STEPS` (7 pages) and the drawer-target rule;
- `tour/geometry.ts` — `spotlightRect` / `placeCard`, pure;
- `tour/storage.ts` — `shouldAutoStartTour` plus the `starling.tour.v1` seen record;
- `tour/Tour.tsx` + `TourCard.tsx` — the overlay (`kind: 'overlay'`);
- `tour/index.ts` — the Wave 3 manifest (`id: 'tour'`, icon `Compass`, no hotkey);
- a Playground with a mock of the shell's six regions and a two-anchor fallback toggle;
- 56 tests, including a keyboard-only walkthrough of all seven steps.

## How it works

### The seven steps

| # | id | Anchor | Placement | What it says |
| --- | --- | --- | --- | --- |
| 1 | `sky` | `[data-region="sky"]` | center | Every bird is an agent session in its own worktree; colours are task status. |
| 2 | `views` | `[role="tablist"][aria-label="Centre view"]` | bottom | Sky vs flight plan; disjoint lanes are why parallel work is safe. |
| 3 | `flock` | `[data-region="flock"]` | right | Roosts are machines; session slots; a lost perch reschedules, not loses. |
| 4 | `drawer` | `[data-region="drawer"]` | left | Tool calls, edits, audit verdicts and the diff; what the audit checks. |
| 5 | `queue` | `[data-region="queue"]` | top | The merge queue lands one branch at a time; a conflict is one task. |
| 6 | `metrics` | `[data-region="metrics"]` | top | API spend next to free local calls; why a run costs cents. |
| 7 | `views-menu` | `[data-shell="views-menu"]` (optional) | bottom | Where the rest of the dashboard lives; `?` for shortcuts. |

Only hooks that already exist in the shell are used. `[data-shell="views-menu"]` is Epic 112's new
control, so it is the one **optional** anchor: if it has not landed, step 7 is a centred card. That is
a copy problem at worst, never a broken tour.

### Geometry (pure, `geometry.ts`)

`spotlightRect(element-like, padding, viewport)` grows the anchor's box by `padding` and intersects it
with the viewport. It returns `undefined` for a missing element, a **zero-sized box** (collapsed
region, `display: none` drawer) or a box entirely off screen. `undefined` is the tour's universal
"degrade" signal.

`placeCard(target, card, viewport, placement)`:

1. `center` or no target → centred, clamped to a 12 px margin;
2. otherwise try the requested side (14 px gap), then the opposite side;
3. if neither fits, clamp the requested side into the viewport.

It returns the placement that actually won, so the card can expose `data-placement` (tests and CSS).
The card size itself is capped to `viewport − 2 × 12`, so a 380 px window still gets a usable card.

### The anchor lifecycle (`use-anchor.ts`)

- **Lookup** on every step change. If the selector matches nothing, a `MutationObserver` on
  `document.body` waits for the region to mount (the drawer is created on demand, the strip
  collapses). It disconnects as soon as it finds one.
- **Measure** on mount, on `resize`, on `scroll` (capture, so nested scrollers count) and through
  `ResizeObserver` when the platform has one. Every render also re-reads the box as a backstop, and
  only stores it when the numbers changed — that is what catches "the shell opened the drawer and
  re-rendered us" without a resize event.
- A found-but-hidden element measures to zeros, so it degrades exactly like a missing one.

### The overlay (`Tour.tsx`, `TourCard.tsx`)

- A `fixed inset-0` layer, an SVG mask (white field, black cut-out, 12 px radius) and a teal ring.
  The mask approach works in every engine and keeps the spotlight a single number story; there is no
  `clip-path` polygon to get wrong.
- `role="dialog"`, `aria-modal`, `aria-live="polite"`, `aria-labelledby` the step title, and
  `aria-describedby` the body. Progress is rendered as "Step 3 of 7".
- Keys while focus is inside the card: `→`/`Enter` next, `←` back, `Esc` skip (calls `onClose`).
  `Enter` is ignored when the focused node is a `<button>` so the native click does not double-step.
  Handled keys call `stopPropagation`, so `Esc` does not also close the drawer underneath.
- Focus starts on the primary action each step and `Tab`/`Shift+Tab` wrap inside the card. The card
  itself is `tabIndex={-1}` but is treated as "outside" for wrapping.
- `prefers-reduced-motion`: the placement transition is `motion-safe:` and the overlay carries
  `data-reduced-motion`; the global stylesheet backstop makes it 0 ms anyway.
- The card is measured after render (`offsetWidth/Height`) so placement uses the real height; a
  constant estimate is the fallback where there is no layout engine (happy-dom).

### The drawer step

Step 4 has `action: 'select-first-running-task'`. When it becomes current, the tour calls
`onSelectTask(drawerTaskKeyOf(state))`: the first task **in plan order** whose status is
`running|auditing|fixing`, else the first task in plan order. Plan order matters — `Object.keys` is
event-arrival order — and a stray task not in the plan is appended so a resumed run still opens
something. The state is read through a ref and the action is signature-guarded (`index:runId`), so a
stream of demo events cannot re-select on every tick. If there is no run or no task, the step stays
open as a centred card.

### Persistence and auto-start (`storage.ts`)

`recordTourSeen()` writes `localStorage['starling.tour.v1'] = {"seen":true,"at":<epoch ms>}` on
finish **and** skip; every storage access is guarded (private mode, disabled storage, corrupt JSON →
first visit, never a throw). `shouldAutoStartTour(search, storage?)`:

| URL | Seen before | Result |
| --- | --- | --- |
| `?tour=1` | any | **true** — an explicit demo link always wins |
| `?tour=0` | any | false — screenshots-only session |
| `?demo=1` | no | true |
| `?demo=1` | yes | false |
| anything else | any | false — never interrupt a live run |

### Playground

`playground.html` renders `ShellMock` — six `data-region` boxes, the real `Tabs` control with
`aria-label="Centre view"`, the optional `[data-shell="views-menu"]` — over
`applyEvents(createInitialState(), demoEvents().slice(0, i))` with an event slider. One checkbox
removes **two** anchors (the views menu and the meter) to show the fallback, and "Start tour"
remounts the overlay. A drawer mocked from the selected task makes step 4's action visible.

## Key decisions & reasoning

- **A manifest module, not shell edits.** Wave 3's L32 forbids touching `App.tsx` / `Layout.tsx`, so
  the tour ships as `feature` + optional `open` prop. C3 wires it in one import and one `useState`.
- **`undefined` spotlight instead of a special "missing" mode.** One signal collapses four failure
  modes (missing, collapsed, off screen, no DOM) into the same well-tested path. The card never has
  to know which one happened.
- **Flip, then clamp — not flip only.** A full-height anchor (the drawer) cannot fit beside a card on
  a short window either way; clamping keeps the card on screen, which is what a judge needs.
- **`MutationObserver` for late anchors, no polling.** Regions genuinely mount later (the drawer is
  the obvious one) and a 100 ms poll would be a timer in every test. The observer disconnects after
  the first hit.
- **The action lives in an effect, keyed by `index:runId`.** Selecting a task must happen after the
  step renders (so the card is already there) and must not repeat per event; a signature ref is
  simpler and more honest than a dependency on a 5,000-event array.
- **Persistence on skip too.** "Seen" is about the judge's attention, not completion; writing only on
  Finish would make `?demo=1` ambush the same person again after they skipped.
- **`?tour=1` beats the seen record.** The runbook use case is "open this link on the demo laptop",
  and that laptop has seen the tour before. `?tour=0` exists as the explicit opposite.
- **SVG mask over four divs.** One element, no seams at the corners, and the ring is a second rect.
  `clip-path` would need the inverse polygon and fails differently in old engines.
- **Plan order for "the first task".** The plan is the only stable ordering a run has; the tasks map
  is event-order and would make the drawer choice depend on scheduling luck.
- **Small files.** The overlay is split into constants / geometry / anchor hook / focus trap / card /
  overlay so each stays under ~250 lines (AGENTS §7) and the geometry is testable with no DOM.

## Interfaces for future epics

```ts
// apps/web/src/features/tour/index.ts
export const FEATURE = 'tour' as const;
export const feature = {
  id: 'tour', title: 'Guided tour', description: '…',
  kind: 'overlay', icon: 'Compass', hotkey: undefined,
  Component: Tour as ComponentType<FeatureProps>,
} as const;

export interface FeatureProps { state: SkyState; onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void; onClose?(): void }
export interface TourProps extends FeatureProps { open?: boolean }

export const TOUR_STEPS: readonly TourStep[];
export type TourStep = { id: string; title: string; body: string; anchor?: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  action?: 'select-first-running-task' };
export const OPTIONAL_ANCHORS: readonly string[];
export function requiredAnchors(steps?: readonly TourStep[]): string[];
export function drawerTaskKey(run: Run | undefined): string | undefined;
export function drawerTaskKeyOf(state: SkyState): string | undefined;

export function spotlightRect(target: RectLike | null | undefined, padding: number,
  viewport: Viewport): Rect | undefined;
export function placeCard(target: Rect | undefined, card: CardSize, viewport: Viewport,
  placement: TourPlacement): PlacedCard;

export const TOUR_STORAGE_KEY = 'starling.tour.v1';
export function shouldAutoStartTour(search: string, storage?: TourStorageInput): boolean;
export function hasSeenTour(storage?: TourStorageInput): boolean;
export function recordTourSeen(storage?: TourStorageInput, at?: number): boolean;

// Test/playground seam
export function ShellMock(props: ShellMockProps): JSX.Element;
```

Future epics may add the tour to the command palette (`feature.id`), add a `?page=tour` playground
route, or reuse `placeCard`/`spotlightRect` for any other anchored overlay (the launch form's
coach-marks are the obvious next user).

## Deviations from plan

- **`open?: boolean` on `Tour`.** The brief's manifest has no "open" bit, but the overlay must be
  mountable permanently and toggled (and "Restart tour" is exactly that toggle). It is additive and
  optional, so `ComponentType<FeatureProps>` stays honest. C3 wiring is in the handback.
- **Extra files.** The prompt named four files; the implementation uses `constants.ts`,
  `focus.ts`, `use-anchor.ts`, `TourCard.tsx` and `ShellMock.tsx` as well, to respect the < ~300-line
  rule and to keep the geometry/anchor logic testable in isolation.
- **`TourStorageInput` accepts `null`.** Default parameters cannot distinguish "caller passed
  `undefined`" from "use the browser", so `null` is the explicit "no storage" sentinel used by tests
  and available to an embedding.
- **The fallback hint is visible.** When there is no spotlight the card footer says "no region to
  point at — showing this card instead". It turns a silent degradation into an explainable one on
  stage; it is dropped automatically when an anchor exists.
- **Two anchors, one toggle, in the Playground.** The brief said "removes two anchors"; the mock
  removes the optional views menu and the required meter, which exercises both fallback reasons
  (optional control missing, region missing).
- **56 tests, not 22.** Geometry, storage, steps, overlay and the walkthrough are all cheap in
  happy-dom; the extra cases pin the exact failure modes (zero-sized anchor, late mount, corrupt
  storage, double-Enter) that a judge would hit first.

## Known limitations / deferred

- **The tour narrates, it does not drive.** A feature cannot switch the centre view or open the
  command palette; step 2 explains the Sky/DAG toggle instead of clicking it. A future "interactive
  tour" would need shell callbacks in `FeatureProps` (CONTRACT-style change).
- **`aria-modal` is the only isolation.** The page behind stays in the accessibility tree; making it
  `inert` while the tour is open is the shell's job (C3 can add it around the overlay).
- **No screenshot/Playwright coverage.** The geometry is unit-tested and the walkthrough is a real
  DOM test; pixel review of the mask on a projector is left to the demo-day check.
- **The card is CSS-sized.** A very long translation (the copy is English-only today) would grow the
  card and could flip placement; the flip+clamp path handles it but was not localised.
- **Step 7 depends on Epic 112.** Until `[data-shell="views-menu"]` lands, that page is a centred
  card — by design, and the only coupling to a control outside this lane.
- **No auto-reset after N days.** `at` is stored for a future "show again after 30 days" rule; not
  implemented, because a demo machine should not surprise its operator mid-wave.
