## Epic 43 Handback — GitHub mode end-to-end (sandbox repo)

**Status:** Complete. Branch `epic/43-github-e2e`, implementation at `ce04681` (this docs commit on top).

Closes #30.

**Delivered:**

- `tools/github-sandbox/setup.sh` — creates (or reuses) the private repo `<owner>/starling-sandbox` with
  `gh repo create --private`, seeds `main` with a fresh `examples/scripts/make-demo-repo.sh` baseline,
  refuses to push if the repo is not private, prints the URL last. Idempotent; `STARLING_SANDBOX_RESET=1`
  re-seeds `main`.
- `tools/github-sandbox/teardown.sh` — closes open PRs whose head is `starling/*` (or whose body has the
  Starling marker), closes open issues labelled `starling` (or marker-bearing), deletes every
  `starling/*` remote branch via `gh api`. Never deletes the repo, labels or `main`; already-clean is a
  no-op; `STARLING_SANDBOX_DIR` also prunes local branches.
- `tools/github-sandbox/e2e.ts` — drives `createGitHubTracker` with a hand-built `Run` over
  `fixtures/plans/sky-todo-launch-day.json` and real branches: 7 issues, two re-runs that create 0, two
  task branches with real commits → `openTaskPR` → merge into the integration branch → `onMerged`, then
  `openFinalPR` to `main`, prints all URLs, then teardown (`--keep` skips it). No engine, no LLM.
- `packages/github/src/gh.ts` — `clampBody` (GitHub's 65,536-character cap, head + note + tail),
  `isRetryableGhFailure` + `backoffMs` + retry loop in `GhClient.run` (4 attempts, 1.5 s → 20 s, jitter;
  retries secondary rate limits/5xx/timeouts, not primary limits or validation), a 120 s per-command
  timeout (`timeoutMs`), and `parseGitHubRemote` as a fallback when `gh repo view` cannot name the repo.
  New options: `timeoutMs`, `retry`, `sleep`, `warn`.
- `packages/github/src/tracker.ts` — tolerates `label … already exists`; retries an issue create once
  when gh says `could not add label: '…' not found`; treats `No commits between <base> and <head>` as
  "nothing to review" (`undefined` + `warn`) for both task and final PRs; `syncPlan` trusts
  `TaskRun.issueNumber` when present and otherwise waits out a partially visible listing
  (`settleDelaysMs`, default `[600, 1800]`) before creating; new options `warn`, `sleep`,
  `settleDelaysMs`, `timeoutMs`, `retry`.
- `packages/github/src/render.ts` — task PR body now has a ✅/❌ verdict table (with a duration column
  when measured), a `AuditVerdict.dod` checklist with evidence (plan checklist when the auditor did not
  itemise it), an API-vs-local usage table, `**Cost:** … · **Attempts:** … · **Node:** …`, and a footer
  linking the run's issue search (`runSearchUrl`). Final PR gained a Node column; issues and merge
  comments carry the run link.
- `packages/github/src/testing/fake-gh.ts` — reproduces every real failure above: `labelAlreadyExistsOnce`,
  `issueCreateMissingLabelOnce`, `noCommitsBetween`, `issueListLag`, `enforceBodyLimit`, `failOnce`,
  `originRemote`.
- 35 more tests (41 → 76 in `@starling/github`, all green): `gh.test.ts` plus tracker and render additions.

**Key design decisions:**

- **Trust persisted issue numbers before the GitHub listing.** Real bug found in the sandbox: a re-sync
  ~300 ms after creating seven issues saw six (`gh issue list` lags writes) and created a duplicate. A
  resumed run already has `TaskRun.issueNumber` from the store, so `syncPlan` uses it and skips the read;
  the settle-poll only runs when *some but not all* of a run's issues are visible, so a genuine first sync
  pays nothing. Bounded worst case documented in the epic doc.
- **Clamp long bodies by keeping both ends.** The first implementation truncated the tail, which removed
  `Closes #N` and the footer. GitHub's 65,536 cap applies to issues *and* PRs (both reproduced live).
- **`No commits between` is not an error.** It is exactly the post-crash re-run state; returning
  `undefined` with a `warn` keeps merges idempotent while every other gh failure still throws.
- **Backoff only for failures that can clear inside a run.** Secondary limits/5xx/timeouts retry; a
  primary rate limit fails fast with a "wait for the window" hint.
- **The fake pins real stderr strings, not invented ones.** Each switch reproduces a message this epic
  observed, so a regression fails the way the sandbox did.
- **Teardown closes, never deletes.** Closed PRs stay browsable evidence; the repo and labels survive so
  the next run is fast.
- **`warn` instead of `console.log`.** Library code stays silent (AGENTS §7); the e2e prints, tests assert.

**Verification (exact commands + results):**

- `bun install` → `Checked 162 installs across 221 packages (no changes)`.
- `bash tools/github-sandbox/setup.sh` → `Reusing broiisapro/starling-sandbox` /
  `Sandbox ready: https://github.com/broiisapro/starling-sandbox` (first run created it with
  `gh repo create --private`; verified `visibility: PRIVATE`).
- `bun tools/github-sandbox/e2e.ts` (final run, run `01m5zfa5w6jy4516d6xqcrjd12`):
  - `syncPlan: 7 issues created`
  - `syncPlan again (numbers restored): 0 created, same 7 numbers`
  - `syncPlan a third time (markers only): 0 created, no duplicates (7 issues)`
  - issues (sandbox repo, numbers are not starling issues):
    https://github.com/broiisapro/starling-sandbox/issues/38 (theme, closed),
    https://github.com/broiisapro/starling-sandbox/issues/39 (search, closed),
    https://github.com/broiisapro/starling-sandbox/issues/40 (csv-export),
    https://github.com/broiisapro/starling-sandbox/issues/41 (shortcuts),
    https://github.com/broiisapro/starling-sandbox/issues/42 (due-badges),
    https://github.com/broiisapro/starling-sandbox/issues/43 (dates-fix),
    https://github.com/broiisapro/starling-sandbox/issues/44 (help-overlay, open, untouched on purpose)
  - task PRs: https://github.com/broiisapro/starling-sandbox/pull/45 and
    https://github.com/broiisapro/starling-sandbox/pull/46 (both auto-`MERGED` once their commits landed
    on the integration branch), final PR: https://github.com/broiisapro/starling-sandbox/pull/47
  - `Running teardown…` → `Sandbox clean: broiisapro/starling-sandbox (repo kept)` (exit 0)
  - the PR bodies were checked live: verdict table with durations, ticked DoD with evidence, API/local
    usage table, `Node: hub`, a Closes line for sandbox issue 38, footer `run [crjd12](…issues?q=label%3Astarling%3Arun-crjd12)`.
- `bun run test` (root):
  - packages/CLI/server/skills/integrations/tools/evals: `1394 pass, 4 skip, 0 fail` — `Ran 1398 tests
    across 163 files`
  - apps/web: `426 pass, 0 fail` — `Ran 426 tests across 39 files`
- `bun run check` → `Checked 707 files` (Biome, no fixes) + per-workspace `tsc --noEmit` loop, exit 0.
- `bunx tsc --noEmit -p tools/github-sandbox/tsconfig.json` → exit 0 (root check does not cover `tools/`).
- `bash tools/github-sandbox/teardown.sh` run twice on a clean sandbox → no-op, exit 0.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. `packages/core` untouched; every new option is an optional field on
`GitHubTrackerOptions` / `TaskPRBodyOptions`, and the `Tracker` port is unchanged.

**FIX REQUESTS (lanes I do not own):**

- `packages/engine` (Epic 40/49): when `--github` is wired, (1) assign `syncPlan`'s return value onto
  `run.tasks[key].issueNumber` **before** any retry, so a resumed run takes the no-listing fast path;
  (2) pass `run.tasks[key].nodeId` (already present) and, if available, the per-task local usage through
  a tracker that renders it — otherwise the task PR shows `Local: —` and the node falls back to
  `TaskRun.nodeId`; (3) route `GitHubTrackerOptions.warn` to the EventBus `log` event so rate-limit
  retries and "nothing to review" are visible in the dashboard.
- `apps/cli` (Epic 40/22): `compose()` still only supports `mode: 'mock'`; `starling run --github` cannot
  reach the real tracker until it can build `createGitHubTracker({ cwd: goal.repoPath, repo: config.github.repo ?? undefined })`.
- `examples/scripts/make-demo-repo.sh`: no change needed — `SKY_TODO_SKIP_INSTALL=1` already exists and is
  what `setup.sh` uses.

**Deliberately deferred / out of scope:**

- Engine integration of `--github` (Epic 40), CI on the final PR (Epic 52), deleting sandbox repos.
- Automatic duplicate reconciliation when GitHub's read lag exceeds the 2.4 s settle budget (documented
  in the epic doc as the next step; never observed beyond ~1 s).
- Pagination past 500 `starling:task` issues, label theming, editing issues when the plan changes.
- Parallel `gh` calls (17 sequential calls for 7 tasks is acceptable at this scale).
- A real secondary-rate-limit run: the retry detector is unit-tested against GitHub's documented text,
  but deliberately not provoked so the account is not temporarily blocked.

**Open questions / flagged tradeoffs:**

- **Merged-by-hand PRs.** Merging a task branch into the integration branch makes GitHub report the task
  PR as `MERGED` even though nobody pressed the green button. That is good for the demo but means
  `prUrl` points at a PR GitHub considers merged; if a future epic wants task PRs to stay open until a
  human reviews them, the engine must merge *after* the PR is closed or use a different base.
- **`settleDelaysMs` default (600 ms + 1 800 ms)** is tuned to the observed ~1 s lag on one repo. A very
  busy org might need more; the option exists so a user can raise it without a code change.
- **`openTaskPR` returning `undefined`** for "nothing to review" is a silent-ish skip by design, but it
  relies on the engine honouring `warn`. Flagged in the fix request above.
