# Epic 43 — GitHub mode end-to-end

## Goal

Prove the GitHub tracker against a real repository instead of a fake: a run's plan becomes issues,
each audited task branch gets a PR carrying its verdict, merges close issues, and the integration
branch gets a final PR — all idempotent and safe to re-run. Wave 1 built the tracker against an
in-memory fake; this epic is where real `gh` 2.98, real rate limits, real body limits and GitHub's
eventually-consistent read model get to break it. They did.

## How it works

| file                                  | role                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `tools/github-sandbox/setup.sh`       | create/reuse a private `<owner>/starling-sandbox`, seed `main` with sky-todo |
| `tools/github-sandbox/teardown.sh`    | close Starling issues/PRs, delete `starling/*` branches, keep the repo     |
| `tools/github-sandbox/e2e.ts`         | drive the tracker with a hand-built `Run`: 7 issues, 2 task PRs, final PR  |
| `packages/github/src/gh.ts`           | `GhClient`: timeout, backoff, body clamp, origin-remote repo detection     |
| `packages/github/src/tracker.ts`      | idempotent `syncPlan`, PR creation, merge comment, final PR                |
| `packages/github/src/render.ts`       | judge-facing markdown (verdict table, DoD, cost, node, run link)           |
| `packages/github/src/testing/fake-gh.ts` | fake exec that can reproduce every real failure captured below          |

### The sandbox

`setup.sh` asks `gh api user` for the owner (override with `STARLING_SANDBOX_OWNER`), creates
`<owner>/starling-sandbox` with `gh repo create --private`, and pushes a fresh
`examples/scripts/make-demo-repo.sh` baseline to `main` (`SKY_TODO_SKIP_INSTALL=1` by default: the
sandbox only needs commits). It re-reads the visibility and refuses to push to a repo that is not
private. Re-running reuses an existing sandbox; `STARLING_SANDBOX_RESET=1` force-pushes the baseline
back onto `main`. It prints the repo URL as its last stdout line.

`teardown.sh` closes open PRs whose head is under `starling/` (or whose body carries the hidden
marker), closes open issues labelled `starling` or carrying the marker, and deletes every
`starling/*` remote branch through `gh api`. It never deletes the repo, its labels or `main`, and an
already-clean sandbox is a no-op. A merged task PR stays merged — there is nothing to close.

### The end-to-end run

`bun tools/github-sandbox/e2e.ts` needs only `gh` and `git`:

1. clones the sandbox into `$TMPDIR/starling-gh-e2e-<ts>` (or `--dir`), sets a local git identity
   only when the machine has none, and creates `starling/<short>/integration` from `origin/main`;
2. `syncPlan` on the 7-task `fixtures/plans/sky-todo-launch-day.json` plan → 7 issues; then two
   re-runs (one with the issue numbers a resumed engine restores, one marker-only with numbers
   stripped) must return the same map and create nothing — verified against `gh issue list` after a
   settle delay;
3. for `theme` and `search`: a branch off the integration branch with one real commit →
   `openTaskPR` (PR into the integration branch, body = verdict table + DoD + usage + node + run
   link) → merge into the integration branch → `onMerged` (comment + close);
4. `openFinalPR` from the integration branch to `main`, listing all 7 tasks and the API/local cost
   split;
5. prints every issue/PR URL and, unless `--keep`, runs `teardown.sh` and removes the clone.

No engine, no LLM: the `Run`, `Plan`, verdicts and handback are hand-built, so the script is a
faithful tracker test rather than an integration test of the whole product (Epic 40 wires
`--github` into the engine).

### Tracker hardening

| real `gh` behaviour (captured verbatim)                                                    | fix                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `label with name "x" already exists; use --force …` (exit 1)                                | treat as success (another Starling process won the race)            |
| `could not add label: 'starling:task' not found` (exit 1) on issue create                    | re-assert labels and retry the create once                          |
| `GraphQL: Body is too long (maximum is 65536 characters) (createIssue/createPullRequest)`   | `clampBody`: head + truncation note + last 2 000 chars, cap 65 536  |
| `GraphQL: No commits between <base> and <head> (createPullRequest)`                         | `openTaskPR`/`openFinalPR` return `undefined` and warn: nothing to review |
| `You have exceeded a secondary rate limit…` / `HTTP 503` / timeout                          | exponential backoff (4 attempts, 1.5 s → 20 s, ±20 % jitter)         |
| `API rate limit exceeded for user ID …` (primary)                                           | *not* retried; `GH_COMMAND` with a "wait for the window" hint       |
| `gh repo view` → `none of the git remotes correspond to a known GitHub host`                 | fall back to `git remote get-url origin` (`git@`, `ssh://`, `https://`) |
| a re-sync right after creating issues sees only some of them → duplicate issue                | trust `TaskRun.issueNumber`, else settle-poll the listing before creating |
| `gh api -X DELETE …/git/refs/heads/<b>` on a missing ref → `Reference does not exist (HTTP 422)` | teardown treats it as already clean                             |

### Rendering

A task PR body is one document: marker, title, goal, engine notes, audit verdict (with a duration
column only when the auditor measured one), the DoD checklist from `AuditVerdict.dod` (evidence in
italics; the plan's unchecked list when the auditor did not itemise it), the worker handback, an
API-vs-local usage table, `**Cost:** … · **Attempts:** … · **Node:** …`, `Closes #N`, and a footer
that links the run: `https://github.com/<repo>/issues?q=label:starling:run-<short>`. The final PR
adds a per-task Node column and keeps the API/local cost split. Issues and merge comments carry the
same run link.

## Key decisions & reasoning

- **The e2e script lives in `tools/`, not in a test file.** `bun test` must never touch GitHub
  (L23), and the proof has to be human-visible on github.com. `tools/` is not a Bun workspace member,
  so the script imports `packages/*/src/index.ts` by relative path; that is deliberate and commented.
- **`syncPlan` trusts the run before the listing.** A resumed engine has `TaskRun.issueNumber` from
  the store; the GitHub list can lag a write by a second or two (measured: seven issues created, six
  visible ~300 ms later, one duplicate). Trusting persisted numbers removes the read entirely, and
  `settleIssues` only waits when *some but not all* of a run's issues are visible. A genuine first
  sync (zero visible) still creates immediately, so the common path pays nothing.
- **Clamping keeps both ends of a body.** The first pass truncated the tail, which cut off
  `Closes #N` and the footer; GitHub's own issue-closing automation and a judge's "what is this?"
  both live there. The middle of a runaway body is the disposable part.
- **"No commits between" is not a failure.** It means the branch is already contained in the base —
  exactly the state after a crash-and-rerun. Returning `undefined` + a `warn` keeps the merge
  idempotent without swallowing a real `gh` error (the tracker reports everything else).
- **Backoff but not primary-rate-limit backoff.** A secondary limit clears in seconds; a primary
  limit does not clear inside a run, so retrying it would only delay the honest error.
- **`warn` is an option, not `console.log`.** Library code stays quiet (AGENTS §7); the CLI/engine
  can route warnings to the EventBus, and tests assert on them.
- **The fake reproduces real stderr, not a generic error.** Every switch in `FakeGh`
  (`labelAlreadyExistsOnce`, `issueCreateMissingLabelOnce`, `noCommitsBetween`, `issueListLag`,
  `enforceBodyLimit`, `failOnce`) is pinned to a message this epic actually saw, so the regression
  tests would fail the same way the sandbox did.
- **Teardown closes, never deletes.** A sandbox is cheap to reset and expensive to recreate; keeping
  the repo (and its labels) makes a second run fast and leaves the closed PRs browsable as evidence.
- **Merging a task branch makes GitHub mark its PR as merged.** The engine merges into the
  integration branch; once those commits are in the base, GitHub reports the task PR as `MERGED`
  even though it was never merged with the green button. That is a nice accident for the demo, and
  it is why teardown only looks at *open* PRs.

## Interfaces for future epics

No public type changed. `GitHubTrackerOptions` is backwards compatible and grew only optional fields:

```ts
export interface GitHubTrackerOptions {
  repo?: string;
  cwd: string;
  exec?: typeof exec;
  dryRun?: boolean;
  labelPrefix?: string;
  /** new */ timeoutMs?: number;            // per gh/git command, default 120_000
  /** new */ retry?: GhRetryOptions;        // { attempts?, baseDelayMs?, maxDelayMs? }
  /** new */ sleep?: (ms: number) => Promise<void>;
  /** new */ warn?: (message: string) => void;
  /** new */ settleDelaysMs?: number[];     // default [600, 1800]; [] disables the wait
}

export interface TaskPRBodyOptions extends RenderContext {
  notes?: string; handback?: WorkerHandback; closes?: number;
  /** new */ localUsage?: TokenUsage;       // renders the Local row in the usage table
  /** new */ nodeName?: string;             // falls back to TaskRun.nodeId
}

export interface RenderContext { /** new */ repo?: string; prefix?: string }
export function runSearchUrl(repo: string, prefix: string, runId: string): string;
export function clampBody(body: string, max?: number): string;
export function parseGitHubRemote(remote: string): string | undefined;
export function isRetryableGhFailure(res: ExecResult): boolean;
export function backoffMs(attempt: number, retry?: GhRetryOptions): number;
/** new option in all three renderers */ renderTaskIssue(task, run, ctx?)
/** new option */ renderFinalPRBody(run, ctx?)
/** new option */ renderMergedComment(task, run, ctx?)
```

For the engine (Epic 40/49), in order:

```ts
const issues = await tracker.syncPlan(run);
for (const [key, n] of Object.entries(issues)) {
  const task = run.tasks[key];
  if (task !== undefined) task.issueNumber = n;   // makes a resumed run skip the listing
}
task.prUrl = await tracker.openTaskPR(run, task, workerFinalMessage, /* not part of the port */);
```

If the engine wants richer task PRs it can pass usage through a tracker that renders itself, but the
`Tracker` port has no options channel today; the default body already includes everything the
tracker knows.

## Deviations from plan

- **The e2e drives the tracker, not the engine** (as specified) but also merges each task branch into
  the integration branch, because otherwise the final PR had "no commits between" and GitHub
  correctly refused it. That merge is the engine's job in production.
- **`setup.sh` skips `bun install` in the demo repo by default** (`SKY_TODO_SKIP_INSTALL=1`). The
  sandbox proves branches and PRs, and installing sky-todo's dependencies would add minutes per run
  for no signal.
- **`teardown.sh` does not close merged PRs** (impossible/pointless) and does not touch labels.
- **A `tools/github-sandbox/tsconfig.json` was added** even though root `bun run check` does not
  typecheck `tools/`; the file makes the script typecheckable on demand
  (`bunx tsc --noEmit -p tools/github-sandbox/tsconfig.json`).
- **`syncPlan` now honours `TaskRun.issueNumber`**, which the Wave 1 doc did not state. It is the
  fix for GitHub's read lag, and the epic-18 "Interfaces for future epics" snippet already assigned
  the numbers back onto the run, so behaviour matches the intended engine flow.
- **`warn`/`sleep`/`settleDelaysMs`/`timeoutMs`/`retry` were added to the options** so the new
  behaviour is testable without real waiting and reportable without `console.log`.

## Known limitations / deferred

- **Read-lag window is bounded, not eliminated.** `settleIssues` waits 600 ms then 1 800 ms. If
  GitHub ever takes longer than 2.4 s to show a run's issues *and* a process has no persisted issue
  numbers, a duplicate is still possible. The fix at that point is to reconcile duplicates by
  marker after creation (cheap: list once more, comment on and close the later twin) — deferred
  because it has never been observed beyond ~1 s.
- **Issue reconciliation scans at most 500 `starling:task` issues** (Wave 1 limitation). A very busy
  repo needs pagination or a run-scoped label query.
- **`gh pr create` cannot attach the PR to the *merged* issue**; the task PR closes its issue with
  `Closes #N` in the body and the tracker also comments/closes on merge. If a human merges the task
  PR by hand before the engine does, `onMerged` sees an already-closed issue and `gh` returns exit 0
  ("already closed"), so it is harmless.
- **No `gh` call is parallelised.** Seventeen sequential calls for a 7-task run is fine at this
  scale; a 100-task plan would want a small concurrency pool.
- **Rate-limit tests are synthetic.** The exact secondary-limit text is from GitHub's documented
  message and the retry detector is unit-tested against it, but the sandbox run never hit a real
  secondary limit (deliberately: we do not want to get the account temporarily blocked).
- **`gh repo view` failing inside a worktree could not be reproduced with gh 2.98** (it resolved
  worktrees fine), so the origin-remote fallback is defensive; its test pins the stderr the epic
  prompt described.
- **The final PR is not merged and no CI runs on it** — Epic 52 owns CI.
