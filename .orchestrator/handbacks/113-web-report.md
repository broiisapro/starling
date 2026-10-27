## Epic 113 Handback — Web: flight report (the post-run summary page)

**Status:** Complete. Branch `epic/113-web-report` (code @ `014ca91`, docs + this handback in `73574de` and the commit on top).
**Issue:** Closes #123.

**Delivered:**
- `apps/web/src/features/report/derive.ts` — `buildFlightReport(state, runId?, now?)` and helpers
  (`taskCounts`, `taskTimings`, `plannerEstimateMs`, `outcomeOf`, `moneyFor`, `runSummary`,
  `isRunOver`). Pure; works live, demo and replay.
- `story.ts` — `storyBeats(events, run, nodes)` + `MAX_STORY_BEATS = 12`: repomap, plan, node
  join/leave with reason, first take-off, failed audits, migrations, first/last landing, conflicts,
  warn/error logs, `run.finished`; de-duplicated, prioritised when over the cap, chronological,
  with `at` relative to run start.
- `nodes.ts` — `nodeContributions(run, events, nodes)` (`tasks/merged/flightMs/costUsd/migratedIn/
  migratedOut`, hub first) and `maxFlightMs`.
- `verdicts.ts` — `notableVerdicts`, `isNotableVerdict`, `failedChecks`, `verdictHeadline`,
  `verdictModel`; pairs a failed attempt with the later passing attempt.
- `ReportPage.tsx` — hero outcome + six `Stat`s (landed, wall, time saved, API spend, saved by
  local, local tokens), one-agent-vs-flock bars, node bars, task chips, verdict cards, T+m:ss story
  timeline with the writer's summary, run `<select>`, Print button, empty state, "Still flying."
  live snapshot with a 1 s clock while the run is unfinished.
- `ComparisonBars.tsx`, `NodeBars.tsx`, `VerdictCards.tsx`, `StoryTimeline.tsx`, `TaskChips.tsx`,
  `Hero.tsx`, `format.ts` (`beatClock`, `tokenTotal` = input+output, `speedupLabel`, …).
- `print.ts` + `print:` utilities on every section: white paper, dark ink, hidden chrome,
  `break-inside-avoid` cards.
- `live.ts` + `use-server-report.ts` — optional `GET /api/runs/:id/report`, live only, one fetch per
  run, `AbortController`, 2 s timeout, per-field structural guard, silent fallback on
  404/501/error/mismatch; local fields keep updating and only server-provided fields win.
- `index.ts` — L39 manifest `{ id: 'report', kind: 'page', icon: 'FileText', hotkey: 'r' }`,
  `FEATURE = 'report'`, `FeatureProps`, and all pure helpers exported.
- `Playground.tsx` + `playground.html` + `playground-main.tsx` — event-index slider over
  `demoEvents()`; mid-run and landed views.
- Tests: 27 derive tests + 14 page tests + 3 playground tests = 49 new tests, 0 fail.

**Key design decisions:**
- **Derive from `SkyState`, never depend on Epic 111.** The endpoint is an enhancer merged per field;
  the page is complete without it, so demo/replay/older hubs all work. — avoids a parallel-landing
  dependency for a demo-critical page.
- **One explicit `now`** into `buildFlightReport`; the page passes `useNow` only while unfinished. —
  deterministic tests and screenshots, and a finished run never drifts.
- **Serial time = (wall − flight window) + Σ flight**, with a planner-estimate fallback when no task
  has both timestamps. Every surface that shows it says "estimate" (stat hint, bar label, caption,
  footnote). — the counterfactual cannot be measured, so it must not look measured.
- **Final `TaskRun.nodeId` owns the task;** migrations are counters, not duplicated tasks. — avoids
  double-counting (the Air reads 2 tasks even though the summary says it took three: search started
  there and finished on the hub).
- **Exactly two merge beats (first and last).** Emitting one per merge produced six "Last landing"
  lines and pushed the story over the 12-beat cap. — narrative over exhaustiveness.
- **Verdicts filtered by the run's task keys** because `state.verdicts` has no run dimension. —
  never borrow another run's history.
- **Print through Tailwind `print:` variants**, not a second stylesheet. — one source of truth,
  tokens still apply in light/dark on screen.
- **No new dependencies, no shared-file edits, no `data/` edits.**

**Verification (exact commands + results):**
- `bun install`: `Checked 172 installs across 225 packages (no changes)`; `git status` shows no
  `bun.lock` change.
- `cd apps/web && bun test src/features/report`: **49 pass / 0 fail**, 162 expect() calls, 3 files.
- `bunx tsc --noEmit -p apps/web`: clean.
- `bunx biome check apps/web/src/features/report`: `Checked 24 files. No fixes applied.`
- Playground DoD (happy-dom, end of fixture): `playground.test.tsx` finds `7/7 tasks landed`,
  `5m 56s` and the word `estimate` (plus a mid-run scrub that reads "Still flying.").
- `bash .orchestrator/bin/heavy.sh bun run test`:
  - packages: `1938 pass, 4 skip, 0 fail` — `Ran 1942 tests across 223 files. [55.89s]`
  - web: `630 pass, 0 fail` — `Ran 630 tests across 63 files. [5.49s]`
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 999 files in 470ms. No fixes applied.`
  and the per-workspace `tsc --noEmit` loop completed with no output (clean).

**`buildFlightReport` for `fixtures/runs/sky-todo-launch-day.jsonl` (abbreviated):**
```json
{
  "runId": "01jd2k7m3p4q5r6s7t8v9w0x1y",
  "goal": "Add dark mode with a toggle, live search…",
  "status": "finished",
  "outcome": "landed",
  "tasks": { "total": 7, "merged": 7, "failed": 0, "conflict": 0, "cancelled": 0, "inFlight": 0 },
  "wallMs": 356000,
  "flightWindowMs": 245000,
  "serialMs": 511300,
  "savedMs": 155300,
  "speedup": 1.4362359550561798,
  "costUsd": 0.0421956,
  "savedUsd": 0.01854,
  "localCalls": 9,
  "tokens": {
    "api": { "input": 103500, "output": 16050, "cached": 27600 },
    "local": { "input": 53200, "output": 6560, "cached": 18000 }
  },
  "nodes": [
    { "nodeId": "hub", "name": "MacBook Pro", "tasks": 5, "merged": 5, "flightMs": 275300,
      "costUsd": 0.0315348, "migratedIn": 1, "migratedOut": 0 },
    { "nodeId": "air", "name": "MacBook Air", "tasks": 2, "merged": 2, "flightMs": 125000,
      "costUsd": 0.0106608, "migratedIn": 0, "migratedOut": 1 }
  ],
  "verdicts": [
    { "taskKey": "theme", "attempt": 1, "pass": false,
      "checks": [
        { "name": "tests", "ok": false, "detail": "bun test: 1 failing test in src/features/theme" },
        { "name": "lane", "ok": true, "detail": "No files outside the lane were touched" },
        { "name": "definition-of-done", "ok": false, "detail": "Missing: toggle persists across reloads" }
      ],
      "laneViolations": [], "summary": "The toggle works, but nothing proves the choice survives a reload.",
      "fixInstructions": "Add a test that mounts initTheme() twice …",
      "model": { "provider": "ollama", "model": "qwen3.6:35b-a3b" },
      "ts": 1731000063500, "resolvedBy": 2 }
  ],
  "story": [
    { "at": 1000, "kind": "node.joined", "text": "MacBook Pro joined the flock." },
    { "at": 4000, "kind": "repomap", "text": "Mapped 17 files (~2.5k tokens)." },
    { "at": 8000, "kind": "plan", "text": "Planned 7 tasks and the validator found no issues." },
    { "at": 356000, "kind": "finished", "text": "Run finished in 5m 56s." }
  ],
  "estimated": ["serialMs", "savedMs", "speedup"],
  "summary": "Seven tasks merged into starling/9w0x1y/integration in 5m 56s. … API spend $0.042, local audits saved an estimated $0.019."
}
```
(Story abbreviated from 11 beats; the full report is what the page renders.)

**Carryover done:** none. No Wave 2 FIX REQUEST targets a file in `apps/web/src/features/report`
(the folder is new in Wave 3). Checked and declined as out-of-lane, with owner:
- `47-sky-polish` 1–2 (`SkyViewProps.paused`, `Layout.tsx`) → Epic 47/41.
- `53-web-launch` 1–5 (shell wiring, preview endpoint, budget, playground route, initial repo) → Epic 41.
- `55-web-panels-polish` 1–3 (core `nodeName`, `MergeQueueProps.selectedTask`, queue widths) →
  Epic 40/41/55.
- `68-swarm-stats` 1 (`?page=about` shell route) → Epic 41.
- `71-web-e2e` 1 (Sky test id/freeze), 2 (CI Playwright), 3 (720p queue) → Epics 47/52/26.
- `69-security-review` SEC-01…SEC-11 → server/flock/auditor lanes.
- `70-load-test` F8 (reducer ring buffer) → `apps/web/src/data` (Wave 3b).

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

**Deliberately deferred / out of scope:**
- Export/share (Markdown, JSONL, PNG) — Epic 123; run comparison — Epic 122; Gantt — Epic 114.
- Server-side report building (Epic 111), shell routing/registry (Epic 112 / C3), anything in
  `apps/web/src/data`.
- Playwright/screenshot coverage and a projector-specific layout pass (Epic 71 / Epic 47).
- Per-run event archives (see FIX REQUEST 2).
- Real model calls or real Starling runs (L37): every test uses the fixture, fakes and injected fetch.

**Open questions / flagged tradeoffs:**
- **"Took three tasks" vs the Air's two.** The writer's summary counts search on the Air (where it
  started); the report attributes it to the hub (where it finished) and shows `migratedOut: 1`. Both
  are true; a judge reading only the node card may ask. A future node card could show
  `tasks + migratedOut` as "held".
- **`estimated` is field ids, not prose.** Cheap to test and lets the UI localise later; documented in
  the epic doc in case the orchestrator expected sentences.
- **Story priority trimming** is an addition beyond the literal "cap at 12": when a run exceeds the
  cap, outcome/plan/repomap beats beat node joins and logs, then everything is re-sorted
  chronologically. Without it, a busy run's story opens with four roost joins.
- **The live endpoint is a one-shot per run.** It is not refetched when a run evolves; locally derived
  counters keep moving, server-provided fields are a snapshot. A refetch policy needs Epic 111's
  caching semantics.
- **Print relies on the browser's print engine** for paper colour; `print:` sets white backgrounds
  and dark ink, but a user with "background graphics off" still gets legible dark text (no colour is
  load-bearing).
