## Epic 120 Handback — Web: command palette (⌘K)

**Status:** Complete. Branch `epic/120-web-palette` @ `e52cb5a` (code head; this doc and handback land on top). Issue #130.

**Delivered:**

- `apps/web/src/features/palette/fuzzy.ts` — `fuzzyScore(query, text)` (DP best-alignment subsequence matcher, word-start/prefix/consecutive bonuses, half-open merged ranges) and `rankItems(query, items, limit = 50)` with hint/keyword weighting and deterministic label→id tie-break.
- `apps/web/src/features/palette/items.ts` — `PaletteItem`, `PaletteFeature`, `PaletteCommand`, and the builders `taskItems`, `runItems`, `featureItems`, `commandItems`, `recentItems`.
- `apps/web/src/features/palette/recent.ts` — guarded `localStorage['starling.palette.recent.v1']` store: `readRecent`, `writeRecent`, `recordRecent` (move-to-front, de-dupe, cap 8), `pruneRecent`, `parseRecent`.
- `apps/web/src/features/palette/derive.ts` — `collectItems`, `groupResults` (Recent-first on empty query; group order Commands → Views → Tasks → Runs; 50-row cap), `flattenGroups`, `rangesFor`.
- `apps/web/src/features/palette/CommandPalette.tsx` — the `overlay` dialog: ARIA combobox/listbox/group/option pattern, ↑/↓ wrap, Home/End, Enter runs then closes, Esc closes, Tab trapped, live result count, `<mark>` highlights, `Kbd` hotkey hints, empty state, focus restore, reduced-motion aware, max 50 rows.
- `apps/web/src/features/palette/hotkey.ts`, `icons.tsx` — `mod+k` → `⌘K`/`Ctrl K` display; fixed lucide map with a `Command` fallback (no `import *`).
- `apps/web/src/features/palette/index.ts` — `FEATURE = 'palette'` and the L39 manifest (`kind: 'overlay'`, icon `Command`, hotkey `mod+k`, `Component: CommandPalette`) plus all pure exports.
- `Playground.tsx` / `playground.html` / `playground-main.tsx` — fixture replay with an event slider, the 15 Wave 3 manifest stand-ins, live commands (theme, demo speed, clear recents) and a pick log.
- 63 tests across 4 files (fuzzy 19, items/recents/groups/hotkey 28, component 13, manifest 3) including the literal DoD case: typing `csv` over the recorded state puts **CSV export** on top and Enter calls `onSelectTask('csv-export')` then `onClose`.

**Key design decisions:**

- **DP alignment instead of a greedy scan** — the greedy matcher ranks the scattered `a/x/b/x/c` over a consecutive tail; the DP is O(text × query) and still trivial for 500 tasks. Consequence: ranking is best-match, not first-match.
- **Half-open `[start, end)` ranges** and **label-only ranges** — unambiguous for `slice`, and a keyword/hint win never highlights text that is not rendered.
- **Tie-break by lower-cased label then id** (never locale) so equal scores are stable across machines and test runs.
- **Recents store item ids, pruned lazily** — titles/goals change between runs; unknown ids are skipped when building the list and cleaned up on the next pick, keeping derivation pure.
- **Optional handlers and structural feature type** — `onSelectTask`/`onSelectRun`/`onOpenFeature` are optional so the `ComponentType<FeatureProps>` cast is honest and the playground/tests can mount the palette bare; `PaletteFeature` is a subset of L39 so registry manifests pass through.
- **No document-level keydown listener** — the shell registry binds `mod+k` from the manifest (avoids a double toggle); the component only handles keys while its input is focused.
- **50-row cap at rank time** — the brief's cap doubles as the render budget; no virtualisation below that threshold.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 172 installs across 225 packages (no changes)` — `bun.lock` untouched, `git status` shows only the lane.
- `cd apps/web && bun test src/features/palette`: `63 pass / 0 fail`, `166 expect() calls`, `Ran 63 tests across 4 files`.
- `bunx tsc --noEmit -p apps/web`: clean (no output).
- `bunx biome check apps/web/src/features/palette`: `Checked 18 files … No fixes applied`, exit 0.
- DoD 4: `typing csv puts the csv-export task on top; Enter selects it and closes` — passes; asserts `calls === ['task:csv-export', 'close']`.
- `bash .orchestrator/bin/heavy.sh bun run test` (repo root): packages `1938 pass / 4 skip / 0 fail` (`Ran 1942 tests across 223 files`), web `644 pass / 0 fail` (`Ran 644 tests across 64 files`).
- `bash .orchestrator/bin/heavy.sh bun run check`: `biome check .` → `Checked 993 files … No fixes applied`; per-workspace `tsc --noEmit` loop exited 0 with no diagnostics.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none.

**Carryover done** — `.orchestrator/fix-requests-w2.md`, every request checked; **none targets `apps/web/src/features/palette/**`** (the folder is new in Wave 3). Declined, one line each:

- 41.1 root `package.json` dev:live — root config, outside lane.
- 41.2 engine publishes collected diff — `packages/engine`.
- 41.3 Sky `paused` — `features/sky`.
- 41.4 queue `selectedTask` highlight — `features/queue`.
- 41.5 engine publishes `run.status` — `packages/engine`.
- 42.1 flock heartbeat 404 — `apps/server`.
- 42.2 scheduler double-booking — `packages/engine`.
- 42.3 hub node liveness — `apps/server`.
- 42.4 `flock --hub` flag — `apps/cli`.
- 42.5 terminal QR — `apps/cli`.
- 42.6 real flock smoke + fixture — CLI/server/flock.
- 43 engine tracker fields — `packages/engine`.
- 43 CLI `--github` composition — `apps/cli`.
- 43 demo-repo script — `examples/scripts` (no change needed).
- 44.1 `evals/real.ts` auditor instantiation — `evals`.
- 44.2 `tools/local-models/recommend.ts` profile filter — `tools`.
- 44.3 CLI auditor construction — `apps/cli`.
- 45.1–45.4 resolver engine hook — `packages/engine`.
- 47.1 core `SkyViewProps.paused` — `packages/core`.
- 47.2 Layout passes `paused` — `apps/web/src/app`.
- 47.3 Layout forwards toasts — `apps/web/src/app`.
- 48 `packages/llm/src/env.ts` opencode discovery — `packages/llm`.
- 49.1 core `run.status` + `log.code` — `packages/core`.
- 49.2 core config `stallAfterMs` — `packages/core`.
- 49.3 handshake `budgetUsd` — `packages/core`.
- 49.4 flock `TaskHandle.worktreePath` — `packages/flock`.
- 49.5 CLI policy/worktree/SIGINT wiring — `apps/cli`.
- 49.6 engine resolver hook — `packages/engine`.
- 51.1 llm index exports — `packages/llm`.
- 51.2 CLI `--profile` / doctor lines — `apps/cli`.
- 51.3 llm test expectations — `packages/llm`.
- 52 no requests (CI lane reports none).
- 53.1 shell renders LaunchPanel — `apps/web/src/app`.
- 53.2 server preview endpoint — `apps/server` + `apps/web/src/data`.
- 53.3 server budget body/plumbing — `apps/server`.
- 53.4 playground route for launch — `apps/web/src/lib/route.ts` + `PlaygroundHost`.
- 53.5 initial repo from URL/storage — shell lane.
- 55.1 core `TaskRun.nodeName` — `packages/core`.
- 55.2 core `MergeQueueProps.selectedTask` — `packages/core`.
- 55.3 queue column widths — `apps/web/src/app`.
- 56.1 planner uses repomap renderer — `packages/planner`.
- 56.2 stale epic docs — orchestrator docs.
- 57.1 CLI `starling gc` — `apps/cli`.
- 57.2 engine calls `recoverWorkspace` — `packages/engine`.
- 57.3 engine branch cleanup — `packages/engine`.
- 57.4 worktree config knobs — `apps/cli` + root config.
- 58 no requests (status only).
- 59.1 GitHub Pages workflow — `.github/workflows`.
- 59.2 site CI job — `.github/workflows`.
- 59.3 root test/check scripts for site — root `package.json`.
- 59.4 `site/data/stats.json` — Epic 68 / site lane.
- 59.5 README link/screenshot — `README.md`.
- 60.1 CI filename/badge — `.github/workflows` + README.
- 60.2 README `v0.1` markers — `README.md` + CLI footer.
- 60.3 README swarm stats table — `README.md`.
- 60.4 README init flags — `README.md`.
- 60.5 reuse diagram assets — `docs/assets`.
- 61.1 CLI doctor/init flags — `apps/cli/src/program.ts`.
- 61.2 CLI parse tests — `apps/cli/src/program.test.ts`.
- 68.1 shell `?page=about` route — `apps/web/src/app`.
- 68.2 site reads `stats.json` — `site/`.
- 68.3 tools workspace/typecheck — root `package.json` + tsconfig.
- 68.4 root scripts include tools — root `package.json`.
- 69.1 SEC-01 server auth/hostname — `apps/server` (+ shell token).
- 69.2 SEC-02 flock registration — `packages/flock`.
- 69.3 SEC-03 bundle ref validation — `packages/flock` + `apps/server`.
- 69.4 SEC-04 replay confinement — already fixed by Epic 41.
- 69.5 SEC-05 body limits — `apps/server` + `packages/perch`.
- 69.6 SEC-06 SSE stream cap — `apps/server`.
- 69.7 SEC-07 mDNS code — `packages/perch`.
- 69.8 SEC-08 lane path traversal — `packages/auditor` + core.
- 69.9 SEC-09 static realpath — `apps/server`.
- 69.10 SEC-10 perch task body validation — `packages/perch`.
- 69.11 SEC-11 shell-command policy docs — `packages/auditor` / `packages/merger` docs.
- 70 F1 engine bypasses merge queue — `packages/engine`.
- 70 F2 engine pump before cleanup — `packages/engine`.
- 70 F3 double persistence — `packages/engine` / `packages/store`.
- 70 F4 `ReplayRunner` retime — `packages/runner`.
- 70 F5 `TaskRun.worktreePath` — core/engine.
- 70 F6 SSE backlog yield — `apps/server`.
- 70 F7 planner `maxTasks` ceiling — `packages/planner`.
- 70 F8 web reducer `appendCapped` ring buffer — `apps/web/src/data` (Wave 3b, and an explicit no-edit file per L32).
- 71.1 Sky tooltip test hook — `features/sky`.
- 71.2 Playwright CI job — `.github/workflows` / `apps/web` config.
- 71.3 compact queue board at 1280 — `features/queue` / shell.

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

**Deliberately deferred / out of scope:**

- Global ⌘K binding, overlay mounting and feature opening (the shell; see C3 wiring).
- Typo tolerance (transposition/omission) — subsequence matching only.
- Per-run or per-repo recents; clearing history on run change.
- Virtualisation beyond the 50-row cap; a “show all” mode.
- Playground routing (`?playground=palette`) and a screenshot baseline.
- Editing other features to publish their commands (the shell composes the command list).

**Open questions / flagged tradeoffs:**

- **Weights are judgement, not measurement.** Prefix (8) > word start (5) > consecutive (4) was chosen so a title starting with the query always beats a mid-sentence match; user testing on the stage demo may want a larger consecutive bonus for key-stabbers.
- **Recents are browser-global.** That is the simple, predictable behaviour for a single-hub demo; a multi-run “recent tasks in this run” list would need a per-run key and a migration of the existing one.
- **Enter with zero results does nothing** (it does not close). That matches “Enter runs the active item”; the empty state plus Esc is the escape hatch.
- **Feature icons are a fixed allowlist.** A manifest with a new icon renders `Command` until `icons.tsx` gains the name; this is deliberate (a whole-lucide import would dwarf the feature).
