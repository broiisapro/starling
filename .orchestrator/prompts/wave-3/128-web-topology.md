# Epic 128: Web: flock topology

**Wave 3 · Branch `epic/128-web-topology` · Issue: `gh issue list --search "Epic 128 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-128-web-topology.md` and `.orchestrator/handbacks/128-web-topology.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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
`apps/web/src/features/topology/**`
plus `docs/epic-128-web-topology.md` and `.orchestrator/handbacks/128-web-topology.md`. Read anything.

## Goal
The flock is the most surprising part of Starling: several laptops lending their agents to one run. Today it's a list of roost cards. The topology view makes it physical. The hub sits in the middle and the perches sit around it as roosts. Each link shows its latency. Birds orbit the roost they're working on, and when the engine migrates a task (`task.migrated`) a bird visibly flies hub-ward and out to its new laptop. Great looks like this: a judge watching the two-laptop demo sees the MacBook Air join, takes the point at once, and sees a task hop machines when the Air leaves. It's a centre view (`kind: 'view'`) like Sky and DAG.

## Deliverables
1. **Files**: `index.ts` (L39 manifest: `id: 'topology'`, `title: 'Flock topology'`, `kind: 'view'`, `icon: 'Network'`, `hotkey: 'o'`), `TopologyView.tsx`, `topology.ts` (pure layout + model), `migrations.ts` (pure), `playground-fixtures.ts`, `Playground.tsx` + `playground.html` + `playground-main.tsx`, tests.
2. **Model**: `buildTopology(state: SkyState, size: { width: number; height: number }): Topology`.
   - `TopoNode = { id; name; role: 'hub' | 'local' | 'remote'; status: NodeStatus; activeSessions; maxSessions; latencyMs?: number; localModel?: string; tasks: { key: string; status: TaskStatus }[]; x: number; y: number; r: number }`.
   - `TopoLink = { from: string; to: string; latencyMs?: number; band: 'fast' | 'ok' | 'slow' | 'unknown' | 'down' }`.
   - The hub is the node with id `'hub'`, else the first `local` (same rule as `sortedNodes`). Perches go on an ellipse around it. Links are hub↔perch only (perches talk through the hub).
   - Positions are deterministic and **stable when a node joins**: order perches by first appearance in `state.events` (`node.joined`), falling back to `sortedNodes` order.
   - `r ∝ sqrt(maxSessions)`, clamped.
   - `latencyBand(ms?: number, status?: NodeStatus)`: < 25 fast, < 120 ok, else slow; `offline` → down; missing → unknown.
3. **Migrations**: `recentMigrations(events: readonly StarlingEvent[], now: number, windowMs = 4000): Migration[]` from `task.migrated` payloads (`{ taskKey, fromNode, toNode, reason }`), with `progress = (now - ts) / windowMs`. Unknown nodes are skipped. The view animates a bird glyph along from→hub→to, running `requestAnimationFrame` **only while a migration is in flight** (then the loop stops). Reduced motion: a static dashed arrow plus a label ("theme moved Air → Pro: perch left") for the window.
4. **Render** (SVG with `viewBox`, sized by a ResizeObserver with a fallback):
   - Roost circles with a sessions ring (arc = active/max), a crown on the hub, names ≥ 14 px at 1280×720.
   - A latency label on each link ("18 ms"). Link colour comes from the band; down links are dashed grey with "offline".
   - Up to 12 birds orbit each roost, coloured by task status via `statusColor` from `../sky`. Use a CSS rotate animation, paused under reduced motion.
   - Clicking a bird or task calls `onSelectTask(key)`. Each roost is a focusable `<g role="button" tabIndex={0} aria-label="MacBook Air · 3 of 5 sessions · 18 ms">`, and Enter selects its first live task.
5. **Accessible summary**: `<svg role="img">` with `<title>` and a `<desc>` from pure `describeTopology(t)` ("2 machines, 1 offline, slowest link 18 ms, 1 task moved in the last 4 s"), plus a visually hidden `<table>` of nodes and links.
6. **Edge states**:
   - 0 nodes → `EmptyState` "No flock yet".
   - 1 node → the hub alone with an "Invite a perch" hint that shows `state.join?.command` when present.
   - 12 perches → no overlapping circles and labels alternate above/below. Test this for 1..12 nodes.
7. **Playground**: the recorded run (hub + Air, one `task.migrated`, Air leaves and rejoins) replayed at 16× into local state with `playDemo` (as in the stage/flock playgrounds), plus toggles for "Add 6 synthetic perches" and "Replay a migration now" (injects a synthetic `task.migrated` at `Date.now()`).
8. **Tests (≥ 30)**: layout determinism and stability on join, bands, migrations window/progress, `describeTopology`, empty/1/12 nodes, offline perch, click/keyboard selection, and that the rAF loop stops when no migration is in flight (fake rAF).

## Explicitly out of scope
- Sky roosts (Epic 130), flock panel (Epic 135), leaderboard (Epic 126): don't edit or import their unmerged work.
- No new events or fields. Per-pair link latency or migration progress from the hub would be a CONTRACT REQUEST to Wave 3b (core 202).
- View switching, registration and hotkey dispatch belong to Epic 112 + C3.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/topology` → 0 fail, ≥ 30 tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/topology` clean.
4. Playground at `/src/features/topology/playground.html`: commit 2 screenshots ≤ 300 KB (recorded run mid-migration; 8 perches with one offline) to `apps/web/src/features/topology/__screens__/`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-128-web-topology.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/128-web-topology.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/128-web-topology`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
