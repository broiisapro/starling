## Epic 118 Handback — Web: settings drawer (typed, persisted, safe)

**Status:** Complete. Branch `epic/118-web-settings` @ `56fb42c` (docs + this handback on top).
**Delivered:**

- `apps/web/src/features/settings/schema.ts` — `StarlingSettings` (v1), `DEFAULT_SETTINGS` (`dark`,
  `system` motion, sound off, 1×, comfortable, same-origin), `SETTINGS_STORAGE_KEY =
  "starling.settings.v1"`, `parseSettings(raw)` with per-field guards, `mergeSettings`, `sameSettings`,
  option tuples and guards.
- `storage.ts` — `readSettings`, `writeSettings`, `clearSettings`, `readDemoSpeed`; all guarded;
  legacy interop with `lib/theme` (`starling.theme`) and `features/sky` (`starling.sky.sound`);
  demo speed validated with `lib/speed`'s `isDemoSpeed`.
- `apply.ts` — `applySettings` writes `data-theme` (system resolved via `prefers-color-scheme`),
  `data-motion` (`reduced`/`full`, absent for `system`), `data-density` and `color-scheme` on `<html>`.
- `use-settings.ts` — `useSettings()` → `[settings, update(patch)]`, persists on change, applies the
  attributes, re-reads on cross-tab `storage` events.
- `url.ts` — origin-only validation (empty = same origin; rejects non-http(s), credentials, paths,
  query/fragment, over-long values) and `testServerHealth()` (2 s timeout, never rejects).
- `auth.ts` — SEC-01 web half: `normalizeToken` (printable ASCII, ≤ 512, no CR/LF), `authHeaders`,
  `hasToken`, `tokenHint`, `AUTH_HEADER = 'x-flock-token'`.
- `SettingsDrawer.tsx` + `controls.tsx` + `ConnectionSection.tsx` — right-side `role="dialog"`
  `aria-modal`, labelled, focus in/restore, Tab trap, Esc, four groups, reset with confirm, masked token
  with show/hide/Clear, hub Test button, `onSettingsChange?(next)`.
- `index.ts` — `FEATURE = 'settings'`, `feature` manifest (`overlay`, icon `Settings`, hotkey `,`),
  public exports. `Playground.tsx` + `playground.html` + `playground-main.tsx` over the recorded run
  with an event-slice slider and a live JSON view.
- 86 tests in 6 files (`schema`, `storage`, `url`, `apply`, `use-settings`, `drawer`), including the
  DoD corruption case and the focus trap/reset/health paths.

**Key design decisions:**

- **`dark` default, not `system`** — the dashboard is dark-first and the stage is dark; `system` stays
  one click away. `system` never writes the legacy `starling.theme` key because that module cannot
  represent it.
- **Per-field fallback; version mismatch resets the blob** — a corrupt field costs one field, an
  unknown schema costs everything, because guessing new semantics is worse than defaults.
- **Origin-only hub URL** — paths/credentials/query are rejected, not stripped, so a typo cannot
  become a valid-looking URL that 404s. `javascript:`/`data:` are rejected before any request.
- **URL commits on blur/Enter/Test, token commits per keystroke** — validation state is only meaningful
  once the URL is complete; an opaque token must never be lost to a focus change.
- **Not a portal** — the drawer is a fixed-position `<aside>` in the normal tree; `role="dialog"` +
  the focus trap is what assistive tech needs, and it keeps the Playground honest.
- **Hand-written guards, no zod** — the web bundle and the checks are small enough; `parseSettings`
  accepts any `unknown`, including a JSON string, `null` and hostile objects.

**Verification (exact commands + results):**

- `bun install --frozen-lockfile` (worktree): `Checked 172 installs across 225 packages (no changes)` —
  `bun.lock` untouched.
- `cd apps/web && bun test src/features/settings`: **86 pass / 0 fail**, 230 `expect()` calls, 6 files.
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/settings`: `Checked 20 files … No fixes applied`.
- `bash .orchestrator/bin/heavy.sh bun run test` (root): packages **1938 pass / 4 skip / 0 fail**
  (`Ran 1942 tests across 223 files`) and web **667 pass / 0 fail** (`Ran 667 tests across 66 files`).
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 995 files … No fixes applied`; per-workspace
  `tsc --noEmit` loop completed with no errors.
- DoD 4 is a test: `storage.test.ts` writes `{"version":1,"theme":"neon","sound":"yes","density":"compact"}`,
  then asserts `theme === 'dark'`, `sound === false`, `density === 'compact'`, `demoSpeed === 1`.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. `authHeaders` is local to the feature until Epic 204 imports it; no core
type or root config change was needed.

### Carryover done (`.orchestrator/fix-requests-w2.md`)

- **SEC-01 (69, web half): done.** `settings/auth.ts` provides token storage (inside the versioned
  settings blob) and `authHeaders()` → `{ 'x-flock-token': token }` with header-injection-safe
  normalisation. Attaching it to `fetch`/SSE is `apps/web/src/data` (Wave 3b, Epic 204) and is not done
  here; `SettingsDrawer`'s `fetchImpl` prop is the seam for a wrapped client.
- **Everything else: declined — no target file is in this lane.** 47-sky (Sky/layout), 53-web-launch
  (shell/server), 55-web-panels (queue/core), 68-swarm-stats (shell routing), 71-web-e2e (Sky/CI),
  the server halves of 69 (apps/server, packages/flock). None of those files is under
  `apps/web/src/features/settings/**`.

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

### Deliberately deferred / out of scope

- Attaching `authHeaders` to `fetch`/SSE (`apps/web/src/data`, Epic 204) and server-side auth
  (Epic 110).
- CSS for `data-motion` / `data-density` (Epic 112); the attributes are inert until then.
- Shell consumption of theme/speed (step 2 above is the wiring, not this lane).
- Encrypting the token at rest, settings import/export, per-run overrides, a server-side settings store.
- A backdrop/body-scroll lock around the drawer (shell choice; the drawer is self-contained).
- Live OS theme/motion changes after load (they apply on the next `applySettings`/refresh).

### Open questions / flagged tradeoffs

- **SSE cannot carry `x-flock-token`.** When Epic 204 attaches the token, `EventSource` has no header
  API; that lane must use a fetch-based SSE client, a same-origin cookie, or a tokenised query on the
  server. The settings side is ready either way (`authHeaders` is a pure function).
- **The token lives in `localStorage`.** It is masked in the UI and never logged, but a shared browser
  profile shares the token; that is the documented SEC-01 web tradeoff, not something the drawer hides.
- **`theme: 'system'` is settings-only.** Today's `lib/theme` understands dark/light; the drawer shows
  `system` correctly but the top-bar toggle will read the resolved value until C3 unifies them. This is
  intentional to avoid freezing the OS-follow behaviour.
- **`Playground` shows the token in its JSON block.** It is a dev page (Vite/`?playground=`), not the
  dashboard; the drawer itself never renders the token in plain text by default.

Closes #128
