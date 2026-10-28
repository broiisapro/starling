## Epic 121 Handback — Web: toasts and notifications

**Status:** Complete. Branch `epic/121-web-toasts` @ `e1afdde` (docs + this handback sit on top).

**Delivered:**
- `features/toasts/derive.ts` — `toastsFromEvents(events, { nodes, run?, budgetUsd? })` with `ToastSpec`/`ToastKind`, the `type:runId:taskKey:attempt-or-status` dedupe key, mappings for `merge.result` (merged/conflict/tests-failed), `audit.verdict` failures (first failing check), `node.joined`/`node.left`/`task.migrated`, `log` errors, `run.finished` and the latest `metrics` budget crossing (80 % warn, 100 % danger).
- `features/toasts/cursor.ts` — `newEventsSince(prev, events)` / `cursorAt`; anchors on `(ts, type, runId)` + window count so cap slicing and `setActiveRun` re-filters never replay history; first call and evicted anchors reprime silently.
- `features/toasts/queue.ts` — pure `enqueue` / `dismiss` / `tick` / `pauseAll` / `resumeAll` (max 4, newest first, 4 s landing collapse into "N tasks landed", 6 s auto-dismiss, errors + budget sticky, explicit dismissals remembered) plus `createToastQueue` with injectable timers and clock.
- `features/toasts/ToastHost.tsx` — bottom-right overlay (`kind: 'overlay'`, mount always), `role="status"` live region that flips to `assertive` on errors, per-toast icon/title/body, "Show" → `onSelectTask`, labelled close, hover/focus pause, reduced-motion attribute, optional `budgetUsd` / `timers` / `muted` / `now`.
- `features/toasts/desktop.ts` — opt-in desktop notifications (bell in the stack header): permission only on click, `localStorage['starling.toasts.desktop.v1']`, hidden-tab-only, four kinds, fully guarded when `Notification`/`localStorage` are absent or throw.
- `features/toasts/index.ts` — `FEATURE`, the L39 manifest (`id: 'toasts'`, `kind: 'overlay'`, icon `Bell`, hotkey `undefined`) and the public surface listed in the epic doc.
- `features/toasts/Playground.tsx` + `playground.html` + `playground-main.tsx` — fixture replay at 1×/4×/16× (default 16× ≈ 22 s), pause/restart, `$0.04` budget so both thresholds fire, two clearly-labelled synthetic events for the conflict/error kinds the fixture lacks.
- 61 new tests in `derive.test.ts`, `cursor.test.ts`, `queue.test.ts`, `ToastHost.test.tsx` (plus `test-events.ts` builders).

**Key design decisions:**
- **Collapse is measured on arrival, not on event `ts`.** The fixture's seven merges span 21 s, but the assignment wants them to read as collapsed landings ("seven landings collapsing", "a collapsed landings toast") and live traffic still collapses within 4 s. The group keeps its id, so re-derived duplicates are idempotent.
- **Cursor = last event identity + window count**, not an index: indices move under `EVENT_CAP` and run switches. If the anchor is evicted, the cursor reprimes and drops a batch rather than replaying.
- **An empty mount is a baseline too**, so a backlog arriving after mount does not storm. Cost: the first event or two of a cold start are not announced; the toast-worthy events come later.
- **Budget emits only the highest threshold reached** (no warn+spent stack at 105 %), and repeated metrics samples reuse the same id, which the queue ignores.
- **`error` and `budget` are the only sticky kinds** (per the assignment); `audit-failed` dismisses after 6 s. Explicit dismissals are remembered for the session (cap 200) so a re-derived budget toast cannot return.
- **One live region** (`role="status"`) flips `aria-live` to assertive while an error is visible, instead of splitting the stack across two regions.
- **The bell renders only while toasts exist**; a permanent bell would be unrequested chrome. The Playground and component tests cover the opt-in click path.
- **Playground-only synthetic conflict/error events** are labelled as synthetic; the shared fixture is never edited.

**Verification (exact commands + results):**
- `bun install` (repo root): `Checked 172 installs across 225 packages (no changes)` — `bun.lock` untouched.
- `cd apps/web && bun test src/features/toasts`: **61 pass / 0 fail**, 160 expect() calls across 4 files.
- `bunx tsc --noEmit -p apps/web`: clean.
- `bunx biome check apps/web/src/features/toasts`: `Checked 14 files … No fixes applied` (clean).
- DoD 4 is `ToastHost.test.tsx` → “feeding the fixture after mount yields one failed audit, collapsed landings and one finish”: mounts on the first 30 events, re-renders through the whole fixture, asserts exactly one `audit-failed`, a `merged` toast titled “N tasks landed”, exactly one `run-finished`, and node-joined/left/migrated; “mounting on a finished run shows nothing” passes.
- `bash .orchestrator/bin/heavy.sh bun run test` (repo root): packages **1938 pass / 4 skip / 0 fail** (`Ran 1942 tests across 223 files`), web **642 pass / 0 fail** (`Ran 642 tests across 64 files`).
- `bash .orchestrator/bin/heavy.sh bun run check`: Biome clean (989 files) and the per-workspace `tsc` loop completed with no output.

**Dependencies added:** none.

**Carryover done:** none — every request in `.orchestrator/fix-requests-w2.md` targets a different folder (`apps/web/src/app`, `src/data`, `features/sky`, `features/queue`, server/CLI/packages) or another epic; nothing targets `apps/web/src/features/toasts/**`.

**C3 wiring:**
1. **Feature registry** (the Wave 3 manifest registry, wherever C3 keeps it):
   ```ts
   import { feature as toastsFeature } from '../features/toasts';

   // overlays observe the whole stream, so mount the host always
   { ...toastsFeature, mount: 'always' as const }
   ```
2. **If the shell renders overlays explicitly** in `apps/web/src/app/Layout.tsx` (outside this lane), place this after the regions, at the top level of the app frame (no transformed ancestor, because the host is `position: fixed`):
   ```tsx
   import { ToastHost } from '../features/toasts';

   <ToastHost
     state={state}
     onSelectTask={actions.selectTask}
     budgetUsd={budgetUsd /* the run/launch cap; omit until the shell has one */}
   />
   ```
3. **Playground route** — `apps/web/src/lib/route.ts`: add `'toasts'` to `PLAYGROUNDS`.
   `apps/web/src/app/PlaygroundHost.tsx`:
   ```tsx
   const ToastsPlayground = lazy(() => import('../features/toasts/Playground'));
   // TITLES: toasts: 'Notifications',
   // switch: case 'toasts': return <ToastsPlayground />;
   ```
   (`TITLES` is `Record<PlaygroundName, string>`, so TypeScript forces the title entry.)
4. *(Optional)* `apps/web/src/App.test.tsx`: add `'toasts'` to the feature-folder smoke list.

**FIX REQUESTS:**
- **Epic 41 / shell (not blocking):** expose the per-run budget cap to the UI so C3 can pass `budgetUsd` to `ToastHost`. Today `SkyState` has no budget field and `/api/config/public` has no cap; without the prop the budget toasts can never fire. Either add the accepted cap to `PublicConfig`/`Run` or pass the launch form value through the shell. No contract change is made here.
- **Epic 112 / shell:** none beyond the registry entry above.

**Deliberately deferred / out of scope:**
- Sound (the Sky owns cues), service-worker/server push, and any store change: toasts are derived from `state.events`.
- Toast for `run.status`, cancellation, or attempt exhaustion; the failure surfaces as a failed audit / failed run.
- Persisting dismissals across reloads; a settings page beyond the bell; click-through on the whole card.
- Playwright/visual coverage of the stack (web e2e lane); component tests assert roles, actions and notification rules.
- A compact/mobile layout: the stack is `min(92vw, 21rem)` and bottom-right at every width.

**Open questions / flagged tradeoffs:**
- **Arrival-time collapse** makes a resumed/backlog batch read as one big "N tasks landed". That is what the demo wants; if a future product prefers each landing named, switch `COLLAPSE_WINDOW_MS` to compare event `ts` (one constant in `queue.ts`).
- **Empty-baseline suppression** trades the first events of a cold start for no storm on a loop. If the shell mounts the host before bootstrapping (likely), this is the right side of the trade.
- **The bell is discoverable only while a toast is visible.** A settings-panel toggle (Epic 112) would be the durable home if users miss it.
- **`bottom-16` assumes the current bottom-strip height.** A measured offset would need a layout token; one class changes it.
- **Budget warnings are per metrics sample.** The queue dedupes by id, so the warn lands once, but a dismissed budget toast can reappear if a later sample crosses a higher threshold (by design: spent is news).
