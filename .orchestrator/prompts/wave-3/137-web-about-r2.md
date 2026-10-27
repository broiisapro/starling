# Epic 137: Web: about / built-by-the-flock round 2

**Wave 3 · Branch `epic/137-web-about-r2` · Issue: `gh issue list --search "Epic 137 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-137-web-about-r2.md` and `.orchestrator/handbacks/137-web-about-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- `about/types.ts` re-exports types from `tools/stats/types.ts`, which is Epic 154's lane and changes in parallel (additive by L33). Don't edit `tools/stats`, and don't rely on new fields existing in that type: declare them locally in `parse.ts`.
- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 68 #1** (`?page=about` route + stats loader): the route belongs to Epic 112 + C3. Ship the loader container and manifest (deliverables 3–4) so it's one line, and list the exact line under **C3 wiring**.
- **Epic 68 #2–#4** (`site/data/stats.json`, `tools/*` workspace/typecheck): not this lane (Epics 179/154/C3). Decline with that reason.

## Your lane (you may write ONLY here)
`apps/web/src/features/about/**`
plus `docs/epic-137-web-about-r2.md` and `.orchestrator/handbacks/137-web-about-r2.md`. Read anything.

## Goal
"One person, 100 agents" is the hackathon's best line, and the About page is where it's proven with numbers read from the repo itself. Today the page renders the v1 stats JSON (`tools/stats/types.ts`), has no Playground, and isn't routed (Epic 68 asked for `?page=about`). Round 2:
- reads the Wave 3 stats format Epic 154 is producing in parallel, with a graceful fallback;
- adds a visual of the 100-agent wave lifting off at once;
- ships a loader container + manifest so C3 mounts it with one line.

Great looks like this: the page loads `/stats.json`, falls back to labelled sample data when it can't, and the wave visual makes a judge say "wait, all at once?".

## Deliverables
1. **Tolerant parser** (`about/parse.ts`): `parseSwarmStats(json: unknown): { ok: true; version: number; stats: SwarmStats; extras: WaveThreeExtras; warnings: string[] } | { ok: false; reason: string }`.
   - It accepts v1 exactly as today, and v2+ when the v1 core fields are present.
   - Unknown fields are ignored. A missing or invalid required field fails with a reason. A major version above `SUPPORTED_STATS_VERSION + 1` gives a warning.
2. **Wave 3 extras** (declared locally; Epic 154 writes them):
   - Shape: `WaveThreeExtras = { prsPerHour?: number; linesByLane?: { lane: string; added: number; removed: number }[]; concurrency?: { t: string; agents: number }[]; perWave?: Record<string, { epics: number; agents: number; prs: number; wallTimeMs?: number }> }`.
   - Every field is read with type guards; partial data renders partially.
   - Keep all field-name knowledge in `parse.ts`, so if 154's names differ, C3 changes one file. Put the expected shape in the handback as a coordination note for Epic 154.
3. **`AboutContainer`** (`FeatureProps & { url?: string; fetchImpl?: typeof fetch }`) loads `url ?? '/stats.json'` once (Epic 68: `bun tools/stats/collect.ts --out apps/web/public/stats.json`). It shows a loading skeleton (`EmptyState`), then the page. On fetch/parse failure or an unsupported version it falls back to `FIXTURE_STATS` with a visible "sample data · <reason>" ribbon. It needs no store access beyond props.
4. **Manifest**: `feature = { id: 'about', title: 'Built by the flock', description: 'How 100 agents built Starling', kind: 'page', icon: 'Bird', hotkey: undefined, Component: AboutContainer } as const`, with `FeatureProps` = `{ state: SkyState; onSelectTask?(key: string): void; onSelectRun?(runId: string): void; onClose?(): void }` declared locally (Epic 112's registry shape). C3's line gives `?page=about`.
5. **100-agent wave visual** (`WaveSwarm.tsx`):
   - An SVG "concurrency river" of agents in parallel over time, from `extras.concurrency` or derived by pure `concurrencySeries(epics: EpicStats[]): { t: number; agents: number }[]` from `agentSession` start/end intervals.
   - One tiny bird per epic of the biggest wave rises along its session interval, and a "peak: 100 agents at 14:32" label marks the peak.
   - `role="img"` + `<desc>`; static under reduced motion.
6. **Wave cards**: the per-wave summary (epics, agents, PRs/hour, wall time) from `WaveStats` + `extras.perWave`; a top-10 "lines by lane" bar list when `linesByLane` exists. `swarmStory` mentions the biggest wave when it has 50 or more agents.
7. **Playground** (about has none yet): `Playground.tsx` + `playground.html` + `playground-main.tsx` with fixture switches for v1 (`FIXTURE_STATS`), synthetic v2 with 100 wave-3 epics (`fixtures-w3.ts` deterministic generator), broken JSON and a fetch failure.
8. **Tests (≥ 30 new)**: the parser (v1, v2, partial extras, wrong types, future version, garbage), `concurrencySeries` (overlaps, open sessions, empty), container states with a mocked fetch, the story, WaveSwarm's description and reduced motion, and manifest shape.

## Explicitly out of scope
- `tools/stats/**` (Epic 154), the landing site (Epic 179), the blog (Epic 180).
- `?page=about` routing and `apps/web/public/` (Epic 112 + C3). Generating `stats.json` is the collector's job.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/about` → 0 fail, ≥ 30 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/about` clean.
4. Playground `/src/features/about/playground.html` with the synthetic 100-agent fixture: commit 1 PNG ≤ 300 KB of the wave visual to `features/about/__screens__/`, and paste the fallback ribbon text for the broken-JSON case.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-137-web-about-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/137-web-about-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/137-web-about-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
