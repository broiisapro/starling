import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run, TaskRun, TaskSpec, Tracker } from '@starling/core';
import { type exec, StarlingError, shortId } from '@starling/core';
import { GitHubError } from './errors';
import { clampBody, GhClient, type GhRetryOptions } from './gh';
import { parseWorkerHandback, stripWorkerHandback } from './handshake';
import { renderFinalPRBody, renderMergedComment, renderTaskIssue, renderTaskPRBody } from './render';

export interface GitHubTrackerOptions {
  /** `owner/name`. Auto-detected with `gh repo view` (or the `origin` remote) when omitted. */
  repo?: string;
  /** Directory to run gh in. For task operations the worktree wins when the TaskRun has one. */
  cwd: string;
  /** Injected for tests; defaults to core's `exec`. */
  exec?: typeof exec;
  /** Record every gh/git argv instead of running it. */
  dryRun?: boolean;
  /** Label/title namespace. Default `starling`. */
  labelPrefix?: string;
  /** Per-command timeout for `gh`/`git`. Default 120 s. */
  timeoutMs?: number;
  /** Backoff policy for secondary rate limits. */
  retry?: GhRetryOptions;
  /** Injected in tests so backoff does not really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Called for non-fatal bookkeeping problems (nothing to review, a retry, …). */
  warn?: (message: string) => void;
  /**
   * Delays tried when a run's issues are only partly visible to `gh issue list` (GitHub's read
   * model lags writes by a second or two). Default `[600, 1800]`; `[]` disables the wait.
   */
  settleDelaysMs?: number[];
}

export interface GitHubTracker extends Tracker {
  /** The argv Starling would have run, oldest first. Empty unless `dryRun` is set. */
  dryRunLog(): string[];
}

const MARKER_RE = /<!-- starling:run=(\S+) task=(\S+) -->/;
const ISSUE_RE = /\/issues\/(\d+)/;
const PR_RE = /https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/;

/**
 * A `Tracker` that mirrors a run onto GitHub with the `gh` CLI (L14).
 *
 * The engine has already decided *what* happened; this class only publishes it. That keeps the
 * GitHub surface small: no merging, no CI, no webhooks. Every call is safe to repeat: issues are
 * found by their hidden marker, an existing PR URL is reused, an empty branch is skipped, and a
 * label that another Starling process just created is not an error.
 */
export function createGitHubTracker(options: GitHubTrackerOptions): GitHubTracker {
  const prefix = options.labelPrefix ?? 'starling';
  const dryRun = options.dryRun ?? false;
  const warn = options.warn ?? (() => {});
  const log: string[] = [];
  const gh = new GhClient({
    cwd: options.cwd,
    ...(options.exec === undefined ? {} : { execFn: options.exec }),
    dryRun,
    log,
    ...(options.repo === undefined ? {} : { repo: options.repo }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    warn,
  });

  const ensuredLabels = new Set<string>();
  const knownIssues = new Map<string, number>();
  let issuesLoaded = false;
  let tempCounter = 0;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const settleDelays = options.settleDelaysMs ?? [600, 1_800];

  const runLabel = (run: Run): string => `${prefix}:run-${shortId(run.id)}`;

  function requirePlan(run: Run) {
    if (run.plan === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `Run ${run.id} has no plan; cannot mirror it on GitHub.`);
    }
    return run.plan;
  }

  function requireTask(run: Run, taskKey: string): TaskSpec {
    const spec = requirePlan(run).tasks.find((task) => task.key === taskKey);
    if (spec === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `Task ${taskKey} is not part of run ${run.id}'s plan.`);
    }
    return spec;
  }

  function requireIntegrationBranch(run: Run): string {
    if (run.integrationBranch === undefined || run.integrationBranch === '') {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `Run ${run.id} has no integration branch yet; create it before opening a PR.`,
      );
    }
    return run.integrationBranch;
  }

  async function ensureLabels(run: Run): Promise<void> {
    const desired = [
      { name: prefix, color: '1f6feb', description: 'Planned and tracked by Starling' },
      {
        name: runLabel(run),
        color: '6f42c1',
        description: `Tasks in Starling run ${shortId(run.id)}`,
      },
      { name: `${prefix}:task`, color: '0e8a16', description: 'One issue per Starling task' },
    ].filter((label) => !ensuredLabels.has(label.name));

    if (desired.length === 0) return;

    const existing = await gh.labelNames();
    const repo = await gh.repo();
    for (const label of desired) {
      if (!existing.has(label.name)) {
        const res = await gh.gh([
          'label',
          'create',
          label.name,
          '--color',
          label.color,
          '--description',
          label.description,
          '--repo',
          repo,
        ]);
        // Another Starling process (or a human) can create it between our list and our create.
        // Real gh: `label with name "x" already exists; use --force to update …` and exit 1.
        if (res.code !== 0 && !/already exists/i.test(res.stderr)) {
          throw gh.failure(`gh label create ${label.name}`, res);
        }
      }
      ensuredLabels.add(label.name);
    }
  }

  async function loadIssues(): Promise<void> {
    if (issuesLoaded) return;
    await mergeIssues();
    issuesLoaded = true;
  }

  async function mergeIssues(): Promise<void> {
    const issues = await gh.issuesWithLabel(`${prefix}:task`);
    for (const issue of issues) {
      const match = MARKER_RE.exec(issue.body);
      if (match !== null && match[1] !== undefined && match[2] !== undefined) {
        knownIssues.set(issueKey(match[1], match[2]), issue.number);
      }
    }
  }

  /**
   * GitHub's issue list can lag a write by a second or two (observed in the Epic 43 sandbox: a
   * re-sync 300 ms after creating seven issues saw only six and created a duplicate). When *some*
   * of this run's issues are visible but not all, wait and re-list before concluding that the rest
   * were never created. A run with no visible issues at all is a genuine first sync and is not
   * delayed.
   */
  async function settleIssues(run: Run): Promise<void> {
    const plan = requirePlan(run);
    const missingCount = (): number =>
      plan.tasks.filter((task) => !knownIssues.has(issueKey(run.id, task.key))).length;
    if (missingCount() === 0 || missingCount() === plan.tasks.length) return;

    for (const delay of settleDelays) {
      warn(
        `Only ${plan.tasks.length - missingCount()}/${plan.tasks.length} issues are visible yet; re-listing in ${delay} ms.`,
      );
      await sleep(delay);
      await mergeIssues();
      if (missingCount() === 0) return;
    }
  }

  async function issueFor(run: Run, task: TaskRun): Promise<number | undefined> {
    if (task.issueNumber !== undefined) return task.issueNumber;
    await loadIssues();
    return knownIssues.get(issueKey(run.id, task.taskKey));
  }

  async function withBodyFile<T>(name: string, body: string, fn: (path: string) => Promise<T>): Promise<T> {
    tempCounter += 1;
    const path = join(tmpdir(), `starling-gh-${process.pid}-${tempCounter}-${slug(name)}.md`);
    if (dryRun) return fn(path);
    // GitHub's 65,536-character cap is real for issues as well as PRs; long worker notes are the
    // usual way to hit it. `clampBody` keeps the head of the document and says it was cut.
    await Bun.write(path, clampBody(body));
    try {
      return await fn(path);
    } finally {
      await rm(path, { force: true });
    }
  }

  async function createIssue(run: Run, spec: TaskSpec, bodyFile: string): Promise<number | undefined> {
    const repo = await gh.repo();
    const argv = [
      'issue',
      'create',
      '--title',
      `[${prefix}] ${spec.title}`,
      '--body-file',
      bodyFile,
      '--label',
      prefix,
      '--label',
      runLabel(run),
      '--label',
      `${prefix}:task`,
      '--repo',
      repo,
    ];
    let res = await gh.gh(argv);
    // Labels are created just before this call, but a concurrent tracker can create the issues
    // first and a label can be deleted in between. Real gh says:
    // `could not add label: 'starling:task' not found`. Re-assert the labels and try once more.
    if (res.code !== 0 && /could not add label/i.test(res.stderr)) {
      ensuredLabels.clear();
      warn('A label went missing while creating an issue; re-creating the labels and retrying once.');
      await ensureLabels(run);
      res = await gh.gh(argv);
    }
    if (res.code !== 0) throw gh.failure('gh issue create', res);
    if (dryRun) return undefined;

    const parsed = ISSUE_RE.exec(res.stdout)?.[1];
    if (parsed === undefined) {
      throw new GitHubError('GH_COMMAND', 'gh issue create succeeded but printed no issue number.', {
        details: { stdout: res.stdout.trim().slice(-400) },
      });
    }
    return Number(parsed);
  }

  async function createPR(args: {
    cwd: string;
    base: string;
    head: string;
    title: string;
    body: string;
    name: string;
  }): Promise<string | undefined> {
    return withBodyFile(args.name, args.body, async (bodyFile) => {
      const res = await gh.gh(
        [
          'pr',
          'create',
          '--base',
          args.base,
          '--head',
          args.head,
          '--title',
          args.title,
          '--body-file',
          bodyFile,
          '--repo',
          await gh.repo(),
        ],
        args.cwd,
      );

      if (res.code !== 0) {
        const combined = `${res.stdout}\n${res.stderr}`;
        // Re-running the engine after a crash should not fail because the PR already exists.
        const existing = PR_RE.exec(combined)?.[0];
        if (existing !== undefined && /already exists/i.test(res.stderr)) return existing;
        // The branch is already fully contained in the base (re-run after a merge). There is
        // nothing to review; a tracker must not turn that into a failed task.
        if (/no commits between/i.test(combined)) {
          warn(`Nothing to review: \`${args.head}\` has no commits that \`${args.base}\` lacks.`);
          return undefined;
        }
        throw gh.failure('gh pr create', res);
      }

      if (dryRun) return undefined;
      const url = PR_RE.exec(res.stdout)?.[0];
      if (url === undefined) {
        throw new GitHubError('GH_COMMAND', 'gh pr create succeeded but printed no PR URL.', {
          details: { stdout: res.stdout.trim().slice(-400) },
        });
      }
      return url;
    });
  }

  return {
    dryRunLog(): string[] {
      return gh.dryRunLog();
    },

    async syncPlan(run: Run): Promise<Record<string, number>> {
      const plan = requirePlan(run);
      await ensureLabels(run);
      await loadIssues();
      await settleIssues(run);

      const numbers: Record<string, number> = {};
      for (const spec of plan.tasks) {
        const key = issueKey(run.id, spec.key);
        // A resumed run already knows its numbers from the store; trust them over a lagging list.
        const fromRun = run.tasks[spec.key]?.issueNumber;
        const known = fromRun ?? knownIssues.get(key);
        if (known !== undefined) {
          knownIssues.set(key, known);
          numbers[spec.key] = known;
          continue;
        }

        const body = renderTaskIssue(spec, run, { repo: await gh.repo(), prefix });
        const number = await withBodyFile(`issue-${spec.key}`, body, (bodyFile) =>
          createIssue(run, spec, bodyFile),
        );

        if (number !== undefined) {
          knownIssues.set(key, number);
          numbers[spec.key] = number;
        }
      }

      return numbers;
    },

    async openTaskPR(run: Run, task: TaskRun, body: string): Promise<string | undefined> {
      const spec = requireTask(run, task.taskKey);
      const integration = requireIntegrationBranch(run);
      if (task.branch === undefined || task.branch === '') {
        throw new StarlingError('INVALID_ARGUMENT', `Task ${task.taskKey} has no branch to open a PR from.`);
      }

      const issue = await issueFor(run, task);
      const notes = stripWorkerHandback(body);
      const handback = parseWorkerHandback(body);
      const prBody = renderTaskPRBody(spec, run, {
        ...(notes === '' ? {} : { notes }),
        ...(handback === undefined ? {} : { handback }),
        ...(issue === undefined ? {} : { closes: issue }),
        repo: await gh.repo(),
        prefix,
      });

      const worktree = task.worktreePath ?? options.cwd;
      const push = await gh.git(['push', '-u', 'origin', task.branch], worktree);
      if (push.code !== 0) throw gh.failure(`git push ${task.branch}`, push);

      return createPR({
        cwd: worktree,
        base: integration,
        head: task.branch,
        title: `[${prefix}] ${spec.title}`,
        body: prBody,
        name: `pr-${task.taskKey}`,
      });
    },

    async onMerged(run: Run, task: TaskRun): Promise<void> {
      const spec = requireTask(run, task.taskKey);
      const issue = await issueFor(run, task);
      if (issue === undefined && !dryRun) return; // No issue to close; merging must still succeed.

      const target = issue === undefined ? '<issue-number>' : String(issue);
      const repo = await gh.repo();
      const comment = renderMergedComment(spec, run, { repo, prefix });

      await withBodyFile(`merged-${task.taskKey}`, comment, async (bodyFile) => {
        const res = await gh.gh(['issue', 'comment', target, '--body-file', bodyFile, '--repo', repo]);
        if (res.code !== 0) throw gh.failure(`gh issue comment ${target}`, res);
      });

      const reason = task.lastVerdict?.pass === false ? 'not planned' : 'completed';
      const res = await gh.gh(['issue', 'close', target, '--reason', reason, '--repo', repo]);
      if (res.code !== 0) throw gh.failure(`gh issue close ${target}`, res);
    },

    async openFinalPR(run: Run, body: string): Promise<string | undefined> {
      const integration = requireIntegrationBranch(run);
      const notes = body.trim();
      const rendered = renderFinalPRBody(run, { repo: await gh.repo(), prefix });
      const prBody = notes === '' ? rendered : `${notes}\n\n---\n\n${rendered}`;

      const push = await gh.git(['push', '-u', 'origin', integration], options.cwd);
      if (push.code !== 0) throw gh.failure(`git push ${integration}`, push);

      return createPR({
        cwd: options.cwd,
        base: run.goal.baseBranch,
        head: integration,
        title: `[${prefix}] ${goalTitle(run.goal.text)}`,
        body: prBody,
        name: 'final-pr',
      });
    },
  };
}

function issueKey(runId: string, taskKey: string): string {
  return `${runId}:${taskKey}`;
}

function goalTitle(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? text.trim();
  return firstLine.length <= 68 ? firstLine : `${firstLine.slice(0, 67)}…`;
}

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-');
}
