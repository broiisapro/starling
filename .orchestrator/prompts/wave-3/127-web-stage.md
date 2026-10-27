# Epic 127: Web: presenter stage mode

**Wave 3 · Branch `epic/127-web-stage` · Issue: `gh issue list --search "Epic 127 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-127-web-stage.md` and `.orchestrator/handbacks/127-web-stage.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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
`apps/web/src/features/stage/**`
plus `docs/epic-127-web-stage.md` and `.orchestrator/handbacks/127-web-stage.md`. Read anything.

## Goal
The live demo happens on a projector, often a 720p one, watched from the back of a room. The normal dashboard is built for a developer at arm's length: five dense regions, 12 px meta text. Stage mode is the judges' view: a huge Sky, a few giant counters (landed, flying, API dollars vs local calls, elapsed), a ticker of merges along the bottom, and chrome that hides itself after a few seconds so nothing but the murmuration is on screen. Great looks like this: the presenter presses `s`, steps back, and the room can read every number at 1280×720. When the run finishes, a finale banner lands at the same moment as the Sky's all-landed sweep. It's a new page (`kind: 'page'`, `?page=stage`) built only from existing feature components and pure selectors.

## Deliverables
1. **Files**: `index.ts` (L39 manifest: `id: 'stage'`, `title: 'Stage mode'`, `kind: 'page'`, `icon: 'Presentation'`, `hotkey: 's'`; check the icon exists in `lucide-react`), `StagePage.tsx` (root, `FeatureProps`), `stage-model.ts` (pure), `use-idle.ts`, `BigCounters.tsx`, `MergeTicker.tsx`, `Finale.tsx`, `Playground.tsx` + `playground.html` + `playground-main.tsx`, plus tests next to each.
2. **`stage-model.ts`** (pure, no React):
   - `export interface StageCounters { landed: number; total: number; flying: number; auditing: number; grounded: number; apiCostUsd: number; localCalls: number; estSavedUsd: number; elapsedMs: number; nodesOnline: number; nodesTotal: number }`
   - `stageCounters(state: SkyState): StageCounters` (via `activeRunOf`, `sortedNodes` from `data/selectors`, latest `state.metricsHistory.at(-1)?.metrics ?? run.metrics`; "flying" = running|fixing, "auditing" = auditing|merging).
   - `tickerItems(state: SkyState, max = 8): TickerItem[]` with `TickerItem = { key: string; title: string; status: MergeResult['status']; ordinal: number; commit?: string; ts: number }`, built from `state.merges` (newest first, latest result per task key, titles from `run.plan.tasks`, key as fallback).
   - `stageHeadline(state): { phase: 'idle' | 'planning' | 'flying' | 'landed' | 'failed'; title: string; sub: string }` ("Waiting for a goal", "5 birds in the air", "All 7 landed in 5m 55s").
3. **`StagePage`** fills the viewport (`h-dvh w-full overflow-hidden`, no page scroll at 1280×720 or 1920×1080). The Sky gets about 75% of the area: `<SkyView {...skyProps(state, actions)} reducedMotion={reduced} />` (import from `../sky`; `usePrefersReducedMotion` from `../metrics`). A right rail of `BigCounters` and a bottom `MergeTicker`. Use `clamp()` sizes: values at least 40 px and labels at least 18 px at 720p, scaling up at 1080p. Only design tokens and `components` (`Stat`, `Badge`, `EmptyState`).
4. **Auto-hiding chrome**: `useIdle(timeoutMs = 2500, timers?: { setTimeout; clearTimeout }): boolean` goes idle after no `pointermove`/`keydown`/`touchstart`. While idle, the header (goal text, `state.connection` badge, "Exit stage (Esc)" button, "Full screen" button) fades out and the cursor is hidden; any input brings it back. There's no fade under reduced motion, just show/hide. Esc calls `onClose` (document keydown; ignore inputs and `defaultPrevented`). Full screen calls `document.documentElement.requestFullscreen?.()` inside try/catch. Don't bind `f`: it's taken.
5. **Merge ticker**: the newest merge slides in from the left (CSS transform, 0 ms under reduced motion). It shows `#3 dark-mode · Dark mode toggle · a1b2c3d`, plus a red chip for `conflict`/`tests-failed`. A separate sr-only `aria-live="polite"` node announces only the newest merge. Empty state: "Nothing on the wire yet".
6. **Finale**: when `activeRunOf(state)?.status === 'finished'`, show a large banner: "All 7 landed · 5m 55s · $0.04 API · 9 local calls". A failed or cancelled run gets an amber banner with the grounded count. It appears once per run id, can be dismissed with a click or Esc (the first Esc dismisses the banner, the second exits stage), and is static under reduced motion.
7. **Bird clicks** pass through to `onSelectTask` when it's provided. Stage has no drawer of its own, so don't import `AgentDrawer`.
8. **Playground** (`/src/features/stage/playground.html`): plays the recorded run at 16× into local React state with `playDemo({ onEvent: (e) => setState((s) => applyEvent(s, e)), speed: 16, rebaseTo: () => Date.now(), onLoop: () => setState(createInitialState()) })` (`data/demo`, `data/reducer`; import only). A small corner control switches speed (1/4/16) and restarts.
9. **Tests (≥ 30)**:
   - `stage-model` against `applyEvents(createInitialState(), demoEvents())`: 7 of 7 landed, $0.04 API, 9 local calls, 2 nodes. Also against a mid-run slice (pick the index by condition, not a magic number), the empty state, a failed merge and duplicate merge results.
   - `useIdle` with fake timers.
   - `StagePage` in happy-dom: Esc → `onClose`, chrome hidden after idle and shown on keydown, aria-live text, finale once per run.
   - A source scan of this folder: no `text-[<18px]`, no `text-micro`/`text-caption`.

## Explicitly out of scope
- `?page=stage` routing, hotkey dispatch and the registry are Epic 112's (`app/**`); C3 adds the line.
- Don't edit `features/sky|queue|metrics|flock`: import their public `index.ts` only. If the Sky needs a prop for stage use (e.g. a larger label scale), write a FIX REQUEST to Epic 130.
- Don't import sibling Wave 3 features (report 113, toasts 121, scrubber 124, leaderboard 126): they aren't merged.
- `apps/web/src/data/**` is read-only (Wave 3b).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/stage` → 0 fail, ≥ 30 tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/stage` clean.
4. `bun run --cwd apps/web dev`, open `/src/features/stage/playground.html` at 1280×720 and 1920×1080 (a throwaway Playwright script outside the repo is fine, run through `heavy.sh`): commit 2 PNGs ≤ 300 KB (mid-run, finale) to `apps/web/src/features/stage/__screens__/` and paste `document.documentElement.scrollWidth/scrollHeight` vs the viewport (no page scroll).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-127-web-stage.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/127-web-stage.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/127-web-stage`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
