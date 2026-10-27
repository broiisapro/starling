# Epic 113: Web: flight report (the post-run summary page)

**Wave 3 · Branch `epic/113-web-report` · Issue: `gh issue list --search "Epic 113 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-113-web-report.md` and `.orchestrator/handbacks/113-web-report.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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
- **Epic 111 is building `/api/runs/:id/report|timeline|costs` and `/api/compare?a=&b=` in parallel; the response shapes are not final.** Your feature must be complete from `SkyState` alone. The endpoint is an optional enhancement: fetch only when `state.connection === 'live'`, through an optional `fetchImpl?: typeof fetch` prop (C3 passes one that adds the auth header from Epic 110), with an `AbortController`, a 2 s timeout, a structural guard on the JSON, and silent fallback to the local derivation on any error/404/501/mismatch. Never block the first render on it. Write the expected shape you coded against in the handback so C3 can reconcile it with 111's.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/features/report/**`
plus `docs/epic-113-web-report.md` and `.orchestrator/handbacks/113-web-report.md`. Read anything.

## Goal
When the murmuration lands, judges want one page that says what happened: did it work, how much faster than one agent, what it cost, which laptop did what, where the auditor pushed back, and the story in plain English. The flight report is that page (`?page=report`). It should look great on a projector and print cleanly. Every number must be traceable to events or run snapshots, and estimates must be labelled as estimates.

## Deliverables
1. `report/derive.ts`: `buildFlightReport(state: SkyState, runId?: string, now?: number): FlightReport | undefined` (defaults to the active run). `FlightReport` = `{ runId, goal, status, outcome: 'landed' | 'partial' | 'failed' | 'in-flight' | 'cancelled', tasks: { total, merged, failed, conflict, cancelled, inFlight }, wallMs, flightWindowMs, serialMs, savedMs, speedup, costUsd, savedUsd, localCalls, tokens: { api, local }, nodes: NodeContribution[], verdicts: NotableVerdict[], story: StoryBeat[], summary?: string, estimated: string[] }`.
2. **Sources (from the real reducer):** counts from `run.tasks[*].status`. `wallMs = (run.finishedAt ?? now) − run.startedAt`. Per-task flight = `finishedAt − startedAt` from `TaskRun`. `flightWindowMs = max(finishedAt) − min(startedAt)`. `serialMs = (wallMs − flightWindowMs) + Σ flight` (overhead + the tasks one at a time), labelled "estimate". If task timings are missing, fall back to `Σ plan.tasks[*].estimateMin` labelled "planner estimate". Cost/savings/local calls from the latest `state.metricsHistory` sample when the run is active, else `run.metrics` (`apiCostUsd`, `estSavedUsd`, `localCallCount`, `apiUsage`, `localUsage`).
3. **Per-node contribution** (`NodeContribution = { nodeId, name, tasks, merged, flightMs, costUsd, migratedIn, migratedOut }`): group `TaskRun.nodeId` (name via `state.nodes`), migrations from `task.migrated` events (`fromNode → toNode`).
4. **Notable verdicts:** for the run's task keys, `state.verdicts[key]` entries with `pass: false`, non-empty `laneViolations` or `fixInstructions`, paired with the later passing attempt ("theme failed attempt 1 (tests, definition-of-done), passed on attempt 2"). Show `checks[].name/ok/detail` and the verdict `model`.
5. **Story** (`storyBeats(events, run, nodes): StoryBeat[]`, `{ at: number /* ms since run start */, kind, text, taskKey? }`): `repomap.ready` (files), `plan.created` (task count, issues), `node.joined`/`node.left` (with `reason`), the first `task.status → running`, failed audits, `task.migrated` (with `reason`), the first and last `merge.result: merged`, `merge.result` conflicts, `log` warn/error, and `run.finished` whose `payload.summary` becomes `summary` (it's only on the event, not on `Run`). Cap at 12 beats, de-duplicated, chronological.
6. **Fixture truths (assert them):** for `fixtures/runs/sky-todo-launch-day.jsonl`: 7/7 merged, `wallMs` 356,000, Σ flight 400,300 ms, flight window 245,000 ms, `serialMs` 511,300, speedup ≈ 1.44×, `costUsd` ≈ 0.0422, `savedUsd` ≈ 0.0185, theme's failed-then-passed verdict, search migrated `air → hub`, and the summary text present.
7. `ReportPage` (kind `page`): hero outcome line + `Stat` row (landed, wall time, time saved, API spend, saved by local); a "one agent vs the flock" pair of bars (serial vs wall) with the estimate label; node contribution bars; verdict cards; story as a vertical timeline with `T+m:ss`. Clicking a task → `onSelectTask`; a run `<select>` (from `sortedRuns`) → `onSelectRun`. In-flight runs say "still flying" and update live. Empty state when there's no run.
8. `print:` styles (white background, no chrome, page-break-safe sections) and a "Print" button (`window.print`, guarded).
9. Optional enhancement: `GET /api/runs/:id/report` merged over the local report (server wins per field it provides), see the note below.
10. `index.ts` manifest: id `report`, kind `page`, icon `FileText`, hotkey `r`. Playground with the slider (mid-run vs landed).
11. Tests: ≥ 20 derive tests (fixture truths, missing timings fallback, a failed/conflict run, no verdicts, foreign-run verdict keys ignored, migration counting, summary absent) and ≥ 8 component tests (renders hero, estimate labels, select task/run callbacks, empty state, live fetch merges and falls back on 501 with an injected `fetchImpl`).

## Explicitly out of scope
- Exporting/sharing (Markdown, JSONL, PNG): Epic 123. Run comparison: Epic 122. Gantt rendering: Epic 114.
- Server-side report building (Epic 111), shell routing (Epic 112 / C3), anything in `data/`.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/report` → 0 fail, ≥ 28 new tests
3. `bunx tsc --noEmit -p apps/web` clean, `bunx biome check apps/web/src/features/report` clean
4. A happy-dom test renders `Playground` at the end of the fixture and finds "7/7", "5m 56s" and the word "estimate"
5. Paste `buildFlightReport` for the fixture (JSON, abbreviated) in the handback
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-113-web-report.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/113-web-report.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/113-web-report`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
