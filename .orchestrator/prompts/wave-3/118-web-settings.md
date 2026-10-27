# Epic 118: Web: settings drawer (typed, persisted, safe)

**Wave 3 · Branch `epic/118-web-settings` · Issue: `gh issue list --search "Epic 118 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-118-web-settings.md` and `.orchestrator/handbacks/118-web-settings.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **L39 Web feature manifest (new feature folders).** Your folder's `index.ts` exports your components plus one manifest, so C3 can wire about 15 new features with one line each:
  ```ts
  import type { ComponentType } from 'react';
  import type { SkyState } from '../../data/reducer';
  export interface FeatureProps { state: SkyState; onSelectTask?(key: string): void; onSelectRun?(runId: string): void; onClose?(): void }
  export const feature = {
    id: '<folder-name>', title: 'Human title', description: 'One line for the command palette',
    kind: 'view' /* centre view like Sky/DAG */ | 'panel' /* side or bottom panel */ | 'overlay' /* modal, palette, toasts, tour */ | 'page' /* full page at ?page=<id> */,
    icon: '<lucide-react icon name>', hotkey: '<your assigned key or undefined>',
    Component: YourRootComponent as ComponentType<FeatureProps>,
  } as const;
  ```
  Read state only through `FeatureProps` and the existing pure selectors in `apps/web/src/data/selectors.ts` (import, never edit). Build a `Playground.tsx` + `playground.html` (copy the pattern from `features/dag`) so the feature can be seen on its own with `fixtures/runs/*.jsonl` data. Use only the existing design tokens and components (`apps/web/src/components`, `index.css` tokens). Light **and** dark mode, keyboard reachable, `prefers-reduced-motion` respected.
  Hotkeys already taken: `1 2 b f ? Esc` and the arrows. Wave 3 assignments: report `r`, timeline `t`, lanes `l`, costs `c`, console `` ` ``, settings `,`, palette `mod+k`, compare `x`, export `e`, scrubber `.`, heatmap `h`, leaderboard `L`, stage `s`, topology `o`, health `!`. Everything else gets no hotkey.
- **SkyState facts you must design around** (`apps/web/src/data/reducer.ts`, read-only):
  `state.events` holds only the **active run's** events plus global `runId: '*'` flock events, capped at `EVENT_CAP` = 5,000, so every derivation needs a fallback from the `Run`/`TaskRun` snapshots in `state.runs` (`startedAt`, `finishedAt`, `status`, `attempts`, `usage`, `costUsd`, `nodeId`, `lastVerdict`). `state.verdicts` and `state.agentLog` are keyed by **task key only** (not run), so filter them by the active run's task keys. `state.metricsHistory` is not per run. `activeRunOf`, `sortedRuns`, `sortedNodes`, `displayTasks` come from `data/selectors.ts`.
- **Event contract drift.** Epic 40 is adding `'run.status'` to core's `StarlingEvent` union and `nodeName?` to `TaskRun`. Never write an exhaustive `never` switch over `StarlingEvent['type']`: use a `default:` branch, and `isRunStatusEvent` from `../../data/run-status` for run status. Read `nodeName` structurally and fall back to `state.nodes[nodeId]?.name ?? nodeId`.
- **Imports.** Runtime values from `@starling/core/browser` only (`PRICING`, `usageCostUsd`, `globsOverlap`, `matchesGlob`, schemas); `import type` from it for types. Shared helpers: `lib/format` (`formatDuration`, `formatUsd`, `formatTokens`, `percent`; note `cached` is a **subset** of `input` in `TokenUsage`, so a token total is `input + output`, not `totalTokens()`, which adds `cached` too), `lib/status` (`STATUS_COLORS`, `statusLabel`, `taskTone`), `components` (`Panel`, `Stat`, `Badge`, `EmptyState`, `Tabs`, `Tooltip`, `Kbd`), `usePrefersReducedMotion`/`useNow` from `../metrics`. Another feature's helpers only through its `index.ts`.
- **The shell binds your hotkey** (Epic 112's registry, wired at C3). Don't add a document-level `keydown` listener for it; handle keys only while focus is inside your component. Extra props beyond `FeatureProps` must be **optional** (so the `ComponentType<FeatureProps>` cast stays honest); list them under **C3 wiring**. Also export `FEATURE = '<folder>' as const` (the existing folder smoke-test convention).
- **Playground recipe:** `applyEvents(createInitialState(), demoEvents().slice(0, i))` (from `../../data/reducer` and `../../data/demo`) with an event-index range slider, so the feature can be seen mid-run and at the end. Copy `features/dag/{playground.html,playground-main.tsx}`. Put the pure derivation in `derive.ts` (tested without a DOM), and component tests use `ensureDom()` from `../../lib/test-dom` + `@testing-library/react`. Clear `localStorage` after each test that writes it.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **SEC-01 (69, web half):** provide token storage and `authHeaders()`. Attaching it to `fetch`/SSE is in `apps/web/src/data` (Wave 3b, Epic 204): say so in the handback.

## Your lane (you may write ONLY here)
`apps/web/src/features/settings/**`
plus `docs/epic-118-web-settings.md` and `.orchestrator/handbacks/118-web-settings.md`. Read anything.

## Goal
Demo day needs a few knobs without touching code: theme, motion, sound, demo speed, density, which server to talk to, and the access token Epic 110 is adding. One drawer, one typed schema, persisted locally, and impossible to brick: a corrupted `localStorage` must fall back to defaults, never a blank dashboard.

## Deliverables
1. `settings/schema.ts`: `StarlingSettings = { version: 1, theme: 'dark' | 'light' | 'system', motion: 'system' | 'reduced' | 'full', sound: boolean, demoSpeed: 1 | 4 | 16, density: 'comfortable' | 'compact', serverUrl: string, token: string }`, `DEFAULT_SETTINGS`, `parseSettings(raw: unknown): StarlingSettings` (hand-written guards, no zod in `apps/web`; field-by-field fallback so one bad field doesn't reset the rest), `SETTINGS_STORAGE_KEY = 'starling.settings.v1'`.
2. `settings/storage.ts`: `readSettings(storage?)`, `writeSettings(next, storage?)`, both try/catch-guarded (private mode, quota). **Interop with existing keys:** theme also reads/writes `lib/theme` (`readTheme`/`writeTheme`/`applyTheme`, key `starling.theme`), sound reads/writes `features/sky`'s `readSoundEnabled`/`writeSoundEnabled` (key `starling.sky.sound`), demo speed validates with `lib/speed` `isDemoSpeed`, so the settings work with today's shell before C3.
3. `settings/apply.ts`: `applySettings(settings, doc = document)` sets `data-theme` (resolving `system` via `prefers-color-scheme`), `data-motion="reduced|full"` (absent for `system`) and `data-density` on `<html>`. Epic 112 adds the CSS for `data-motion`/`data-density` in parallel; until then the attributes are harmless.
4. `useSettings()`: hook returning `[settings, update(patch)]`, syncs across tabs via the `storage` event.
5. **Server URL:** accept '' (same origin) or an absolute `http(s)://` URL with no path tricks (`new URL` parse, reject `javascript:`/`data:`/credentials in the URL), shown with a "Test" button calling `${serverUrl}/api/health` through an optional `fetchImpl` prop (2 s timeout; shows ok/failed, never throws).
6. **Token:** masked input with show/hide, "stored only in this browser" note, Clear button, never logged or rendered in plain text by default. Export `authHeaders(settings): Record<string, string>` (`{ 'x-flock-token': token }` when set, per SEC-01's header) for C3 and Epic 204 to use.
7. `SettingsDrawer` (kind `overlay`): right-side drawer (`role="dialog"`, `aria-modal`, labelled), focus moves in on open and returns on close, Tab is trapped, Esc → `onClose`. Grouped sections: Appearance (theme, density), Motion & sound, Demo (speed), Connection (server URL, token). "Reset to defaults" with a confirm. Changes apply immediately and call an optional `onSettingsChange?(next)` prop (C3 wires it to the shell's theme/speed state).
8. `index.ts` manifest: id `settings`, kind `overlay`, icon `Settings`, hotkey `,`. Export the schema, storage, apply and `authHeaders` helpers. Playground showing the drawer over a sample background with a live JSON view of the stored value.
9. Tests: ≥ 20 schema/storage tests (defaults, each field's fallback, corrupted JSON, wrong version, throwing storage, legacy theme/sound keys honoured, URL validation table incl. hostile values) and ≥ 10 component tests (focus trap, Esc, theme change applies `data-theme`, token masked by default, reset, health test ok/failed with a fake fetch).

## Explicitly out of scope
- Editing `lib/theme.ts`, `app/*` or the data layer to *consume* the settings (C3 / Epic 112 / Epic 204). Sending the token on requests (Epic 204). Server-side auth (Epic 110).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/settings` → 0 fail, ≥ 30 new tests
3. `bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/settings` clean
4. A test writes `{"version":1,"theme":"neon","sound":"yes"}` to storage and `readSettings()` returns defaults for those two fields and keeps the rest
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-118-web-settings.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/118-web-settings.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/118-web-settings`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
