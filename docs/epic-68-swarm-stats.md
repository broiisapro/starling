# Epic 68 — Built-by-the-flock stats page

**Branch** `epic/68-swarm-stats` · **Lane** `apps/web/src/features/about/**`, `tools/stats/**` ·
**Ship date** 27 Oct 2026

## Goal

Turn this repo's own history into proof that Starling built itself: a page and a JSON file that
answer "how many epics, PRs, commits, lines, tests, agents and hours did this take?" straight from
`git`, GitHub, `.orchestrator/epics.tsv` and the orchestrator agent logs — no hand-maintained
numbers, no network required to render.

Two artefacts:

- `tools/stats/collect.ts` → `tools/stats/out/stats.json` (the data);
- `AboutPage` in `apps/web/src/features/about` (the page: story, big numbers, swim-lane timeline,
  per-epic table, provenance footer).

## How it works

### Collection (`tools/stats/`)

`collectStats()` reads four independent sources and merges them in a pure assembler:

| Source | Module | What it contributes | When it is missing |
| --- | --- | --- | --- |
| git | `git.ts` | tags `epic-NN-complete`, `epic/NN-slug` branches, per-epic commits / first commit / +− lines / files / added test files, test declarations at HEAD and per wave | throws: there is nothing to describe |
| GitHub | `gh.ts` | PR number, URL and `mergedAt` from `gh pr list --state merged --json …` | PR fields fall back to tags (`mergedAt` = tag date) and `notes` records why |
| plan | `epics.ts` | titles, waves, machines and lanes from `.orchestrator/epics.tsv` | titles/waves are derived from branch slugs (`wave: 'unknown'`) |
| handbacks | `handbacks.ts` | `**Status:**` → `complete` / `partial` / `missing` | every epic reports `unavailable` |
| agent logs | `logs.ts` | session start (log header), end (mtime), duration, peak concurrency, agent-hours | peak falls back to the busiest wave's epic count |

Per epic, `git.ts` picks evidence in order of quality:

1. **the pushed `epic/NN-slug` branch** — real commit count, real first commit, `git diff main...branch`
   for lines/files/test files;
2. **the squash commit** `epic(NN): …` on `main` — one commit, `git show --numstat`;
3. **the tag range** between the previous and this `epic-NN-complete` tag.

That chain is why a repo where the branches were pruned still shows numbers, and why the collector
never invents them.

`assemble.ts` is pure (`AssembleInput → SwarmStats`): it joins git, PRs, handbacks and log sessions,
groups epics into waves, and computes totals. Everything testable about the merge logic is testable
without git, GitHub or a clock.

### The page (`apps/web/src/features/about/`)

- **Story** — exactly three sentences, every clause driven by the totals (`story.ts`).
- **Big numbers** — five tiles: epics merged (with in-flight count), agents at peak (with sessions and
  agent-hours), pull requests (with +/− lines), tests (with files and test files added), wall clock
  (with waves and commits).
- **Timeline** — hand-rolled SVG, one horizontal lane per wave, one bar per epic from its first
  commit (or agent start) to its merge; in-flight epics are hollow and run to `generatedAt`. Bars
  carry a `<title>` with the full detail, the chart has `role="img"` + `<title>`/`<desc>`, and the
  same data is rendered as a real table immediately below.
- **Epic table** — `<th scope>` on every header and row label, PR links, handback state as text
  (never colour alone).
- **Provenance footer** — what was read, what was unavailable, and the collector's notes verbatim.

`AboutPage` takes `{ stats: SwarmStats }` only: no store, no fetching. `?page=about` routing belongs
to Epic 41 (FIX REQUEST below); the landing site (Epic 59) reads the same JSON (FIX REQUEST below).

## Key decisions & reasoning

- **Branch-first evidence.** Commit counts per epic are only meaningful from `main..epic/NN-slug`;
  squash-merge commits would report "1 commit" for a 17-commit epic. Tags remain the completion
  signal and the fallback.
- **Author dates, not committer dates.** C1 agents rebased before pushing, which rewrites committer
  dates to push time — epic 33 looked like it took 10 seconds. `%aI` plus the agent-log start (take
  the earlier of the two) restores the real 2h21m.
- **In-flight epics are shown, not hidden.** A wave-2 agent that has started but not merged appears
  as a hollow bar and counts as `inFlight`; `totals.epics` still counts merged epics only, so the
  headline never inflates itself while the stats run inside the very wave they describe.
- **Test totals are counted, not claimed.** `tests` = `test(`/`it(` declarations in `*.test.ts(x)`
  at a ref (`git grep`), `testFiles` = matching files (`git ls-tree`), `testsAdded` = test files a
  branch added. At the time of writing that reads 1,873 declarations in 217 files, in the same
  ballpark as the handbacks' "≈1,785 tests" (declarations include `test.each`/`test.skip` rows).
  No test process is spawned: the page must work on a machine with no `node_modules`.
- **Waves, not wall-clock sessions, define "tests after the wave".** One `git grep` per wave at the
  tag of the wave's last merge; unmerged waves report `0` with no ref instead of guessing.
- **One JSON, no build step for the consumer.** `AboutPage` re-exports the collector's types
  (`type`-only import across the boundary), so the page and the JSON cannot drift, and nothing from
  `tools/` reaches the web bundle (verified with `bun build … --target browser`).
- **A snapshot is committed.** `tools/stats/out/stats.json` is checked in so the page/landing site
  has data without running a collector first; `generatedAt` and `repo.head` say exactly when it was
  taken. Re-run `bun tools/stats/collect.ts` to refresh it.
- **Tests build a real repo.** The collector tests run `git init`, branch, squash-merge, tag and set
  log mtimes in a temp dir, and fake only `gh` with `fixtures/gh-prs.json`. No network, no mocks of
  the thing under test (git), and the degraded cases (no gh / no logs / no tsv) are separate tests.
- **`tools/` is not a Bun workspace**, so `@starling/core` has no symlink there; the tool imports
  `packages/core/src/index.ts` directly (the package's public entry) instead of duplicating the exec
  helper. Filed as a FIX REQUEST rather than editing the root `package.json`, which this lane does
  not own.
- **No `Intl` on the About page (fix 1).** `features/about/format.ts` builds timestamps, clocks and
  grouped counts from UTC parts (`getUTCDate`/`getUTCHours`/`getUTCMinutes` + a month-name array and
  a hundreds-grouping regex). `Intl.DateTimeFormat('en-GB', …)` renders the date-time connector as
  "at" under ICU 74 (macOS) and ", " under ICU 76 (Linux): the same commit produced "27 Oct at 15:18
  UTC" locally and "27 Oct, 15:18 UTC" in CI, so the test passed on one OS and failed on the other.
  Hand-rolled output is identical everywhere, and `about-timezone.test.ts` proves it by running the
  formatters in child Bun processes under `TZ=UTC`, `TZ=America/Toronto` and
  `TZ=Europe/Istanbul` + `tr_TR.UTF-8`.

## Interfaces for future epics

- **`SwarmStats`** (`tools/stats/types.ts`, v1): the JSON contract. Consumers: this page, Epic 59's
  landing page, any future scoreboard.
- **`collectStats(options)`** (`tools/stats/collect.ts`): programmatic entry point. Options:
  `repo`, `logsDir` (`null` disables), `useGh`, `now`, `run` (inject a fake `gh`).
- **`writeStats(stats, path)`** and **`summaryLines(stats)`**: write/print the artefact.
- **CLI**: `bun tools/stats/collect.ts [--repo <path>] [--out <path>] [--logs <path>|none] [--no-gh] [--json]`.
- **`AboutPage`**, **`BigNumbers`**, **`WaveTimeline`**, **`EpicTable`**, **`SourceNotes`**,
  **`FIXTURE_STATS`**, `swarmStory`, `timelineLayout` and the formatters are exported from
  `features/about/index.ts`.
- **`site/data/stats.json`** is the documented landing-page path (Epic 59): copy the collector
  output there with `bun tools/stats/collect.ts --out site/data/stats.json` once `site/` exists.
  Their lane owns the file; this epic does not write it.

## Deviations from plan

- The prompt asked for `tests` in totals; the contract also carries `testFiles`, `testsAdded`,
  `plannedEpics`, `epicsObserved`, `inFlight`, `agentHours` and `mergedPrsFromGh` because the page's
  story and tiles needed them and re-deriving them in the UI would duplicate logic.
- Extra CLI flags (`--out`, `--logs`, `--json`, `--repo`) beyond "writes tools/stats/out/stats.json",
  so the collector can feed the landing site and be tested without touching the real logs.
- The generated snapshot is committed (not in the prompt) so consumers have data before they run
  anything; it is regenerable and says when it was taken.
- No `Playground.tsx`/Vite route: the page is not wired into the shell yet (Epic 41 owns routing), and
  a dev-only route would have meant editing the shell.

## Known limitations / deferred

- **Durations need branches or logs.** If both the epic branch and the agent log are gone, duration is
  `undefined` (table shows "—"); squash commits alone only prove when the merge happened.
- **The x-axis is UTC.** Fine for a one-day project; a multi-day run would want day separators.
  The labels are formatted by hand from UTC parts (no `Intl`), so they read the same on every OS.
- **Line counts include fixtures, generated files and lockfile churn.** "+129,808" is honest but not
  "hand-written source lines"; a `--exclude-lockfiles` view is deferred.
- **`gh` needs auth and network.** The collector takes ~3s with `gh` (one call) and fails soft; CI
  should pass `--no-gh` or use the committed snapshot.
- **Log mtime is a session's end.** Good enough for peak concurrency (±seconds); a proper event log
  (which Starling itself records) would be exact — worth revisiting once `starling run` produces the
  orchestrator logs.
- **No per-lane aggregation yet.** `lane` is collected per epic and displayed, but lane-level totals
  (which lane churned most) are deferred to whoever wants the story next.
