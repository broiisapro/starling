# Epic 121 — Web: toasts and notifications

## Goal

The dashboard should tap you on the shoulder when something important happens: a task landed, an
audit failed, a laptop joined or dropped out, the budget is running hot, the run finished. This epic
turns the existing event stream into a calm, deduplicated, screen-reader-announced toast stack that
can optionally mirror four critical moments into a desktop notification while the tab is hidden.

The deliverable is a self-contained feature module in `apps/web/src/features/toasts/` plus its
manifest, playground and tests. The shell wires it at checkpoint C3 (see the handback).

## How it works

```
state.events ──► cursor.newEventsSince ──► derive.toastsFromEvents ──► queue.createToastQueue ──► ToastHost
 (active run +        (only what is new)        (pure mapping)            (stack, timers,              (DOM + live
  '*' flock                                                                 dismissal)                   region + bell)
  events, capped)
```

- **`derive.ts` — what is worth interrupting for.** Pure mapping from events to `ToastSpec`:
  - `merge.result` `merged` → `merged` ("`<task>` landed"); `conflict` / `tests-failed` →
    `conflict`; `skipped` is silent.
  - `audit.verdict` `pass: false` → `audit-failed`, with the first failing check's name and detail in
    the body.
  - `node.joined` / `node.left` / `task.migrated` → flock toasts; node display names come from
    `ctx.nodes` (with the payload name / id as fallback).
  - `log` `level: 'error'` → `error`.
  - `run.finished` → `run-finished` with the writer's `payload.summary`.
  - The latest `metrics` sample in the batch → `budget` at 80 % (`warn`) or 100 % (`danger`) of
    `ctx.budgetUsd`.
  - Everything else (`task.status`, `agent.event`, `repomap.ready`, `run.created`, `run.status`, …) is
    deliberately ignored. No exhaustive `never` switch: core grows this union.
  - The dedupe key is `type:runId:taskKey:attempt-or-status` (`toastId`). Audit attempts and merge
    statuses are the discriminator; node events use the node id; errors use the envelope `ts` so two
    unrelated errors do not collapse.
- **`cursor.ts` — only what is new.** `newEventsSince(prev, events)` anchors on the last event's
  `(ts, type, runId)` plus the window size, never on an array index. That makes it correct across the
  three ways `SkyState.events` moves: append-only traffic, `EVENT_CAP` slicing, and the re-filter that
  `setActiveRun` performs. The first call primes and replays nothing; an evicted anchor reprimes
  rather than replaying the window.
- **`queue.ts` — the visible stack.** A pure reducer (`enqueue`, `dismiss`, `tick`, `pauseAll`,
  `resumeAll`) keeps at most four entries, newest first, collapses landings inside a four-second
  window into "N tasks landed", auto-dismisses after six seconds, and keeps `error` and `budget`
  until dismissed. `createToastQueue` wraps it with a single timer for the earliest expiry and takes
  injectable `{ setTimeout, clearTimeout }` + clock.
- **`ToastHost.tsx` — the overlay.** Bottom-right, above the bottom strip (`bottom-16 right-3 z-40`),
  below modals. One region is `role="status"` with `aria-live="polite"`; it switches to
  `aria-live="assertive"` while an error toast is present. Every toast has an icon, title, optional
  body, a "Show" action that selects its task, and a labelled close button. Hover or keyboard focus
  pauses the countdowns (and resumes from the same remaining lifetime). Reduced motion removes the
  transitions. `muted` clears the stack and suppresses desktop notifications. It renders `null` when
  muted and has no toast-sized chrome when empty (just the empty live region and no header).
- **`desktop.ts` — opt-in, hidden tab only.** The bell in the stack header asks
  `Notification.requestPermission()` **only on click**, stores the choice in
  `localStorage['starling.toasts.desktop.v1']`, and only notifies for `run-finished`,
  `audit-failed`, `node-left` and `budget` while `document.visibilityState === 'hidden'`. Fully
  guarded when `Notification` or `localStorage` is missing or throws.
- **`Playground.tsx` — the story.** Replays the recorded launch-day fixture with 1× / 4× / 16×
  buttons (16× finishes in ~22 s), pause/restart, and a budget cap of `$0.04` so both budget
  thresholds fire. Two synthetic events (a conflict and an error, labelled as synthetic in the copy)
  follow the recording because the fixture contains no conflict or error event.

## Key decisions & reasoning

1. **Collapse is measured on arrival, not on event `ts`.** The assignment says "merge repeats … within
   4 s collapse" and the playground expects "seven landings collapsing". The fixture's seven merges
   span 21 s, so an event-time window would only fold the closest pair. A batch that arrives together
   (a backlog, a fast replay, or a burst of real merges) is one "7 tasks landed"; in live traffic the
   window still behaves as four seconds. The queue keeps the group's original `id`, so re-derived
   duplicates remain idempotent.
2. **The cursor is an event identity plus a count, not an offset.** `EVENT_CAP` slicing and the run
   switch both change an event's index while leaving its identity alone; an index cursor would skip
   events after a slice and replay history after a switch. When the anchor itself was evicted, the
   cursor reprimes and drops one batch — a few missed toasts are better than a storm.
3. **An empty baseline is still a baseline.** Mounting on an empty state and then receiving a backlog
   does not toast the backlog. This is what keeps a looping kiosk demo calm. The cost is that the
   first couple of events after a cold start are not announced; the toast-worthy ones come later.
4. **Budget emits only the highest threshold reached.** At 105 % the stack shows "Budget spent", not
   "running hot" plus "spent". Repeated metrics samples re-emit the same id, which the queue ignores,
   so the warning lands once without any extra state in `derive`.
5. **`error` and `budget` are the only sticky kinds.** The assignment names them; `audit-failed` is
   important but retryable, so it dismisses after six seconds like the rest. Explicitly closed ids
   are remembered for the session (capped at 200) so a re-derived `budget` toast cannot return a
   second after the user dismissed it.
6. **One live region, assertive while an error is visible.** Two regions (polite and assertive) would
   have to reorder the stack or split it in two. A single `role="status"` region that flips
   `aria-live` is simpler and matches the requirement "role=status … errors assertive".
7. **The bell is only rendered while toasts are on screen.** A permanent bell would be dashboard
   chrome that nobody asked for; the opt-in surface appears exactly when a toast does. The Playground
   and the component tests cover the click path.
8. **Desktop notifications use the toast id as the OS `tag`.** Repeats of the same event replace the
   OS notification instead of stacking duplicates. `silent` is deliberately not set: the Sky owns
   audio cues, not the notification centre.
9. **The playground's conflict/error events are synthetic and labelled.** The fixture is a clean run;
   inventing them inside the recording file would make the shared fixture lie to every other panel.
10. **Imports stay in-lane.** Only runtime helpers from `@starling/core/browser`, `lib/format`,
    `components`, `data` and `features/metrics` are used; nothing in `src/data` or the shell changed.

## Interfaces for future epics

From `features/toasts/index.ts`:

- `feature` manifest: `{ id: 'toasts', title: 'Notifications', kind: 'overlay', icon: 'Bell',
  hotkey: undefined, Component: ToastHost }`; `FEATURE = 'toasts'`.
- `ToastHost`, `ToastHostProps` (`state`, `onSelectTask?`, `onSelectRun?`, `onClose?`, `budgetUsd?`,
  `timers?`, `muted?`, `now?`). Extra props are optional, so the `ComponentType<FeatureProps>` cast
  stays honest.
- `toastsFromEvents`, `toastId`, `ToastSpec`, `ToastKind`, `ToastContext`, `BUDGET_WARN_RATIO`,
  `TOAST_BODY_MAX`.
- `newEventsSince`, `cursorAt`, `Cursor`, `CursorStep`, `EMPTY_CURSOR`.
- `createToastQueue`, `enqueue`, `dismiss`, `tick`, `pauseAll`, `resumeAll`, `isSticky`, `ToastStack`,
  `ToastEntry`, `ToastTimers`, `ToastQueue`, `MAX_VISIBLE`, `AUTO_DISMISS_MS`, `COLLAPSE_WINDOW_MS`.
- `notifyDesktop`, `readDesktopOptIn`, `writeDesktopOptIn`, `requestDesktopPermission`,
  `desktopSupported`, `shouldNotifyKind`, `DESKTOP_STORAGE_KEY`, `DESKTOP_KINDS` and the notification
  types.
- `Playground` is intentionally **not** exported from the barrel (same as the DAG lane), so the shell
  bundle does not carry a second copy of the fixture; `PlaygroundHost` lazy-imports
  `features/toasts/Playground` directly.

Future epics can reuse `cursor.ts` for anything that must consume only new events (a live activity
log, sound cues, a follow-cam), and the desktop helpers for other opt-in notifications. The pure
queue is also a ready-made pattern for any dismissible stack.

## Deviations from plan

- **No `fix-requests-w2.md` items targeted this lane.** The nearest requests (sky freeze hook, queue
  `selectedTask`, layout `paused` plumbing) belong to other folders and were left alone.
- **The fixture has no conflict or error event**, so the playground appends two clearly-labelled
  synthetic events to demonstrate those kinds. The tests never read them.
- **The bell is hidden while the stack is empty** (see decision 7) rather than always present.
- **`bottom-16` is a fixed offset**, not a measurement of the collapsible bottom strip. It clears the
  strip at the shell's current height; if a future layout makes the strip taller, this is one class.
- **Budget is a prop, not derived from config.** The shell must pass the per-run cap at C3; without
  it no budget toast can fire.

## Known limitations / deferred

- Dismissed ids live in memory for the session; a reload can show a sticky budget toast again.
- No toast for `run.status` transitions, cancelled runs, or a task that exhausts its attempts
  (the last two show as a failed audit / failed run; adding kinds would grow the stack vocabulary).
- Desktop notifications are best-effort: permission denial, insecure origins and browser throttling
  are silent by design. There is no settings page beyond the bell.
- Long summaries are clipped at 180 characters; the drawer and run history keep the full text.
- `onSelectRun` and `onClose` are accepted for the overlay contract but unused: a toast selects its
  task, and "close all" is not an affordance the stack needs.
- No sound (the Sky owns cues), no service worker/server push, and no change to the store: toasts are
  derived from `state.events` exactly as the assignment required.
- Visual baselines/Playwright coverage for the stack are deferred to the web e2e lane; the component
  tests assert roles, actions and notification rules instead.
