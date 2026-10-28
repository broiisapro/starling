## Epic 119 Handback — Web: guided tour for judges

**Status:** Complete. Branch `epic/119-web-tour` @ `961cdae` (9 commits). Closes #129.

**Delivered:**

- `apps/web/src/features/tour/steps.ts` — `TOUR_STEPS` (7 pages: sky, views, flock, drawer, queue, metrics, views-menu), `TourStep` copy, `OPTIONAL_ANCHORS`, `requiredAnchors()`, `stepById()`, `orderedTaskKeys()`, `drawerTaskKey()`, `drawerTaskKeyOf()`.
- `apps/web/src/features/tour/geometry.ts` — pure `spotlightRect(el, padding, viewport)` (inset + viewport intersection; `undefined` for missing/zero-sized/off-screen) and `placeCard(target, card, viewport, placement)` (requested side → flip → clamp at a 12 px margin; `center` with no target; returns the placement that won).
- `apps/web/src/features/tour/storage.ts` — `TOUR_STORAGE_KEY = 'starling.tour.v1'`, guarded `readTourSeen` / `hasSeenTour` / `recordTourSeen`, and `shouldAutoStartTour(search, storage?)` (`?tour=1` always, `?tour=0` never, `?demo=1` first visit only).
- `apps/web/src/features/tour/Tour.tsx` + `TourCard.tsx` + `use-anchor.ts` + `focus.ts` + `constants.ts` — the overlay: SVG-mask spotlight, dialog with `Step x of 7`, Back / Skip / Next (Finish on 7), `→`/`←`/`Enter`/`Esc`, trapped Tab, focus on the primary action per step, `ResizeObserver` + scroll/resize + `MutationObserver` for late anchors, `data-reduced-motion`.
- Drawer step action: `onSelectTask(first running|auditing|fixing task in plan order, else first task)`; signature-guarded so demo ticks cannot re-select; a run with no tasks keeps a centred card.
- `apps/web/src/features/tour/index.ts` — `FEATURE`, `feature` manifest (`id: 'tour'`, `kind: 'overlay'`, icon `Compass`, `hotkey: undefined`), all public exports.
- `ShellMock.tsx` + `Playground.tsx` + `playground.html` — six `data-region` boxes, the real `Tabs` (`aria-label="Centre view"`), `[data-shell="views-menu"]`, event-index slider over `demoEvents()`, and one toggle that removes two anchors (views menu + meter).
- 56 tests in 5 files: geometry (10), storage (12), steps/drawer (12), overlay (17), keyboard walkthrough (3 — all seven steps, then Finish writes `starling.tour.v1`).

**Key design decisions:**

- **One degrade signal.** Every failure (missing selector, collapsed region, `display: none` drawer, off-screen box) becomes `spotlight === undefined` → centred card. The card never branches on why.
- **Flip then clamp.** A full-height anchor (drawer) cannot fit beside the card on a short window; clamping keeps the card usable instead of pushing it off screen.
- **`MutationObserver` for late anchors, not polling.** The drawer genuinely mounts after `onSelectTask`; the observer disconnects on the first hit, so idle cost is zero.
- **Action in an effect keyed by `index:runId`.** Selecting a task must happen after the step renders and must not repeat per event; a signature ref beats depending on a 5,000-event array.
- **Persist on skip as well as finish.** "Seen" is about the judge's attention; otherwise `?demo=1` re-ambushes someone who skipped.
- **`?tour=1` beats the seen flag.** The runbook link must work on a laptop that has already seen the tour; `?tour=0` is the explicit opposite for screenshot sessions.
- **Plan order for "first task".** The tasks map is event order; the plan is the only stable ordering a run has.
- **SVG mask over `clip-path`.** One rect pair, no inverse polygon, and the teal ring is a second rect.
- **Small files.** Overlay split into constants / geometry / anchor hook / focus trap / card / overlay, all under ~250 lines.

**Verification (exact commands + results):**

- `bun install` (worktree): `bun install v1.4.4` — no changes, `bun.lock` untouched (`git status` clean apart from this lane's files).
- `cd apps/web && bun test src/features/tour`: **56 pass / 0 fail**, 178 expect() calls, 5 files.
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/tour`: clean.
- `bash .orchestrator/bin/heavy.sh bun run test` (root): `test:packages` → **1937 pass / 4 skip / 1 fail** (`packages/merger/src/queue.test.ts` "queues per integration branch", `MERGE_ERROR … failed to read .git/worktrees/…/commondir` under load; re-run alone → **6 pass / 0 fail**, so it is a pre-existing load flake outside this lane); `test:web` (run separately, because `&&` stopped at the flake) → **637 pass / 0 fail**, 65 files.
- `bash .orchestrator/bin/heavy.sh bun run check`: **clean** — `biome check .` (996 files) + per-workspace `tsc --noEmit`, exit 0.
- DoD #4 (happy-dom walk of all 7 steps ending with the record written): `walkthrough.test.tsx` — "seven ArrowRights visit every step and Enter finishes with the record written" **pass**.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. `FeatureProps`/`TourProps` are declared locally per L39; no core, root-config or server change is needed.

**C3 wiring (exact):**

```tsx
// apps/web/src/app/Layout.tsx — imports
import { shouldAutoStartTour, Tour } from '../features/tour';

// apps/web/src/app/Layout.tsx — inside Layout(), next to the other useState calls
const [tourOpen, setTourOpen] = useState(() =>
  typeof window === 'undefined' ? false : shouldAutoStartTour(window.location.search),
);
// Remounting is how "Restart tour" returns to step 1 (palette item / views-menu action).
const [tourEpoch, setTourEpoch] = useState(0);
const closeTour = useCallback(() => setTourOpen(false), []);
const restartTour = useCallback(() => {
  setTourEpoch((n) => n + 1);
  setTourOpen(true);
}, []);

// apps/web/src/app/Layout.tsx — the shell key handler (currently line ~139, after the editable-field guard)
if (tourOpen) return; // the tour owns the keyboard while it is open

// apps/web/src/app/Layout.tsx — last sibling inside the root <div>, after <KeyboardHelp … />
<Tour key={tourEpoch} state={state} open={tourOpen} onSelectTask={actions.selectTask} onClose={closeTour} />
```

- Palette / views-menu: register the manifest (`import { feature as tourFeature } from '../features/tour'`) and bind "Restart tour" to `restartTour`. `hotkey` is `undefined`, so nothing else to bind.
- Playground route (optional): add `'tour'` to `PLAYGROUNDS` in `apps/web/src/lib/route.ts` and a lazy `TourPlayground` branch + title in `apps/web/src/app/PlaygroundHost.tsx`.
- If the shell gains a shared "modal open" flag for `inert`/`aria-hidden` on the app, include the tour (`role="dialog"`, `aria-modal="true"`).

**Carryover done (`.orchestrator/fix-requests-w2.md`):**

- None target `apps/web/src/features/tour/**` — the folder is new in Wave 3. The web requests in that file are for E47 (`features/sky` `paused`), E55/41 (`features/queue` selection, layout column widths), E53 (`features/launch`), E41 (`Layout.tsx`, `lib/route.ts`) and `apps/web/src/data` (Wave 3b): all outside this lane, so each is declined as out of scope rather than unimplemented.

**FIX REQUESTS:**

1. **Epic 112 (`apps/web/src/app/TopBar.tsx` / the new views menu):** keep `data-shell="views-menu"` on the menu trigger. The tour's 7th page anchors to it; if the attribute is renamed, change `TOUR_STEPS[6].anchor` (one line, this lane) and nothing else.
2. **Epic 41 (`apps/web/src/app/Layout.tsx`):** the shell's document-level keydown handler must early-return while the tour is open (line in **C3 wiring**). The overlay stops the keys it owns (arrows, Enter, Esc), but `1`/`2`/`b`/`f` typed inside the dialog would still rearrange the dashboard behind it.
3. **Epic 41 (`apps/web/src/lib/route.ts`), optional:** parse `tour` into `SkyRoute` (`tour?: boolean`) so the shell does not read `window.location.search` itself. `shouldAutoStartTour` takes any search string, so this is polish, not a blocker.
4. **Epic 41/112:** if a shared modal layer adds `inert` to the app while an overlay is open, list the tour as a modal (it is `role="dialog"` + `aria-modal="true"`); the tour does not inert the page behind it itself.

**Deliberately deferred / out of scope:**

- Driving the UI from a step (switching the centre view, opening the palette). A feature has no shell callbacks; step 2 narrates the Sky/DAG toggle instead of clicking it.
- Auto-starting from the shell, palette registration and playground routing (C3, above).
- Screenshot/Playwright coverage of the mask; geometry + DOM behaviour are covered, projector pixel review is a demo-day check.
- Localisation of the copy; "show again after 30 days" (`at` is stored for it, the rule is not implemented).
- Video/GIF recording.

**Open questions / flagged tradeoffs:**

- **Keyboard ownership is split.** The tour stops propagation for the keys it handles; the shell still needs the `if (tourOpen) return;` guard for letter hotkeys. One line, but it means C3 cannot wire the overlay without touching the shell handler.
- **`aria-modal` is the only isolation.** A screen reader's virtual cursor can still reach the page behind; `inert` on the app is the shell's call (FIX REQUEST 4).
- **Step 7 is a soft dependency on Epic 112.** Until `[data-shell="views-menu"]` lands it is a centred card — correct, but less impressive on stage; the fallback line in the card footer makes that visible rather than silent.
- **The card's height is measured, width is CSS.** A long translated string would grow the card and rely on the flip+clamp path; not exercised because the copy is English-only.
