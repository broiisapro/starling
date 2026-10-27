## Epic 68 Handback — Built-by-the-flock stats page

**Status:** Complete. Branch `epic/68-swarm-stats` @ `3a724b6` (code, tests and snapshot; this handback and its fix requests follow that commit).

**Delivered:**
- `tools/stats/collect.ts` — `collectStats(options)` / `writeStats(stats, path)` / `summaryLines(stats)` / `parseArgs(argv)`; CLI writes `tools/stats/out/stats.json` and prints a 5-line summary. Flags: `--repo`, `--out`, `--logs <path>|none`, `--no-gh`, `--json`, `-h`.
- `tools/stats/types.ts` — `SwarmStats` v1 contract: per epic (number, slug, title, wave, lane, machine, mergedAt, startedAt, durationMs, commits, added/removed, files, testsAdded, PR number/URL, branch, handback status, agent session), per wave (epics, agents, startedAt, mergedAt, wallTimeMs, testsAfter + ref, commits, added/removed, merged), totals (epics, epicsObserved, plannedEpics, prs, commits, added/removed, files, tests, testFiles, testsAdded, waves, agentSessions, peakConcurrentAgents, wallTimeMs, agentHours, inFlight, mergedPrsFromGh), plus `sources` and `notes`.
- Sources, each optional and degrading into `sources.*` + `notes`: git (`git.ts`: tags `epic-NN-complete`, pushed `epic/NN-slug` branches → squash commits → tag ranges; author dates; `git grep` test declarations), GitHub (`gh.ts`: `gh pr list --state merged --json number,title,url,mergedAt,headRefName,additions,deletions,changedFiles`), plan (`epics.ts`: `.orchestrator/epics.tsv`), handbacks (`handbacks.ts`: `**Status:**` → complete/partial/missing/unavailable), agent logs (`logs.ts`: `../_logs/*.log` header start + mtime end → `peakConcurrency`, `agentHours`).
- `tools/stats/assemble.ts` — pure `assembleStats(input)` + `deriveRowsFromGit` + `summaryLines`; wave grouping, in-flight epics, totals, degraded-source notes.
- `tools/stats/out/stats.json` — committed snapshot (36 KB), regenerable with one command.
- `apps/web/src/features/about/` — `AboutPage({ stats })` + `BigNumbers`, `WaveTimeline` (hand-rolled SVG swim lanes, theme-token fills), `EpicTable` (accessible receipts table), `SourceNotes`, `swarmStory` (exactly 3 data-driven sentences), `timelineLayout` (pure layout), formatters, `FIXTURE_STATS`, all exported from `features/about/index.ts`. Types re-exported type-only from the collector, so page and JSON cannot drift.
- Tests: `tools/stats/collect.test.ts` (real temp git repo with branches, squash merges, tags, log mtimes, fake `gh` JSON; 5 tests including three degraded-source cases), `tools/stats/sources.test.ts` (7 pure-source tests), `apps/web/src/features/about/AboutPage.test.tsx` (4 render tests: story/tiles/footer, SVG lanes+bars, table a11y + PR links + in-flight, empty states), `about-pure.test.ts` (6 tests: formatters, handback labels, timeline layout invariants, empty layout, labels, story).
- `docs/epic-68-swarm-stats.md` — the six required sections.

**Key design decisions:**
- Branch-first evidence with squash-commit and tag-range fallbacks — squash merges would report "1 commit" per epic and no start time; the fallback chain keeps the JSON populated in pruned repos.
- Author dates (`%aI`) + earlier of (first commit, agent log start) — C1's pre-push rebases rewrote committer dates to push time, which made 33/34 look like 10-second epics; they now read 2h21m.
- In-flight epics are included (hollow bars, `inFlight`) but `totals.epics` counts merged epics only — the page is generated *inside* the wave it describes, so the headline must not inflate itself.
- `tests` = `test(`/`it(` declarations at a ref via `git grep`, not a test run — the page must render without `node_modules`; the counting rule is documented in the page footnote and the doc.
- `testsAfter` is one `git grep` per wave at that wave's last tag, not per epic; unmerged waves report `0` with no ref rather than guessing.
- The collector is `tools/`, not a package: `exec` comes from `packages/core/src/index.ts` by path (no workspace symlink exists there) instead of duplicating the helper or editing root `package.json`. FIX REQUEST below.
- The page takes props only and the fixture is exported, so the eventual shell route and the landing site both reuse the same component/data without touching `apps/web` shell lanes.

**Verification (exact commands + results):**
- `bun install`: `Checked 162 installs across 221 packages (no changes) [17.00ms]` — clean.
- `bun tools/stats/collect.ts` (DoD #2, on this repo, 27 Oct 2026):
  ```
  epics 28 merged (51 observed, 23 in flight)
  PRs 28 · commits 370 · +140320/−3111 lines in 1369 file touches
  tests 1873 in 217 files · 278 test files added across epics
  agents 51 sessions · peak 23 at once · 20.5h agent time
  wall 4.9h across 4 waves
  wrote …/tools/stats/out/stats.json
  ```
- `bun test tools/stats`: **12 pass / 0 fail**, 94 expect() calls.
- `bun test apps/web/src/features/about` (in `apps/web`): **10 pass / 0 fail**, 115 expect() calls.
- `bun run test` (root, after the load spike subsided): packages/apps/cli/skills/tools/evals **1371 pass / 0 fail**; apps/web **436 pass / 0 fail** (separate process, as designed).
- `bun run check`: `Checked 731 files in 643ms. No fixes applied.` and the per-workspace `tsc --noEmit` loop completed without error.
- `bunx tsc --noEmit -p tools/stats`: clean (root `typecheck` does not cover `tools/`; FIX REQUEST below).
- `cd apps/web && bun run build`: `✓ built in 923ms` (page is not routed yet, so it is tree-shaken out of the shell bundle; `bun build apps/web/src/features/about/index.ts --target browser` bundles cleanly, proving the type-only tools import is erased).
- Transient flakes under swarm load, not mine (both files untouched by this branch): Epic 24's wall-clock perf assertion (`sky/sim.test.ts`, "360 birds × 600 steps in under 250 ms" took 458 ms) at load average **124**, and Epic 42's `RemoteNode … event stream reconnects after the perch drops it` (a timing assertion at load average 86). Re-running each file alone: `sky/sim.test.ts` 21 pass / 0 fail ×3; `packages/flock` 53 pass / 0 fail. The full root run then passed twice, the second time after rebasing onto `origin/main`.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none (no `packages/core` change needed; types live in the collector and are consumed type-only).

**FIX REQUESTS (changes needed in lanes I do not own):**
1. **Epic 41 — shell routing (`apps/web/src/app/`, `App.tsx`):** add `?page=about` to the shell's page switch and mount `AboutPage` from `@starling/web`-local `features/about` with `stats` loaded once (e.g. `fetch('/stats.json')` from `apps/web/public/stats.json`, written by `bun tools/stats/collect.ts --out apps/web/public/stats.json`). Exact ask: one route branch + one loader; the component is props-only and needs no store changes.
2. **Epic 59 — landing site (`site/`):** read `site/data/stats.json` as documented. The collector already writes that path with `bun tools/stats/collect.ts --out site/data/stats.json`; no file is written there by this lane. The JSON contract is `tools/stats/types.ts` v1 (`SWARM_STATS_VERSION`).
3. **Integrator / Epic 40 — `tools/` is outside the Bun workspace:** `tools/stats/exec.ts` and `collect.ts` import `packages/core/src/index.ts` by path because there is no `@starling/core` symlink under `tools/`. Proposed change: add `"tools/*"` to root `package.json#workspaces`, give `tools/stats/package.json` `{"name":"@starling/stats","private":true,"dependencies":{"@starling/core":"workspace:*"}}`, and extend the root `typecheck` loop to `packages/* apps/* tools/*` (or add a `tsconfig.json` project reference) so `tools/stats` is typechecked by `bun run check` instead of only manually.
4. **Epic 24/23 (root `package.json` scripts)** — optional, not blocking: root `test:packages` already includes `tools`, so the collector tests run in CI; only the typecheck gap in item 3 needs attention.

**Deliberately deferred / out of scope:**
- Shell routing (`?page=about`) — Epic 41; no `Playground.tsx`/Vite dev route was added for the same reason.
- `site/data/stats.json` writing and the landing page — Epic 59.
- Lane-level aggregation ("which lane churned most"), day separators on a multi-day axis, and a lockfile/fixture-excluding line count.
- A `*.live.test.ts` against real `gh` — the unit tests fake `gh` with `fixtures/gh-prs.json`; the real call is exercised by `bun tools/stats/collect.ts` itself (verified above).

**Open questions / flagged tradeoffs:**
- "Tests" means test declarations, not executed tests (1,873 declarations vs the handbacks' ≈1,785 executed). Executing the suite inside the collector was rejected (needs install, slow, cannot run while 23 agents edit the tree). Worth aligning with Epic 40's CI numbers when it lands.
- Line totals include `bun.lock`, fixtures (`openapi.json`, 13k lines) and generated snapshots: +140k is honest "lines changed", not "hand-written source". A filter is deferred rather than silently applied.
- Peak concurrency and agent-hours come from log mtimes (within seconds of a real session end). Starling's own event log would be exact once `starling run` produces these logs.

Closes #50
