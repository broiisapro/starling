## Epic 18 Handback — GitHub tracker

**Status:** Complete. Branch `epic/18-github` @ `c147ae6` (docs + this handback follow in one commit).
`Closes #12`

**Delivered:**
- `packages/github/src/tracker.ts` — `createGitHubTracker(opts)` implementing `Tracker` plus
  `dryRunLog()`; `syncPlan` ensures `<prefix>`, `<prefix>:run-<short>` and `<prefix>:task` labels,
  creates one `[starling] <title>` issue per task and returns `taskKey → number`; `openTaskPR` pushes
  the task branch and opens a PR with `--base <integration>`, `--head <branch>`, `Closes #<issue>`;
  `onMerged` comments the verdict and closes the issue (`completed` / `not planned`); `openFinalPR`
  pushes the integration branch and opens the PR to `run.goal.baseBranch`.
- `packages/github/src/render.ts` — pure `renderTaskIssue`, `renderTaskPRBody`, `renderFinalPRBody`,
  `renderMergedComment`, `taskMarker` (goal, deliverables, DoD checklist, lane, verdict table with
  ✅/❌, usage/cost, worker handback, final task table + API/local cost split).
- Idempotency: hidden marker `<!-- starling:run=<id> task=<key> -->` found by listing
  `starling:task` issues; a second tracker instance creates nothing. An existing PR is detected from
  `gh pr create` stderr and its URL returned.
- `packages/github/src/gh.ts` — injectable `GhClient` (core `exec`), one `gh auth status` probe,
  lazy `gh repo view` detection, JSON helpers, dry-run argv recording, auth-aware error mapping.
- `packages/github/src/errors.ts` — `GitHubError` / `isGitHubError` with `GH_AUTH`, `GH_REPO`,
  `GH_COMMAND`, `GH_MISSING`; still a `StarlingError`.
- `packages/github/src/handshake.ts` — local `WorkerHandback` mirror (ARCHITECTURE §8) plus
  `parseWorkerHandback` / `stripWorkerHandback`.
- Tests: `tracker.test.ts`, `render.test.ts`, `handshake.test.ts`, `errors.test.ts`, `index.test.ts`
  (41 tests); committed Bun snapshots in `src/__snapshots__/render.test.ts.snap`; stateful
  `src/testing/fake-gh.ts` so no test touches GitHub.

**Key design decisions:**
- Issue reconciliation lists by label and matches markers locally instead of `gh issue list --search`
  (GitHub's index does not reliably cover HTML comments). One request, exact.
- `GitHubError` is a local subclass because core's `StarlingErrorCode` is frozen. `githubCode` (also in
  `details`) carries `GH_AUTH`; `isStarlingError()` still works. This is the one place the prompt's
  literal `StarlingError('GH_AUTH')` is not met — see CONTRACT REQUEST.
- PR body is one rendered document: engine notes, verdict table, usage/cost, parsed handback, then
  `Closes #N`. The raw `<<<STARLING_HANDBACK` JSON is stripped, never pasted.
- Auth failures are promoted from any `gh`/`git` command (not just the probe), so the CLI can say
  "run gh auth login" instead of showing exit codes.
- Dry run never spawns: every argv (including the probe-free label/issue creates) goes through
  `shellJoin` into `dryRunLog()`. It cannot know live state, so it shows what would be attempted.
- `onMerged` no-ops when there is no issue (real mode) so bookkeeping cannot block a merge; dry-run
  logs a `<issue-number>` placeholder.
- Tracker never mutates `Run`; the engine assigns the returned issue numbers. The fake `gh` is
  stateful specifically so cross-instance idempotency is actually proven.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 133 installs across 192 packages (no changes) [11.00ms]`
- `bun test packages/github`: **41 pass / 0 fail**, 6 snapshots, 128 expect() calls
  (`Ran 41 tests across 5 files.`)
- `bun run test` (root): **226 pass / 0 fail**, 6 snapshots
  (`Ran 226 tests across 41 files. [248.00ms]`)
- `bunx biome check packages/github`: exit 0, 15 files, no fixes
- `bun run typecheck` (all 18 workspaces): exit 0
- `bun run check`: **fails on 9 pre-existing Biome errors outside this lane**, all in
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,ollama.test,smoke}.ts`,
  `tools/local-models/results/smoke-*.json` (8 formatter + 1 organizeImports in `smoke.ts:33`).
  No `packages/github` file is flagged; typecheck passes. These files are epic 01/02 work, not mine.
- Dry-run was exercised in tests: `fake.calls` stays empty while the log contains
  `gh label create starling …`, `gh issue create …`, `git push -u origin starling/9w0x2z/theme`,
  `gh issue close 100 --reason completed`, and `gh pr create --base main …`.
  No real `gh` invocation was made by any test (L23).

**Dependencies added:** none (only `@starling/core`, already present)

**CONTRACT REQUESTS:**
- Add GitHub codes to `StarlingErrorCode` in `packages/core/src/errors.ts`:
  `'GH_AUTH' | 'GH_REPO' | 'GH_COMMAND' | 'GH_MISSING'`, and ideally a first-class
  `StarlingError('GH_AUTH', …)` path. Why: the epic text specifies `StarlingError('GH_AUTH')`, but the
  Wave 1 union has no GitHub member. Until then `GitHubError.githubCode` is the documented field.
- Optional: an `error.code` union extension is the only coupling change this package needs.

**Deliberately deferred / out of scope:**
- Live `gh` verification against a real repo (`*.live.test.ts`), CI, webhooks, merging PRs on GitHub —
  Epic 43 / Wave 2.
- Timeouts, retries and rate-limit backoff around `gh`/`git`; pagination beyond 500 labelled issues.
- Editing/deleting issues on plan changes, PR comments, draft PRs, configurable label colours.
- `Workspace.commitAll` remains responsible for committing the worktree; the tracker only pushes.

**Open questions / flagged tradeoffs:**
- The engine must pass the worker's *raw final message* to `openTaskPR` for the handback block to be
  parsed; if it passes an already-rendered body, only the notes path is used (no failure).
- PR titles use the configurable `labelPrefix` (`[starling] …` by default) while issue bodies use the
  fixed `starling:run=…` marker. If someone runs two differently-prefixed trackers on the same repo,
  marker lookup still works but label sets differ by design.
