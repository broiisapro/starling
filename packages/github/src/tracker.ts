import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run, TaskRun, TaskSpec, Tracker } from '@starling/core';
import { type exec, StarlingError, shortId } from '@starling/core';
import { GitHubError } from './errors';
import { GhClient } from './gh';
import { parseWorkerHandback, stripWorkerHandback } from './handshake';
import { renderFinalPRBody, renderMergedComment, renderTaskIssue, renderTaskPRBody } from './render';

export interface GitHubTrackerOptions {
  /** `owner/name`. Auto-detected with `gh repo view` when omitted. */
  repo?: string;
  /** Directory to run gh in. For task operations the worktree wins when the TaskRun has one. */
  cwd: string;
  /** Injected for tests; defaults to core's `exec`. */
  exec?: typeof exec;
  /** Record every gh/git argv instead of running it. */
  dryRun?: boolean;
  /** Label/title namespace. Default `starling`. */
  labelPrefix?: string;
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
 * GitHub surface small: no merging, no CI, no webhooks (out of scope for epic 18).
 */
export function createGitHubTracker(options: GitHubTrackerOptions): GitHubTracker {
  const prefix = options.labelPrefix ?? 'starling';
  const dryRun = options.dryRun ?? false;
  const log: string[] = [];
  const gh = new GhClient({
    cwd: options.cwd,
    ...(options.exec === undefined ? {} : { execFn: options.exec }),
    dryRun,
    log,
    ...(options.repo === undefined ? {} : { repo: options.repo }),
  });

  const ensuredLabels = new Set<string>();
  const knownIssues = new Map<string, number>();
  let issuesLoaded = false;
  let tempCounter = 0;

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
        if (res.code !== 0) throw gh.failure(`gh label create ${label.name}`, res);
      }
      ensuredLabels.add(label.name);
    }
  }

  async function loadIssues(): Promise<void> {
    if (issuesLoaded) return;
    const issues = await gh.issuesWithLabel(`${prefix}:task`);
    for (const issue of issues) {
      const match = MARKER_RE.exec(issue.body);
      if (match !== null && match[1] !== undefined && match[2] !== undefined) {
        knownIssues.set(issueKey(match[1], match[2]), issue.number);
      }
    }
    issuesLoaded = true;
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
    await Bun.write(path, body);
    try {
      return await fn(path);
    } finally {
      await rm(path, { force: true });
    }
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
        // Re-running the engine after a crash should not fail because the PR already exists.
        const existing = PR_RE.exec(`${res.stdout}\n${res.stderr}`)?.[0];
        if (existing !== undefined && /already exists/i.test(res.stderr)) return existing;
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

      const repo = await gh.repo();
      const numbers: Record<string, number> = {};

      for (const spec of plan.tasks) {
        const key = issueKey(run.id, spec.key);
        const known = knownIssues.get(key);
        if (known !== undefined) {
          numbers[spec.key] = known;
          continue;
        }

        const body = renderTaskIssue(spec, run);
        const title = `[${prefix}] ${spec.title}`;
        const number = await withBodyFile(`issue-${spec.key}`, body, async (bodyFile) => {
          const res = await gh.gh([
            'issue',
            'create',
            '--title',
            title,
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
          ]);
          if (res.code !== 0) throw gh.failure('gh issue create', res);
          if (dryRun) return undefined;
          const parsed = ISSUE_RE.exec(res.stdout)?.[1];
          if (parsed === undefined) {
            throw new GitHubError('GH_COMMAND', 'gh issue create succeeded but printed no issue number.', {
              details: { stdout: res.stdout.trim().slice(-400) },
            });
          }
          return Number(parsed);
        });

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
      const comment = renderMergedComment(spec, run);

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
      const rendered = renderFinalPRBody(run);
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
