# Epic 129: Web: system health panel

**Wave 3 · Branch `epic/129-web-health` · Issue: `gh issue list --search "Epic 129 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-129-web-health.md` and `.orchestrator/handbacks/129-web-health.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/features/health/**`
plus `docs/epic-129-web-health.md` and `.orchestrator/handbacks/129-web-health.md`. Read anything.

## Goal
With 100 agents on a laptop and a second laptop on hotel wifi, things go wrong mid-demo: 429s, a perch that stops heartbeating, an agent that stalls, a budget warning, a dropped SSE stream. The engine already reports most of this as `log` events with stable policy codes (Epic 49), but nothing in the dashboard reads them. The health panel is the operator's glance: one red/amber/green light per subsystem, with a plain sentence explaining each non-green light. Great looks like this: during the demo the presenter sees "Air: last heartbeat 14 s ago" turn amber before the engine reschedules, and can say so out loud. It's a panel (`kind: 'panel'`), pure derivation over `SkyState`.

## Deliverables
1. **Files**: `index.ts` (L39 manifest: `id: 'health'`, `title: 'System health'`, `kind: 'panel'`, `icon: 'HeartPulse'`, `hotkey: '!'`), `HealthPanel.tsx`, `health.ts` (pure), `codes.ts`, `use-tick.ts`, `fixtures.ts` (synthetic scenarios), `Playground.tsx` + `playground.html` + `playground-main.tsx`, tests.
2. **Extras** (`types.ts`): `HealthExtras = { now?: number; sse?: { status: 'connecting' | 'live' | 'offline'; attempt: number; delayMs?: number }; budgetUsd?: number; stallAfterMs?: number; compact?: boolean }`. The root component takes `FeatureProps & HealthExtras`. `sse` mirrors `data/sse.ts`'s `SseStatus` + `onStatus` detail, and C3 or Wave 3b can feed it later.
3. **`codes.ts`**: `policyCode(event: StarlingEvent): string | undefined`.
   - Read the additive `payload.code` the engine sets (`packages/engine/src/policies/log.ts` `PolicyCode`; copy the union as a local `const` with a pointer comment, and don't import the engine).
   - Else parse the `[code] detail` prefix (`policyMessage`).
   - Else apply heuristics to runner/llm/perch `warn` logs: `/\b429\b|rate.?limit/i` → `rate-limit.backoff`, and `/event stream (dropped|ended)/` → `stream.retry`.
4. **`deriveHealth(state: SkyState, now: number, extras?: HealthExtras): HealthReport`**, with `type Light = 'green' | 'amber' | 'red' | 'idle'`, `HealthRow = { id: 'stream' | 'heartbeats' | 'agents' | 'retries' | 'rate-limits' | 'budget' | 'errors'; light: Light; label: string; detail: string; items?: { id: string; light: Light; text: string }[] }`, and `overall` = the worst light. Rules:
   - **stream**: `connection` live → green (amber "reconnecting, attempt 3, next in 4 s" when `sse.status === 'connecting'`); demo → idle "Replaying the recorded run"; offline → red.
   - **heartbeats** (per node): age = clock − `lastSeen`. Under 10 s green, under 15 s amber, 15 s or more (ARCHITECTURE's offline threshold) or `status: 'offline'` red. **Clock** = `now` when live, but the newest event's `ts` in demo/replay, otherwise a finished replay turns everything red.
   - **agents**: running/fixing tasks whose newest `state.agentLog[key]` entry is older than `stallAfterMs` (default 90 s) are amber, past 2× red; any `stall.*` code is at least amber.
   - **retries**: `stall.retry`/`stall.redispatch`/`perch.loss` codes plus tasks with `attempts > 1`. 0 green, 1–3 amber, more (or `stall.failed`) red.
   - **rate-limits**: `rate-limit.backoff`/`parallelism.reduced` in the last 5 min. Any → amber, 5 or more → red.
   - **budget**: `budget.stop` red, `budget.warn` amber. Else with `budgetUsd`, spend/cap under 70% green, under 90% amber, else red. Else idle "no cap set".
   - **errors**: any `log` at level `error` in the last 5 min → red, showing the newest message truncated to 120 chars.
5. Derive from `state.events` only (capped at `EVENT_CAP` = 5,000, global `runId: '*'` logs included), memoised on `state.events` identity plus clock bucket. Never scan more than once per render.
6. **`HealthPanel` UI**:
   - A header with the overall light and "All systems go" / "2 warnings · 1 problem".
   - One row per subsystem: dot + lucide icon (`CheckCircle2`/`AlertTriangle`/`XCircle`) + text, so colour is never the only signal. Heartbeat items are expandable.
   - `aria-live="polite"` announces only transitions **into** red.
   - `compact` renders a single row of labelled lights for 720p.
7. **Clock**: `useTick(1000)` runs only while `connection === 'live'`; the `now` prop overrides it in tests.
8. **Playground scenarios** in `fixtures.ts`, built on the recorded run plus synthetic events: healthy, 429 storm, perch lost, budget warning, stalled agent, stream offline.
9. **Tests (≥ 40)**: every rule's thresholds and boundaries, code parsing (field / prefix / heuristic / none), the demo clock, caps, memo, the aria-live transition, and the compact mode.

## Explicitly out of scope
- Cost breakdown and budget gauge (Epic 116), toasts (Epic 121), event console (Epic 117): don't import them.
- Adding SSE attempt counts to the store is `apps/web/src/data` (Wave 3b, Epic 204): FIX REQUEST, and keep the `sse` prop optional.
- No new policy codes or fields in core or engine (Epics 100/202). If a code you need doesn't exist, write it up as a CONTRACT REQUEST.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/health` → 0 fail, ≥ 40 tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/health` clean.
4. Playground `/src/features/health/playground.html`: paste the overall light + row lights for each of the 6 scenarios in the handback, and commit one screenshot ≤ 300 KB of the '429 storm' scenario.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-129-web-health.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/129-web-health.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/129-web-health`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
