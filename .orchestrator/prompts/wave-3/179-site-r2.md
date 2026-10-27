# Epic 179: Landing site round 2: embedded murmuration replay, the 100-agent story, model table

**Wave 3 · Branch `epic/179-site-r2` · Issue: `gh issue list --search "Epic 179 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-179-site-r2.md` and `.orchestrator/handbacks/179-site-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **D1 note:** `site/` is outside the workspace. Root `bun run test`/`check` don't typecheck or test it (Biome does lint it), so run `bun run --cwd site test` and `typecheck` yourself. Mark pending things `⏳ Epic NN` in visible copy only where a judge benefits; otherwise just omit them. Real-run facts: see Epic 40's doc (`git show epic/40-integration-captain:docs/epic-40-integration-captain.md`).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **From 59-landing-site, FIX REQUESTS 1–3** (Pages workflow, a `site` job in `ci.yml`, root `test:site`/`typecheck:site` scripts): these target `.github/workflows/**` (Epic 150) and the root `package.json` (C3), so **decline in this lane**. Keep the exact YAML in `site/README.md` and restate the asks in your handback's C3 wiring.
- **From 59, FIX REQUEST 4 / 68-swarm-stats, FIX REQUEST 2:** the site reads `site/data/stats.json`, regenerated by `bun tools/stats/collect.ts --out site/data/stats.json`. Make sure the normaliser handles the collector's v1 output (deliverable 1). You may refresh `site/data/stats.json` from `tools/stats/out/stats.json` (marking `source`).
- **From 59, FIX REQUEST 5:** reuse `docs/assets/diagrams/*.svg` rather than forking a second diagram set (copy into `site/` at build time if needed).
- **From 59, Open question:** the hard-coded repo URL and `og:image` → deliverable 9.

## Your lane (you may write ONLY here)
`site/**`
plus `docs/epic-179-site-r2.md` and `.orchestrator/handbacks/179-site-r2.md`. Read anything.

## Goal
The landing page is the link in the submission. Round 2 makes it show the product, not just describe it: an **embedded replay** of a real recorded run (birds take off, circle while audited, land on the wire), the story of how 100 agents built it, an open-weight model table that matches the code, and a quickstart for the real run. It stays a framework-free static page under 300 KB that scores well on Lighthouse. Great looks like this: a judge on a phone sees the murmuration replay a real run within two seconds, with no network calls beyond the page itself.

## Deliverables
1. **Carryover first** (see below). Then extend `site/src/stats.ts` `normalizeStats` to also read the Wave 3 stats shape from Epic 154 (`tools/stats` v1 today: `totals.peakConcurrentAgents`, `totals.agentHours`, `totals.waves`, and a `waves[]` array of `{ wave, agents, wallTimeHours?, testsAfter? }`), with per-field fallbacks as now. Add ≥ 5 tests using a trimmed copy of `tools/stats/out/stats.json` as a fixture under `site/src/__fixtures__/`.
2. **Replay data:** `site/scripts/build-replay.ts` reads a JSONL recording (default `fixtures/real/launch-day.jsonl` if it exists, `⏳ Epic 40`; else `fixtures/runs/sky-todo-launch-day.jsonl`) and writes `site/data/replay.json`: `{ version: 1, source, goal, durationMs, tasks: { key, title, node }[], frames: { t, key, status }[], merges: { t, key }[], cost: { apiUsd, localUsd } }`, with `t` in ms from start, **≤ 25 KB**, and deterministic. `--check` exits 1 when stale. Commit the JSON. `build.ts` copies it to `dist/data/` like the stats file.
3. **`site/src/replay.ts`** (pure, no DOM): `stateAt(replay, tMs): { tasks: { key, status, node }[]; merged: number; failed: number; costUsd: number }` (binary search over frames), `nextEventAfter(replay, t)` and `formatClock(ms)`. ≥ 12 tests (empty, before start, exact frame, after end, out-of-order input rejected at build time, unknown status ignored).
4. **`site/src/replay-view.ts`:** a canvas section under the hero, reusing `boids.ts`/`sky.ts` patterns:
   - one bird per task; `running` birds flock over their node's roost, `auditing` pulse amber, `fixing` loop, `merged` perch on the wire, `failed` drop grey;
   - a merge ticker and a cost counter (`aria-live="polite"`, throttled);
   - controls: play/pause button, speed (1×/10×/30×), a scrub `<input type="range">`, all keyboard reachable;
   - pause when off-screen or the tab is hidden;
   - `prefers-reduced-motion` → the final frame plus a static `<table>` summary of tasks.
   Add a `<noscript>` fallback.
5. **"Built by 100 agents" section:** a wave timeline (Waves 0, 1, C1, 2, 3) drawn from `stats.waves` with fallbacks, the lanes-and-handbacks method in three steps, and a link to the blog post (`docs/blog/`, Epic 180). Numbers come from `data/stats.json` only (no hard-coded figures beyond the fallback object), labelled "snapshot".
6. **Open-weight model table:** roles × profiles (`opencode`, `deepseek`, `local`, `mixed`) in `site/src/models.ts` as data rendered into the page, plus a **drift test** that compares it to `applyProfile(defaultConfig, p)` imported from `../../packages/llm/src/index.ts` and `../../packages/core/src/index.ts`. If importing them breaks `site`'s typecheck, read the constants from `packages/llm/src/profiles.ts` as text instead.
7. **Quickstart** updated to the real flow (clone, `bun install`, `starling init --yes`, `starling run … --repo "$(bash examples/scripts/make-demo-repo.sh)"`), with `starling try` as `⏳ Epic 149` and the replay command for zero setup. Commands must exist in `createProgram()` (one site test checks the quickstart strings).
8. **Lighthouse-friendly:**
   - meta description, `og:*`/`twitter:*`, canonical (configurable in one constant), `<html lang>`;
   - explicit `width`/`height` on every `<img>`, and `loading="lazy"` below the fold;
   - landmark roles, a skip link, focus styles and contrast-safe tokens;
   - no render-blocking extras; total `dist` ≤ 300 KB (the existing `build.ts` budget).
   **`site/src/html-audit.test.ts`** (≥ 10 static checks on `index.html`): lang, viewport, description, one `h1`, heading order, every img has alt/width/height, every external link has `rel="noopener"`, no `http://` assets, a skip link, the canvas has `aria-hidden` or a label.
9. **Repo URL in one place:** `site/src/config.ts` exports `REPO_URL` (today hard-coded in `index.html` and the README per Epic 59's open question). `build.ts` substitutes a `%REPO_URL%` placeholder in the HTML, so a move is one edit.
10. **Docs:** update `site/README.md` (new files, `build-replay.ts`, the replay JSON contract, the deploy YAML from FIX REQUEST 59.1 kept for Epic 150) and `site/tsconfig.json` `include` (add `scripts/**/*.ts`).

## Explicitly out of scope
- `.github/workflows/**` (Epic 150), root `package.json` scripts (C3/root owner), `tools/stats/**` (Epic 154), `apps/web/**` (no React in the site; don't import the dashboard).
- New dependencies, CDNs, web fonts, analytics.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun run --cwd site test` → 0 fail, ≥ 28 new tests, and `bun run --cwd site typecheck` → clean.
3. `bun site/scripts/build-replay.ts --check; echo exit=$?` → `exit=0`, and `ls -l site/data/replay.json` ≤ 25 KB.
4. `bash .orchestrator/bin/heavy.sh bun run --cwd site build` → succeeds under the 300 KB budget. Paste the size table before and after.
5. `bun run --cwd site serve` and `curl -s localhost:4173/ | grep -c 'replay'` ≥ 1; `curl -s localhost:4173/data/replay.json | head -c 200` (paste). Stop the server afterwards.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-179-site-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/179-site-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/179-site-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
