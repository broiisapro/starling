# Epic 18 — GitHub tracker

## Goal

Make a Starling run reviewable by humans the normal way. In GitHub mode the engine's `Tracker` mirrors
the run onto the repo: one issue per task (goal, deliverables, DoD checklist, lane), a PR per task
branch that carries the audit verdict and closes its issue, and a final PR from the integration branch
to the base branch. Everything is `gh` CLI (ARCHITECTURE L14), nothing in this package merges.

## How it works

`createGitHubTracker({ repo?, cwd, exec?, dryRun?, labelPrefix? })` returns the `Tracker` port plus
`dryRunLog()`.

| file               | role                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/tracker.ts`   | `createGitHubTracker`: label/issue sync, task PRs, merge comment, final PR                                  |
| `src/gh.ts`        | `GhClient`: one auth probe, lazy `gh repo view` detection, JSON helpers, dry-run argv log                   |
| `src/render.ts`    | pure markdown renderers (`renderTaskIssue`, `renderTaskPRBody`, `renderFinalPRBody`, `renderMergedComment`) |
| `src/errors.ts`    | `GitHubError` / `isGitHubError` with `GH_AUTH`, `GH_REPO`, `GH_COMMAND`, `GH_MISSING`                       |
| `src/handshake.ts` | locally mirrored `WorkerHandback` (ARCHITECTURE §8) plus a forgiving parser                                 |
| `src/testing/`     | stateful `FakeGh` exec + a fixed two-task run fixture; never executed against GitHub                        |

### syncPlan

1. Ensure three labels (created only when missing): `<prefix>`, `<prefix>:run-<runShort>`,
   `<prefix>:task`. `runShort` is core's `shortId(run.id)`, the same tail used in branch names.
2. Load existing issues once: `gh issue list --label <prefix>:task --state all --limit 500 --json number,body`
   and index them by the hidden marker `<!-- starling:run=<id> task=<key> -->`.
3. For every task without a marker, write the rendered issue to a temp body file and
   `gh issue create --title "[starling] <title>" --body-file … --label … --repo …`.
   Returns `taskKey → issue number`.

### openTaskPR

`git push -u origin <branch>` from the task's worktree (or the tracker `cwd` when there is none), then
`gh pr create --base <integration> --head <branch> --title "[starling] <title>" --body-file … --repo …`.
The body is the engine's notes plus the rendered verdict table, usage/cost and — when a handback block
is present — the worker's summary, files and tests. `Closes #<issue>` is placed just before the footer.
An "already exists" response is not an error: the existing PR URL is parsed out of stderr and returned.

### onMerged / openFinalPR

`onMerged` comments the verdict summary on the task issue and closes it (`completed` when the last
verdict passed or is absent, `not planned` when it failed). A missing issue is a no-op in real mode so
a merge is never blocked by bookkeeping. `openFinalPR` pushes the integration branch and opens a PR to
`run.goal.baseBranch` with the task table, totals and the API-vs-local cost split.

Task PRs are opened before `onMerged`, so a merged task's issue closes exactly once; re-running the
engine after a crash reuses the same issues (markers) and PRs (existing-PR URL).

### Dry run

With `dryRun: true` no process is spawned. Every `gh`/`git` argv is recorded through `shellJoin` (the
same quoting a shell would need) in `dryRunLog()`. Because a dry run cannot ask GitHub what already
exists, it previews the label and issue creates for every task even when a live run would skip them.

## Key decisions & reasoning

- **Markers + one label query instead of `gh issue list --search`.** GitHub's search index does not
  reliably cover HTML comments inside issue bodies. Listing issues by the `starling:task` label and
  matching the marker locally is one request and always correct. The same pass fills the in-memory
  map, so a second `syncPlan` (even from a new tracker instance) creates nothing.
- **Labels are cached per client, not per process.** A second call on the same tracker makes zero gh
  calls (tested); a new tracker still checks the labels for real, so a fresh process repairs drift.
- **`Closes #N` lives in the PR renderer, not in string concatenation.** One document means the
  footer stays last and the body is snapshot-testable as a unit.
- **The worker handback is parsed, not pasted.** `parseWorkerHandback` pulls the
  `<<<STARLING_HANDBACK …` JSON block out of the engine-supplied body and `stripWorkerHandback`
  removes it from the human notes; the PR shows prose + a structured section, never raw JSON.
  Parsing is deliberately forgiving: a malformed block degrades to notes instead of failing a PR.
- **`GitHubError` is a local subclass, not a core change.** `StarlingErrorCode` is frozen for Wave 1
  and has no GitHub member. `GitHubError` keeps `isStarlingError()` true, maps to the closest core
  code (`EXEC_FAILED`, `CONFIG_INVALID`) and carries `githubCode` in `details`. This is the one
  deliverable not met literally (`StarlingError('GH_AUTH')`); see CONTRACT REQUEST in the handback.
- **Auth and repo detection are lazy.** `gh auth status` runs once per client and maps a failure to
  `GH_AUTH` with "run `gh auth login`" in the message. `gh repo view --json nameWithOwner` only runs
  when no `repo` option is given, and its failure is `GH_REPO` (auth-looking stderr is promoted).
- **Auth-looking stderr promotions apply to every command.** A `git push` or `gh pr create` rejected
  for credentials becomes `GH_AUTH`, not a generic exit-code error, so the CLI can tell the user to
  log in rather than dump a stack trace.
- **Tracker methods are idempotent and do not mutate `Run`.** `syncPlan` returns the map the engine
  assigns; `TaskRun.issueNumber`/`prUrl` stay engine-owned. Re-running is safe.
- **The fake is stateful.** A canned-response fake cannot prove cross-instance idempotency, so
  `FakeGh` implements `label list/create`, `issue list/create/comment/close`, `pr create`, repo
  detection and auth in memory, and reads the real temp body files during the call.
- **Snapshots are Bun's own format** under `src/__snapshots__/render.test.ts.snap`, committed, with
  small assertions on the important lines so a snapshot update cannot silently drop `Closes #` or the
  verdict icons.

## Interfaces for future epics

```ts
import type { ExecResult, Run, TaskRun, TaskSpec, Tracker } from '@starling/core';
import type { WorkerHandback } from '@starling/github';

export type GitHubErrorCode = 'GH_AUTH' | 'GH_REPO' | 'GH_COMMAND' | 'GH_MISSING';

export interface GitHubTrackerOptions {
  repo?: string; // owner/name; auto-detected with `gh repo view` when omitted
  cwd: string;
  exec?: typeof exec;
  dryRun?: boolean;
  labelPrefix?: string; // default 'starling'
}

export interface GitHubTracker extends Tracker {
  dryRunLog(): string[];
}

export function createGitHubTracker(options: GitHubTrackerOptions): GitHubTracker;

export function renderTaskIssue(task: TaskSpec, run: Run): string;
export interface TaskPRBodyOptions {
  notes?: string;
  handback?: WorkerHandback;
  closes?: number;
}
export function renderTaskPRBody(task: TaskSpec, run: Run, extra?: TaskPRBodyOptions): string;
export function renderFinalPRBody(run: Run): string;
export function renderMergedComment(task: TaskSpec, run: Run): string;
export function taskMarker(runId: string, taskKey: string): string;

export function parseWorkerHandback(text: string): WorkerHandback | undefined;
export function stripWorkerHandback(text: string): string;

export class GitHubError extends StarlingError {
  readonly githubCode: GitHubErrorCode;
}
export function isGitHubError(err: unknown, code?: GitHubErrorCode): err is GitHubError;
```

Wiring it in the engine (Wave 2) — the engine already owns `Run` and the worker output:

```ts
import { createGitHubTracker } from '@starling/github';
import { NoopTracker } from '@starling/core/testing';

const tracker = config.github.enabled
  ? createGitHubTracker({
      repo: config.github.repo ?? undefined,
      cwd: run.goal.repoPath,
      dryRun,
    })
  : new NoopTracker();

const issueNumbers = await tracker.syncPlan(run);
for (const [key, number] of Object.entries(issueNumbers)) {
  const taskRun = run.tasks[key];
  if (taskRun) taskRun.issueNumber = number;
}

task.prUrl = await tracker.openTaskPR(run, task, workerFinalMessage);
await tracker.onMerged(run, task); // only after Merger reports merged
const finalUrl = await tracker.openFinalPR(run, writerSummary);
```

`GitHubError.githubCode` is the field to branch on (e.g. `starling doctor` says "run gh auth login"
for `GH_AUTH`); `instanceof StarlingError` and `isStarlingError()` still hold for generic handling.

## Deviations from plan

- **`GH_AUTH` is carried by `GitHubError.githubCode`, not by `StarlingError.code`.** The core code
  union is frozen and does not include GitHub codes; a contract request follows in the handback.
- **`renderTaskPRBody` grew an optional third argument** (`{ notes?, handback?, closes? }`) so the PR
  body is one coherent document. The required `(task, run)` call still works.
- **`renderMergedComment(task, run)` was added** even though the deliverable only listed three
  renderers; `onMerged` needs a reviewable comment and the logic belongs with the other markdown.
- **Issue lookup lists by label instead of searching the marker** (reason above).
- **Dry-run `syncPlan` returns `{}`.** Fabricating issue numbers would be a lie; the CLI shows the
  `gh issue create` argv it would run instead.
- **Extra exports**: `GhClient`, `shellJoin`, `taskMarker`, the `testing/` doubles. `GhClient` is
  useful for a future `starling doctor` check; the doubles exist so no Wave 1 test touches GitHub.
- **No `*.live.test.ts` was added.** Live repo verification is explicitly Epic 43's job (Wave 2).

## Known limitations / deferred

- No timeout or retry/backoff around `gh`/`git`: a hung network call hangs the tracker, and rate
  limiting surfaces as `GH_COMMAND`. Add `timeoutMs` and a small retry policy when Wave 2 runs this
  against real repos (Epic 43).
- Issue reconciliation scans the newest 500 `starling:task` issues. A repo with more than that across
  many runs could miss a marker and create a duplicate; pagination or a run-scoped label query fixes
  it.
- Dry-run is illustrative, not a diff against live GitHub state: it cannot know which labels/issues
  already exist, and it prints `OWNER/REPO` / `<issue-number>` placeholders when those are unknown.
- Label colours/descriptions are fixed constants; users cannot theme them.
- The tracker only publishes. It never edits issues from plan changes, never deletes labels, never
  reopens a closed issue, and never comments on PRs.
- The task branch must already contain the worker's commit. The tracker pushes it but does not commit;
  that remains `Workspace.commitAll`'s job.
- PR URLs must be `https://…/pull/<n>`; `gh` always prints that shape, but a GitHub Enterprise host
  with a path prefix is not handled.
