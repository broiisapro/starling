# Epic 118 — Web: settings drawer (typed, persisted, safe)

**Branch** `epic/118-web-settings` · **Lane** `apps/web/src/features/settings/**` · **Issue** #128

## Goal

Give demo day a few knobs without touching code — theme, motion, sound, demo speed, density, which
hub to talk to, and the flock access token — behind one drawer, one typed schema, persisted locally,
and impossible to brick. A corrupted `localStorage` must fall back to defaults field by field, never
to a blank dashboard.

## How it works

```
SettingsDrawer ── useSettings() ── mergeSettings() ── writeSettings()
      │                 │                                  │
      │                 ├── applySettings() → <html data-theme data-motion data-density>
      │                 └── storage event ← another tab
      ├── ConnectionSection ── checkServerUrl() / testServerHealth()
      └── onSettingsChange(next) → shell (C3)
```

- **`schema.ts`** — `StarlingSettings` (versioned, v1), `DEFAULT_SETTINGS`, `parseSettings(raw)`.
  Hand-written guards; no zod in the browser. Accepts `unknown`, including a JSON string, `null`,
  arrays and hostile objects. Every field falls back in isolation; a blob with a different `version`
  is discarded wholesale.
- **`storage.ts`** — `readSettings` / `writeSettings` / `clearSettings` / `readDemoSpeed`, all
  try/catch-guarded. Interops with today's shell: reads the legacy `starling.theme` and
  `starling.sky.sound` keys when the settings blob has no usable value, and mirrors the concrete theme
  and sound back to them on write.
- **`apply.ts`** — `applySettings(settings, doc)` writes `data-theme` (resolving `system` through
  `prefers-color-scheme`), `data-motion` (`reduced`/`full`, absent for `system`) and `data-density`
  on `<html>`, plus `color-scheme`.
- **`use-settings.ts`** — `useSettings()` → `[settings, update(patch)]`. Persists on every change,
  applies the attributes, and re-reads on `storage` events so a second tab follows along.
- **`url.ts`** — origin-only validation (`''` = same origin) and `testServerHealth()` (2 s timeout,
  never rejects).
- **`auth.ts`** — SEC-01's web half: `normalizeToken` (printable ASCII, ≤ 512, no CR/LF),
  `authHeaders(settings)` → `{ 'x-flock-token': token }`.
- **`SettingsDrawer.tsx`** — right-side `role="dialog"` with `aria-modal`, labelled heading, focus
  moved in and restored on close, Tab trapped, Esc → `onClose`, grouped Appearance / Motion & sound /
  Demo / Connection, reset with a confirm step, masked token with show/hide and Clear, and a Test
  button for the hub.
- **`index.ts`** — `FEATURE = 'settings'`, `feature` manifest (overlay, `Settings`, hotkey `,`) and
  the public exports for C3 and Epic 204.
- **`Playground.tsx`** — the drawer over a recorded-run backdrop, an event-slice slider and a live
  JSON view of the stored value.

## Key decisions & reasoning

- **Default theme is `dark`, not `system`.** The dashboard is dark-first and the stage is a dark
  room; `system` as a default would flip a light-mode developer's first run and change the recorded
  demo's look. `system` remains one click away.
- **Per-field fallback, not all-or-nothing.** The DoD case (`{"theme":"neon","sound":"yes"}`) keeps
  the valid fields; only the bad two reset. This is also how a future additive field can be ignored
  by an older parser without wiping the rest.
- **Version mismatch discards the blob; a missing version does not.** A known-missing version is a
  hand-written object (playground/tests) and is treated as v1. A *different* version means the field
  semantics may have changed, so guessing is worse than defaults.
- **Legacy keys are a read fallback and a write mirror, not a second source of truth.** The settings
  blob wins when it has a usable value; `theme: 'system'` deliberately does not write
  `starling.theme` because `lib/theme` cannot represent it and a resolved value would freeze today's
  shell when the OS flips.
- **The server URL is an origin, not a URL prefix.** Paths, query strings, fragments and credentials
  are rejected rather than stripped, because stripping turns a typo (`/api` on the end) into a URL
  that looks valid and 404s every request. Rejecting `javascript:`/`data:` before any request is the
  security half.
- **The URL commits on blur/Enter/Test; the token commits per keystroke.** Committing every URL
  keystroke would clear the field at `h`; the token is opaque and losing a paste is worse.
- **Tokens are normalised on write *and* read.** The value ends up in an HTTP header, so CR/LF and
  control characters are a header-injection vector. `authHeaders` re-normalises rather than trusting
  the caller.
- **The drawer is not a portal.** The shell keeps it in the normal tree with a fixed position and a
  z-index; a portal would complicate the focus-restore contract and the Playground. `role="dialog"`
  plus the focus trap is what assistive tech needs, not the DOM location.
- **A separate `Playground` uses the recorded run, not a fake background.** It makes light/dark and
  the translucent panel judgeable against real content, and it is the same fixture the demo uses.

## Interfaces for future epics

- `StarlingSettings`, `SettingsPatch`, `DEFAULT_SETTINGS`, `parseSettings`, `mergeSettings`,
  `sameSettings`, the option tuples and the guards.
- `readSettings(storage?)`, `writeSettings(next, storage?)`, `clearSettings(storage?)`,
  `readDemoSpeed(storage?)`, `type SettingsStorage`.
- `applySettings(settings, doc?)`, `resolveTheme(theme, doc?)`, `SYSTEM_DARK_QUERY`.
- `authHeaders(settings)` → `{ 'x-flock-token': token }`, `normalizeToken`, `tokenHint`, `hasToken`,
  `AUTH_HEADER`.
- `checkServerUrl`, `normalizeServerUrl`, `healthUrl`, `testServerHealth`.
- `useSettings(options?)`, `SettingsDrawer` + `SettingsDrawerProps`, `feature` manifest.

**C3 wiring** is specified in the handback (boot `applySettings`, overlay mount, playground route and
the registry entry). **Epic 204** attaches `authHeaders(readSettings())` to requests; `EventSource`
cannot set headers, so SSE needs a fetch-based client or a server-side token route — flagged as an
open question, not solved here. **Epic 112** styles `data-motion` and `data-density`; until then the
attributes are inert.

## Deviations from plan

- **86 tests instead of "≥ 30".** The schema/storage/URL matrices and the drawer's focus, reset,
  token and health paths grew naturally; the extra cases are the ones a corruption or a hostile paste
  actually exercises.
- **`onSettingsChange` fires once per accepted change (including a reset), not on first mount.** A
  shell that sets state in response does not get a spurious write at boot.
- **The hook applies the document attributes by default** (`useSettings({ apply: false })` opts out),
  so the drawer works before C3 wires anything. The shell can still call `applySettings(readSettings())`
  at boot for the no-drawer first paint.
- **`ConnectionSection` keeps a URL draft.** The deliverable says changes apply immediately; blur/Enter
  is the point where a URL becomes valid, and Test commits first so a tested URL is the stored one.
- **Extra public helpers** (`sameSettings`, `mergeSettings`, `readDemoSpeed`, `clearSettings`,
  `hasToken`, `tokenHint`, `Section`/`SegmentedRow`/`SwitchRow` internal) are additive; none renamed.

## Known limitations / deferred

- The token is not encrypted at rest; it lives in `localStorage` by design (the note in the drawer
  says so). A shared machine is a shared token.
- `system` motion/theme do not live-update when the OS changes after load; the media query applies on
  the next apply/refresh. `data-motion` is absent for `system`, so CSS handles the common case.
- `testServerHealth` checks `/api/health` only; it does not verify the token (SEC-01's server
  middleware lands with Epic 110/204).
- No settings import/export, no per-run overrides, no server-side settings store.
- `apps/web/src/data` is untouched: attaching `authHeaders` to fetch/SSE (and the SSE header problem)
  belongs to Epic 204. Epic 110 owns server-side auth.
- The drawer sits above the dashboard with a fixed position; the shell owns the backdrop/scroll lock
  if it wants one (the drawer itself does not lock body scroll).
