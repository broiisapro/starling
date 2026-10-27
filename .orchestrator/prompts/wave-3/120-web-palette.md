# Epic 120: Web: command palette (Cmd-K)

**Wave 3 · Branch `epic/120-web-palette` · Issue: `gh issue list --search "Epic 120 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-120-web-palette.md` and `.orchestrator/handbacks/120-web-palette.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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


## Your lane (you may write ONLY here)
`apps/web/src/features/palette/**`
plus `docs/epic-120-web-palette.md` and `.orchestrator/handbacks/120-web-palette.md`. Read anything.

## Goal
With fifteen new features, the fastest way around the dashboard is one key: ⌘K/Ctrl-K, type three letters, Enter. The palette searches commands, features (from the manifests the shell hands it), the active run's tasks and all runs, remembers recent picks, and is fully keyboard-driven and screen-reader friendly.

## Deliverables
1. `palette/fuzzy.ts`: `fuzzyScore(query, text): { score: number; ranges: [number, number][] } | undefined` (case-insensitive subsequence match, bonuses for word starts, consecutive runs and prefix; deterministic tie-break by label) and `rankItems(query, items, limit = 50)`.
2. `palette/items.ts`: `PaletteItem = { id, group: 'recent' | 'commands' | 'features' | 'tasks' | 'runs', label, hint?, keywords?: string[], hotkey?, run(): void }`. Builders: `taskItems(state, onSelectTask)` from `activeRunOf(state)?.plan?.tasks` (label = title, hint = key + `statusLabel(TaskRun.status)`), `runItems(state, onSelectRun)` from `sortedRuns(state)` (goal text, status), `featureItems(features, onOpenFeature)`.
3. **Extra optional props** (C3 passes them through the shell's `props(shell)` hook): `features?: readonly PaletteFeature[]` where `PaletteFeature = { id, title, description, kind, icon, hotkey? }` (a structural subset of the L39 manifest, so manifests can be passed directly), `onOpenFeature?(id: string): void`, `commands?: readonly PaletteCommand[]` (`{ id, label, hint?, hotkey?, run() }`, e.g. toggle theme, switch view, demo speed). Without them the palette still offers tasks and runs.
4. **Recent:** last 8 picked item ids in `localStorage['starling.palette.recent.v1']` (guarded), shown first when the query is empty; stale ids are dropped silently.
5. `CommandPalette` (kind `overlay`): centred dialog, input with the ARIA combobox pattern (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`), grouped `role="listbox"` results with group headings, highlighted match ranges, hotkey hints via `Kbd`, an empty-result message. Keys: ↑/↓ (wrap), Home/End, Enter runs the item then calls `onClose`, Esc closes, Tab doesn't escape the dialog. Opening focuses the input; closing restores focus. Max 50 results, no lag at 500 tasks.
6. Icons: map `PaletteFeature.icon` names to a few local lucide imports with a fallback (don't `import *`).
7. `index.ts` manifest: id `palette`, kind `overlay`, icon `Command`, hotkey `mod+k`. Export `fuzzyScore`, `rankItems`, item builders and types.
8. Playground with the fixture state, a fake list of the 15 Wave 3 feature manifests (ids/titles/hotkeys from L39) and a log of what was picked.
9. Tests: ≥ 16 fuzzy/items tests (scoring order, ranges, ties, empty query, tasks/runs builders, recent persistence and pruning) and ≥ 10 component tests (combobox ARIA attributes, arrow wrap, Enter runs and closes, Esc, recent first, features group present only when passed, 500-item render).

## Explicitly out of scope
- Binding ⌘K globally (the shell does it from your manifest). Opening features itself (it calls `onOpenFeature`). Editing other features to add commands.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/palette` → 0 fail, ≥ 26 new tests
3. `bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/palette` clean
4. A test types "csv" over the fixture state and the top result is the `csv-export` task; Enter calls `onSelectTask('csv-export')` then `onClose`
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-120-web-palette.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/120-web-palette.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/120-web-palette`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
