# Wave 3a harvest: C3 wiring + FIX REQUESTS + CONTRACT REQUESTS (extracted from handbacks)


## Epic 102 (102-perch-hardening.md)

**CONTRACT REQUESTS:** none. The new surface is additive inside `@starling/perch`; the locked Perch API gains only `GET /perch/health`, documented in the epic doc.

**C3 wiring** (what checkpoint C3 must add; `apps/cli` is Wave 3b / Epic 203):

1. `apps/cli/src/real/perch-compose.ts` — carry the new options through:
   ```ts
   export interface PerchFlagOptions { /* … */ mdnsCode?: boolean; drainTimeoutMs?: number }
   export interface PerchComposeInput { /* … */ advertiseCode: boolean; drainTimeoutMs?: number }
   // perchComposeInput(): return { ..., advertiseCode: flags.mdnsCode === true, ...(flags.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: flags.drainTimeoutMs }) }
   // perchComposeOptions(): ...(input.advertiseCode ? { advertiseCode: true } : {})
   ```
2. `apps/cli/src/program.ts`, `register('perch', …)` registration (around `:186-197`) — two flags:
   ```ts
   .option('--mdns-code', 'publish the join code in the mDNS TXT record (default: off)')
   .option('--drain-timeout <ms>', 'how long SIGTERM waits for the hub before aborting', parsePositiveInt)
   ```
3. `apps/cli/src/commands/perch.ts` — pass the option into `perchComposeInput(...)` (`advertiseCode: options.mdnsCode === true, drainTimeoutMs`) and replace `await perch.stop()` in `shutdown()` with:
   ```ts
   const timeoutMs = readNumber(options, 'drainTimeout', undefined);
   const report = await perch.drain(timeoutMs === undefined ? {} : { timeoutMs });
   context.write(
     palette.dim(`drained: ${report.finished.length} finished, ${report.aborted.length} aborted in ${report.waitedMs} ms`),
   );
   ```
   (`shutdown` is already called for SIGINT/SIGTERM; `drain()` also stops the daemon and closes the runner, so no second `stop()` is needed.)
4. Optional: print `${perch.handle.url}/perch/health` in the roosting banner, and mention `--mdns-code` in `starling perch`'s no-hub help text.
5. Nothing to add to `apps/server` or any registry: heartbeats already carry `maxSessions = activeSessions` while draining and the scheduler's `maxSessions - activeSessions` picks that up unchanged.

**FIX REQUESTS:**
- `docs/epic-31-perch.md` (cross-epic docs, orchestrator-owned): the HTTP table should gain the row `GET /perch/health → PerchHealth (200 ok / 503 degraded or draining; token required)`; step 4 of "The daemon" says "Advertises `_starling._tcp` with the join code and node name", which is now wrong (TXT is `{ node }` unless `advertiseCode`/`--mdns-code`); the body-parsing paragraph should note the 256 KiB `payload-too-large` limit, the hostile-ref/id validation (`invalid-body`/`invalid-params`) and the `PerchApp` methods `setDraining`/`isDraining`/`drainTasks` plus `PerchHandle.drain` and heartbeat jitter. Point it at `docs/epic-102-perch-hardening.md` for details.


## Epic 103 (103-auditor-r2.md)

**C3 wiring:** none. `packages/auditor/src/index.ts` is inside this lane, so the new exports (`canonicalLanePath`, `CommandPolicy`/`evaluateCommand`/`scrubbedEnv`/`DEFAULT_ALLOWED_COMMANDS`, `explainVerdict`/`formatVerdictExplanation`) are already public. No route, CLI flag, `App.tsx`, `program.ts`, `app.ts` or layout change is needed.

**FIX REQUESTS:**
1. **`packages/core/src/glob.ts` (Epic 202, Wave 3b).** Add a canonicalising helper next to `normalizeGlobPath` and use it in `matchesGlob`/`matchesAny` (or expose a strict `matchLanePath` used by the auditor):
   ```ts
   import { posix } from 'node:path';
   export type GlobPathProblem = 'traversal' | 'absolute' | 'invalid';
   export interface CanonicalGlobPath { path: string; problem?: GlobPathProblem }
   export function canonicalGlobPath(raw: string): CanonicalGlobPath {
     const slashed = raw.replace(/\\/g, '/');
     const normalized = normalizeGlobPath(raw);
     if (normalized === '' || slashed.includes('\0')) return { path: normalized, problem: 'invalid' };
     if (posix.isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed))
       return { path: posix.normalize(normalized), problem: 'absolute' };
     if (slashed.split('/').includes('..'))
       return { path: posix.normalize(normalized), problem: 'traversal' };
     return { path: posix.normalize(normalized) };
   }
   ```
   Then `matchesGlob` returns `false` for a problem path (and `globsOverlap` may normalise its inputs the same way). Tests already exist in `packages/auditor/src/lane.test.ts` to port; when it lands, the auditor's local copy should delegate and `LanePathProblem` can alias the core type.
2. **`packages/engine` / Epic 100 + `apps/cli/src/compose.ts` (Epic 40).** Fill `TaskRun.worktreePath` for every dispatched task (the core schema already has the field), then pass `requireWorktree: true` at the composition root. Also construct the auditor as `createAuditor({ llm: 'auto', bus, commandPolicy, requireWorktree })`; if config gains an `auditor.commandPolicy` key (nested under `auditor`, mirroring the type) and a `starling run --no-tests` flag, map the flag to `{ mode: 'off' }`. CLI/config changes are not this lane.
3. **`packages/merger` (Epic 104).** The merger's regression suite is the other repo-provided `sh -c` site (`packages/merger/src/suite.ts`). Per the brief it keeps its own copy of the policy table — do not import `@starling/auditor`; mirror `CommandPolicy`/`DEFAULT_ALLOWED_COMMANDS` and, at minimum, adopt `scrubEnv` semantics so a merge-gate command does not inherit `DEEPSEEK_API_KEY` either.


## Epic 107 (107-planner-r2.md)

**CONTRACT REQUESTS:** none.

**C3 wiring:** none. This epic is a self-contained package module; all new surface is exported from `packages/planner/src/index.ts` (which the planner lane owns) and needs no change to `App.tsx`, `Layout.tsx`, `program.ts` or `app.ts`.

**FIX REQUESTS:** none.


## Epic 109 (109-prompts-r2.md)

**C3 wiring:** none. `packages/prompts/src/index.ts` is inside this lane and already exports every new symbol; no shared registration file, app shell, CLI `program.ts` or server `app.ts` change is needed.

**FIX REQUESTS:** none. Epic 157 can assert on the stable `<untrusted source="…">` / `</untrusted>` pair; `detectInjectionMarkers` is exported for its tripwire comparison.

**CONTRACT REQUESTS:** none.


## Epic 113 (113-web-report.md)

**C3 wiring (exact):**
1. Feature registry (Epic 112's registry file, wherever it declares the manifest array):
   ```ts
   import { feature as report } from '../features/report';
   // add `report` to the registry array — it is a `kind: 'page'`, hotkey `r`, icon `FileText`.
   ```
2. Page route in the shell (Epic 112 / `apps/web/src/App.tsx` page switch). `fetchImpl` is optional:
   with it, a live hub merges Epic 111's report; without it the page derives everything locally.
   ```tsx
   import { ReportPage } from './features/report';
   // …inside the `?page=` switch:
   case 'report':
     return (
       <ReportPage
         state={state}
         onSelectTask={(key) => skyActions.selectTask(key)}
         onSelectRun={(id) => skyActions.setActiveRun(id)}
         fetchImpl={hubFetch /* Epic 110's token-aware fetch */}
       />
     );
   ```
3. Playground route: add `'report'` to `PLAYGROUNDS` in `apps/web/src/lib/route.ts`, and in
   `apps/web/src/app/PlaygroundHost.tsx` add a lazy branch + `TITLES` entry:
   ```ts
   const ReportPlayground = lazy(() => import('../features/report/Playground'));
   ```
   The playground file itself is `src/features/report/playground.html` (Vite dev).
4. Hotkey `r`: bound by Epic 112's registry; the component deliberately adds no document listener.
5. Nothing else: `ReportPage`'s extra props (`fetchImpl`, `now`) are optional, so the
   `ComponentType<FeatureProps>` cast stays honest.

**CONTRACT REQUESTS:** none (no core/contract change needed). Two FIX REQUESTS:
1. **Epic 111 (`apps/server` + `packages/engine`): `GET /api/runs/:id/report` shape I coded against.**
   The client merges these top-level fields when present and valid; everything else stays local:
   ```ts
   {
     runId: string,                       // must equal the requested id, else ignored
     goal?: string, status?: RunStatus, outcome?: 'landed'|'partial'|'failed'|'in-flight'|'cancelled',
     tasks?: { total, merged, failed, conflict, cancelled, inFlight },   // all numbers
     wallMs?, flightWindowMs?, serialMs?, savedMs?, speedup?, costUsd?, savedUsd?, localCalls?: number,
     tokens?: { api?: TokenUsage, local?: TokenUsage },
     nodes?: NodeContribution[], verdicts?: NotableVerdict[], story?: StoryBeat[],
     summary?: string, estimated?: string[]
   }
   ```
   `NodeContribution = { nodeId, name, tasks, merged, flightMs, costUsd, migratedIn, migratedOut }`;
   `StoryBeat = { at /* ms since run start */, kind, text, taskKey? }`. Respond 501/404 until ready —
   the page falls back silently. If 111 prefers different names, reconcile in `live.ts` only
   (`mergeServerReport` is the single place).
2. **Epic 41 / data layer:** `state.verdicts` and `state.agentLog` are keyed by task key only, and
   `state.events` only holds the active run. Keying verdicts by `runId:taskKey` (the event has
   `runId`) and keeping a small per-run event tail would let the report page show story, summary and
   verdicts for a run selected from the picker (today: counters/money only). Out of this lane.


## Epic 115 (115-web-lanes.md)

**CONTRACT REQUESTS:** none. The view reads `SkyState`, `PlanIssue`, `TaskSpec`, `MergeResult` and `AgentEvent` from `@starling/core/browser`; no core shape was missing. Optional `LaneNode` extras are local to this feature.

**C3 wiring (exact code C3 must add):**
1. **Feature registry** (Epic 112 registry; path per that epic) — one import and one array entry:
   ```ts
   import { feature as lanes } from '../features/lanes';
   // register alongside the other L39 manifests:
   export const FEATURES = [/* …existing… */, lanes];
   ```
   The registry's hotkey binder then makes `l` select it. No store access is needed: `feature.Component` takes `FeatureProps`.
2. **`apps/web/src/app/Layout.tsx`** — extend `CentreView` and render the centre view from the registry (or the one-line equivalent until the registry lands):
   ```tsx
   import { LanesView } from '../features/lanes';
   // CentreView = 'sky' | 'dag' | 'lanes'
   {view === 'lanes' ? (
     <LanesView state={state} onSelectTask={actions.selectTask} />
   ) : view === 'dag' ? (
     /* existing DAG branch */
   ) : (
     /* existing Sky branch */
   )}
   ```
3. **`apps/web/src/app/TopBar.tsx`** — add a centre-view tab if C3 keeps the explicit tab list:
   ```ts
   { id: 'lanes', label: 'Lanes', badge: <span aria-hidden="true"><Kbd size="sm">l</Kbd></span> }
   ```
4. **`apps/web/src/lib/route.ts`** — add `'lanes'` to `PLAYGROUNDS`; **`apps/web/src/app/PlaygroundHost.tsx`** — add the lazy branch:
   ```ts
   const LanesPlayground = lazy(() => import('../features/lanes/Playground'));
   // TITLES: lanes: 'Lanes'
   case 'lanes': return <LanesPlayground />;
   ```
   The standalone Vite page `src/features/lanes/playground.html` already works without any shell change.

**FIX REQUESTS:** none.


## Epic 118 (118-web-settings.md)

**CONTRACT REQUESTS:** none. `authHeaders` is local to the feature until Epic 204 imports it; no core
type or root config change was needed.

### C3 wiring (exact code)

1. **Boot the stored appearance before the shell's first paint** — `apps/web/src/app/AppShell.tsx`:

   ```tsx
   import { applySettings, readSettings, SettingsDrawer } from '../features/settings';
   // inside AppShell():
   const [settingsOpen, setSettingsOpen] = useState(false);
   useEffect(() => {
     applySettings(readSettings());
   }, []);
   ```

2. **Mount the overlay and forward changes** — same file, wrap the existing `<Layout …>` return:

   ```tsx
   return (
     <>
       <Layout /* …unchanged props… */ />
       {settingsOpen ? (
         <SettingsDrawer
           onClose={() => setSettingsOpen(false)}
           onSettingsChange={(next) => {
             applySettings(next);
             setTheme(
               next.theme === 'system'
                 ? document.documentElement.dataset.theme === 'light'
                   ? 'light'
                   : 'dark'
                 : next.theme,
             );
             if (next.demoSpeed !== speed && state.connection === 'demo') changeSpeed(next.demoSpeed);
           }}
         />
       ) : null}
     </>
   );
   ```

   If Epic 112's registry owns overlays instead, replace step 2 with the registry entry in step 4 and
   call `setSettingsOpen(true)` from the registry selection; keep step 1 either way.

3. **Playground route** — `apps/web/src/lib/route.ts`: add `'settings'` to `PLAYGROUNDS`.
   `apps/web/src/app/PlaygroundHost.tsx`:
   ```tsx
   const SettingsPlayground = lazy(() => import('../features/settings/Playground'));
   // TITLES: settings: 'Settings',
   // renderPlayground switch: case 'settings': return <SettingsPlayground />;
   ```

4. **Registry (Epic 112)** — add the manifest; the hotkey comes with it:

   ```ts
   import { feature as settingsFeature } from '../features/settings';
   // features.push(settingsFeature);  // id 'settings', kind 'overlay', hotkey ','
   ```

No other registration file is required. `SettingsDrawer`'s only non-`FeatureProps` props
(`onSettingsChange`, `fetchImpl`, `storage`, `className`) are optional.

### FIX REQUESTS

- none.


## Epic 119 (119-web-tour.md)

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

**FIX REQUESTS:**

1. **Epic 112 (`apps/web/src/app/TopBar.tsx` / the new views menu):** keep `data-shell="views-menu"` on the menu trigger. The tour's 7th page anchors to it; if the attribute is renamed, change `TOUR_STEPS[6].anchor` (one line, this lane) and nothing else.
2. **Epic 41 (`apps/web/src/app/Layout.tsx`):** the shell's document-level keydown handler must early-return while the tour is open (line in **C3 wiring**). The overlay stops the keys it owns (arrows, Enter, Esc), but `1`/`2`/`b`/`f` typed inside the dialog would still rearrange the dashboard behind it.
3. **Epic 41 (`apps/web/src/lib/route.ts`), optional:** parse `tour` into `SkyRoute` (`tour?: boolean`) so the shell does not read `window.location.search` itself. `shouldAutoStartTour` takes any search string, so this is polish, not a blocker.
4. **Epic 41/112:** if a shared modal layer adds `inert` to the app while an overlay is open, list the tour as a modal (it is `role="dialog"` + `aria-modal="true"`); the tour does not inert the page behind it itself.


## Epic 120 (120-web-palette.md)

**CONTRACT REQUESTS:** none.

**C3 wiring** — exact additions (all shell-owned files; the palette folder is self-contained until then):

1. `apps/web/src/lib/route.ts` line 12 — add `'palette'` to the tuple:
   ```ts
   export const PLAYGROUNDS = ['sky', 'dag', 'agents', 'queue', 'metrics', 'flock', 'palette'] as const;
   ```
2. `apps/web/src/app/PlaygroundHost.tsx` — one lazy import, one title, one switch arm:
   ```tsx
   const PalettePlayground = lazy(() => import('../features/palette/Playground'));
   // TITLES: add
   palette: 'Command palette',
   // renderPlayground switch: add
   case 'palette':
     return <PalettePlayground />;
   ```
3. `apps/web/src/App.test.tsx:44` — add `'palette'` to the `features` array (the folder smoke test's hard-coded list).
4. Shell / Epic 112 registry — register the manifest and let the existing registry bind `mod+k` and mount `kind: 'overlay'`:
   ```ts
   import { feature as paletteFeature } from '../features/palette';
   // manifests.push(paletteFeature);  // hotkey 'mod+k', Component: CommandPalette
   ```
   Render it with the shell's `props(shell)` helper. Passing the optional props makes the Views/Commands groups appear:
   ```tsx
   <paletteFeature.Component
     {...props(shell)}
     features={registry.manifests}                 // L39 manifests; PaletteFeature is a structural subset
     commands={[{ id: 'theme', label: 'Toggle light or dark theme', hotkey: 't', run: toggleTheme }]}
     onOpenFeature={(id) => openFeature(id)}
   />
   ```
   `onClose` must clear the shell's overlay state; `onSelectTask` / `onSelectRun` already come from the shell's props helper.

**FIX REQUESTS:** none. Nothing outside `apps/web/src/features/palette/**` was modified.


## Epic 121 (121-web-toasts.md)

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


## Epic 122 (122-web-compare.md)

**C3 wiring (exact code):**

```tsx
// apps/web/src/app/AppShell.tsx — after every hook, before the playground branch
import { ComparePage } from '../features/compare';

const page = new URLSearchParams(globalThis.location.search).get('page');
if (page === 'compare') {
  return (
    <ComparePage
      state={state}
      onSelectRun={(runId) => useSky.getState().setActiveRun(runId)}
      fetchImpl={(input, init) => fetch(input, init)} // replace with Epic 110's authed client
    />
  );
}
```

```ts
// apps/web/src/lib/route.ts
export const PLAYGROUNDS = ['sky', 'dag', 'agents', 'queue', 'metrics', 'flock', 'compare'] as const;
```

```tsx
// apps/web/src/app/PlaygroundHost.tsx
const ComparePlayground = lazy(() =>
  import('../features/compare').then((m) => ({ default: m.Playground })),
);
// TITLES: compare: 'Compare runs'
// switch (name): case 'compare': return <ComparePlayground />;
```

The `x` hotkey comes from the `feature` manifest and is bound by Epic 112's registry; the page adds no document-level key listener.

**CONTRACT REQUESTS:** none. No core, port, root-config or dependency change is needed; the baseline marker is local/structural.

**FIX REQUESTS:**
1. **Epic 111 (`apps/server`)** — publish `GET /api/compare?a=&b=` with the shape above (or tell C3 the final shape). If the route returns whole `Run` snapshots for runs whose `RunStats` lack task timings, add that arm to `parseComparePayload` in `api.ts`; today it accepts `{a,b,rows}` only.
2. **C3 / shell** — wire the page and playground as shown. `?page=compare` is not read by `lib/route.ts` today; the page self-parses `?a=&b=` but not `?page=`.
3. **Epic 112 (hotkey registry)** — bind `x` from the `feature` manifest; the folder deliberately exposes it but does not listen globally.


## Epic 124 (124-web-scrubber.md)

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

**CONTRACT REQUESTS:** none (no core/root changes needed; `run.status` is read structurally).

**FIX REQUESTS:**
- none.


## Epic 126 (126-web-leaderboard.md)

**CONTRACT REQUESTS:** none. Epic 40's `TaskRun.nodeName` is read structurally (`nodeName ?? state.nodes[id]?.name ?? id`) and needs no further change.

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


## Epic 150 (150-ci-r2.md)

**C3 wiring:** none. No shared registration file, manifest or export barrel changes: workflows are self-contained and `.github/workflows/scripts/*.ts` are run directly by CI.

**FIX REQUESTS:**

1. **Epic 140 (`apps/web` e2e owner)** — add `apps/web/e2e/tsconfig.json` so the conditional CI typecheck starts covering the Playwright suite (the workflow step already picks it up automatically). Suggested: `{"extends": "../../tsconfig.base.json", "include": ["**/*.ts", "../playwright.config.ts"], "compilerOptions": {"types": ["bun", "@playwright/test"]}}` (verify the `types` entry against the Playwright typings). Also settle per-platform snapshot directories so the suite can drop `continue-on-error` in `e2e.yml`.
2. **Orchestrator (repo setting, not a file)** — enable GitHub Pages with "GitHub Actions" as the source before `pages.yml` can deploy, and mark `lint + typecheck`, `test (ubuntu-latest)`, `test (macos-latest)`, `build apps/web` as required checks on `main`.
3. **Epic 160 (docs hygiene)** — when the deeper checker lands, either extend the `docs-links` job or replace it; keep the job name and `continue-on-error` off only once the link set is clean on `main`.


## Epic 151 (151-packaging.md)

**C3 wiring:** none required. This epic exports no package entry and touches no shared registration
file; both scripts run standalone. If C3 wants convenience scripts, the exact addition to root
`package.json#scripts` is:
```json
"release:build": "bun tools/release/build.ts",
"release:dry-run": "bun tools/release/dry-run.ts"
```
and, to have `bun run check` cover this lane, extend the root `typecheck` loop from
`for d in packages/* apps/*` to `for d in packages/* apps/* tools/*` (or add a `tools/release` line).

**FIX REQUESTS:**
1. **Epic 203 / `apps/cli` — resolve the dashboard from the install layout.** `apps/cli` (Epic 40's
   `real/dashboard.ts` / `resolveWebDist`, not present in this worktree yet) must look in this order:
   `process.env.STARLING_WEB_DIST`, then `<dirname(process.execPath)>/../share/starling/web`, then
   the current source-tree `apps/web/dist`. The tarball already ships the second path; without this,
   a compiled binary cannot serve the dashboard. Sketch:
   ```ts
   const fromEnv = process.env.STARLING_WEB_DIST;
   if (fromEnv) return fromEnv;
   const besideBinary = join(dirname(process.execPath), '..', 'share', 'starling', 'web');
   if (existsSync(join(besideBinary, 'index.html'))) return besideBinary;
   return join(import.meta.dir, '../../../web/dist');
   ```
2. **Epic 203 / `apps/cli/src/program.ts` — `program.version()` should read the baked value.**
   Today line 83 is `.version('0.0.0', …)`, so a `v0.1.0` release prints `0.0.0`. Change to
   `.version(process.env.STARLING_VERSION ?? '0.0.0', …)`; `build.ts` already passes
   `--define process.env.STARLING_VERSION`.
3. **Integrator / root `package.json` — let `bun run check` typecheck `tools/*`.** `tools/release`
   passes `bunx tsc --noEmit -p tools/release` but the root loop only covers `packages/*` and
   `apps/*`, so this new lane is unguarded in CI until the workspace/typecheck change lands.
4. **Future release-automation epic — upload, do not rebuild per platform.** A tag workflow should
   run `bun run --cwd apps/web build` once, then `bun tools/release/build.ts --target all --skip-web`
   on one GNU-tar runner, and upload `dist/*.tar.gz`, `SHA256SUMS`, `manifest.json`, `starling.rb`
   with `gh release create`. Publishing is deliberately not in this lane.


## Epic 152 (152-installer.md)

**C3 wiring:** none. `tools/install/` is self-contained; no shared registration file (`apps/cli/src/program.ts`, `apps/server/src/app.ts`, package `index.ts`) needs an entry. The README quickstart link for Epic 172 is documented in `tools/install/README.md`.

**CONTRACT REQUESTS:** none.

**FIX REQUESTS:**
1. **Root `package.json` (`typecheck` script) + `tools/install` (integrator / Epic 40's lane).** A
   repeat of the `tools/stats` gap: `"typecheck": "for d in packages/* apps/*; do …"` does not
   typecheck `tools/*`, so this lane is checked with `bunx tsc --noEmit -p tools/install` only.
   Minimal fix, add-only:
   ```json
   "typecheck": "for d in packages/* apps/* tools/*; do tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done"
   ```
   (`tools/flock`, `tools/load`, `tools/local-models`, `tools/security`, `tools/stats`,
   `tools/stress`, `tools/github-sandbox` and `tools/install` all have a `tsconfig.json`; each was
   green when last run. `tools/fully-open` has none and would need excluding.)


## Epic 153 (153-devcontainer.md)

**CONTRACT REQUESTS:** none. No core contract, port, event or config change was needed; the demo composes the existing server entry and a local copy of the read-only `EngineApi`.

**C3 wiring:** none. Every file is self-contained: the Dockerfile, `.dockerignore` and `.devcontainer/` are read by Docker/VS Code, `tools/docker/**` is run by the root `bun test` glob (`tools`) without any registration, and no shared `index.ts`, `app.ts`, `program.ts`, `App.tsx` or `Layout.tsx` was touched. Nothing needs adding to a shared file for this PR to take effect.

**FIX REQUESTS:**
1. **Root `package.json` — typecheck `tools/*` (owner: integrator / Epic 40 root config).** `"typecheck": "for d in packages/* apps/*; do tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done"` silently skips every tool harness, including `tools/docker` (this PR) and `tools/security` / `tools/load` (Wave 2). Suggested:
   ```json
   "typecheck": "for d in packages/* apps/* tools/*; do [ -f \"$d/tsconfig.json\" ] || continue; tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done"
   ```
   Why: `tools/docker` is typechecked in this handback by hand (`bunx tsc --noEmit -p tools/docker`, clean); without the loop a future edit can rot it while `bun run check` stays green. The `[ -f ]` guard keeps `tools/` directories without a tsconfig (e.g. `tools/local-models`) harmless.
2. **`apps/server` — export the demo composition (owner: apps/server, Epic 110 follow-up).** `apps/server/src/dev.ts` defines `createDemoEngine` and `runDemoServer` but `src/index.ts` re-exports neither, so this lane copies 10 lines into `tools/docker/demo.ts`. Suggested additive change: `export * from './dev';` in `apps/server/src/index.ts`, or a `runDemoServer` option `{ webDist?: string; hostname?: string }` so the Docker demo and `bun run dev` share one implementation. Also worth doing in the same pass: Epic 110's switch of `startServer`'s default `hostname` to loopback must keep an explicit override (the demo passes `0.0.0.0` and will be fine).


## Epic 167 (167-shell-prompt.md)

**CONTRACT REQUESTS:** none. Every field the segment needs (`Run.status`, `Run.startedAt`,
`Run.finishedAt`, `Run.tasks[].status`) is already in the locked contract; no core, config or root file was
touched.

**C3 wiring:** none. This epic ships a self-contained module under `integrations/shell/` (plus its own
tsconfig and README). No `App.tsx`, `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`,
`index.ts`, `package.json`, root config or CI file needs a line from C3.

**FIX REQUESTS:**
- **`apps/cli` (Wave 3b, Epic 203): add a `starling prompt` subcommand.** Thin wrapper around
  `integrations/shell/starling-prompt.ts` (`starling prompt [--refresh] [--ascii] [--style …] [--server …]`).
  Because `integrations/` is not a Bun workspace member, the clean form is a spawn of the shim (or a shared
  `packages/prompt` later); the flags and behaviour are documented in `docs/epic-167-shell-prompt.md`
  §Interfaces. Optional bonus: `starling doctor` printing the resolved cache path and whether the segment
  is stale.
- **Root `README.md` (Epic 60 lane): link the shell prompt.** One line under the quickstart, e.g.
  "**In your shell prompt:** `🐦 12/30` while a run is flying — see `integrations/shell/README.md`."
  Outside this lane, so not edited here.
