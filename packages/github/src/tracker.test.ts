import { describe, expect, test } from 'bun:test';
import { isStarlingError, StarlingError } from '@starling/core';
import { isGitHubError } from './errors';
import { FakeGh } from './testing/fake-gh';
import {
  BASE,
  CWD,
  HANDBACK_BLOCK,
  INTEGRATION,
  REPO,
  RUN_ID,
  RUN_SHORT,
  scenarioRun,
  taskRunOf,
} from './testing/fixtures';
import { createGitHubTracker, type GitHubTrackerOptions } from './tracker';

function trackerFor(fake: FakeGh, overrides: Partial<GitHubTrackerOptions> = {}) {
  return createGitHubTracker({ repo: REPO, cwd: CWD, exec: fake.exec, ...overrides });
}

describe('syncPlan', () => {
  test('ensures labels and creates one issue per task with goal, DoD and lane', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();

    const numbers = await tracker.syncPlan(run);

    expect(numbers).toEqual({ theme: 100, search: 101 });
    expect([...fake.labels].sort()).toEqual(['starling', `starling:run-${RUN_SHORT}`, 'starling:task']);
    expect(fake.issues).toHaveLength(2);

    const theme = fake.issues[0];
    expect(theme).toBeDefined();
    expect(theme?.title).toBe('[starling] Dark mode with a toggle');
    expect(theme?.labels).toEqual(['starling', `starling:run-${RUN_SHORT}`, 'starling:task']);
    expect(theme?.body).toContain(`<!-- starling:run=${RUN_ID} task=theme -->`);
    expect(theme?.body).toContain('### Run goal');
    expect(theme?.body).toContain('Add a dark theme and a toggle');
    expect(theme?.body).toContain('### Definition of done');
    expect(theme?.body).toContain('- [ ] bun test passes');
    expect(theme?.body).toContain('src/features/theme/**');
  });

  test('is idempotent: a second tracker finds the markers and creates nothing', async () => {
    const fake = new FakeGh();
    const run = scenarioRun();
    const first = trackerFor(fake);
    expect(await first.syncPlan(run)).toEqual({ theme: 100, search: 101 });

    const before = fake.calls.length;
    const second = trackerFor(fake);
    expect(await second.syncPlan(run)).toEqual({ theme: 100, search: 101 });

    expect(fake.issues).toHaveLength(2);
    expect([...fake.labels]).toHaveLength(3);
    const tail = fake.calls.slice(before);
    expect(tail.some((call) => call.cmd[1] === 'issue' && call.cmd[2] === 'create')).toBe(false);
    expect(tail.some((call) => call.cmd[1] === 'label' && call.cmd[2] === 'create')).toBe(false);
  });

  test('a repeated call on the same tracker makes no gh calls at all', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();
    await tracker.syncPlan(run);
    const before = fake.calls.length;

    expect(await tracker.syncPlan(run)).toEqual({ theme: 100, search: 101 });
    expect(fake.calls.length).toBe(before);
  });

  test('auto-detects the repo with gh repo view when repo is omitted', async () => {
    const fake = new FakeGh();
    const tracker = createGitHubTracker({ cwd: CWD, exec: fake.exec });
    await tracker.syncPlan(scenarioRun());

    expect(fake.callsStartingWith('gh', 'repo', 'view')).toHaveLength(1);
    const create = fake.callsStartingWith('gh', 'label', 'create')[0];
    expect(create?.cmd).toContain(REPO);
  });

  test('fails with GH_REPO when the repo cannot be detected', async () => {
    const fake = new FakeGh();
    fake.repoViewFails = true;
    const tracker = createGitHubTracker({ cwd: CWD, exec: fake.exec });

    const err = await tracker.syncPlan(scenarioRun()).catch((e: unknown) => e);
    expect(isGitHubError(err, 'GH_REPO')).toBe(true);
  });

  test('fails with GH_AUTH when gh is not logged in', async () => {
    const fake = new FakeGh();
    fake.authenticated = false;
    const tracker = trackerFor(fake);

    const err = await tracker.syncPlan(scenarioRun()).catch((e: unknown) => e);
    expect(isGitHubError(err, 'GH_AUTH')).toBe(true);
    expect(err).toBeInstanceOf(StarlingError);
    expect(isStarlingError(err)).toBe(true);
  });

  test('rejects a run with no plan', async () => {
    const fake = new FakeGh();
    const run = scenarioRun();
    run.plan = undefined;

    const err = await trackerFor(fake)
      .syncPlan(run)
      .catch((e: unknown) => e);
    expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
  });
});

describe('openTaskPR', () => {
  test('pushes the worktree branch and creates the PR with exact argv', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();
    const task = taskRunOf(run, 'theme');

    const url = await tracker.openTaskPR(run, task, `Implemented the toggle.\n\n${HANDBACK_BLOCK}`);

    expect(url).toBe('https://github.com/acme/sky-todo/pull/1');

    const push = fake.callsStartingWith('git', 'push')[0];
    expect(push?.cmd).toEqual(['git', 'push', '-u', 'origin', `starling/${RUN_SHORT}/theme`]);
    expect(push?.cwd).toBe('/tmp/starling-worktrees/theme');

    const prCall = fake.callsStartingWith('gh', 'pr', 'create')[0];
    expect(prCall).toBeDefined();
    const bodyIndex = prCall?.cmd.indexOf('--body-file') ?? -1;
    expect(bodyIndex).toBeGreaterThan(-1);
    const normalized = (prCall?.cmd ?? []).map((arg, i) => (i === bodyIndex + 1 ? '<body-file>' : arg));
    expect(normalized).toEqual([
      'gh',
      'pr',
      'create',
      '--base',
      INTEGRATION,
      '--head',
      `starling/${RUN_SHORT}/theme`,
      '--title',
      '[starling] Dark mode with a toggle',
      '--body-file',
      '<body-file>',
      '--repo',
      REPO,
    ]);

    const body = fake.prs[0]?.body ?? '';
    expect(body).toContain('## Dark mode with a toggle');
    expect(body).toContain('| Check | Result | Detail |');
    expect(body).toContain('| `tests` | ✅ | bun test: 14 pass |');
    expect(body).toContain('### Usage');
    expect(body).toContain('| Input | 1,200 |');
    expect(body).toContain('**Cost:** $0.0004');
    expect(body).toContain('### Agent handback');
    expect(body).toContain('Theme toggles and persists across reloads.');
    expect(body).toContain('src/features/theme/index.ts');
    expect(body).toContain('Closes #100');
    expect(body).toContain('Implemented the toggle.');
    expect(body).not.toContain('<<<STARLING_HANDBACK');
  });

  test('falls back to the tracker cwd when the task has no worktree', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();
    run.tasks.theme = { ...taskRunOf(run, 'theme'), worktreePath: undefined };

    await tracker.openTaskPR(run, taskRunOf(run, 'theme'), '');

    expect(fake.callsStartingWith('git', 'push')[0]?.cwd).toBe(CWD);
  });

  test('returns the existing PR URL instead of failing when the PR already exists', async () => {
    const fake = new FakeGh();
    fake.existingPrUrl = 'https://github.com/acme/sky-todo/pull/77';
    const tracker = trackerFor(fake);
    const run = scenarioRun();

    const url = await tracker.openTaskPR(run, taskRunOf(run, 'theme'), '');
    expect(url).toBe('https://github.com/acme/sky-todo/pull/77');
  });

  test('maps a push permission failure to GH_AUTH', async () => {
    const fake = new FakeGh();
    fake.pushStderr = 'remote: Permission denied (publickey).';
    const tracker = trackerFor(fake);
    const run = scenarioRun();

    const err = await tracker.openTaskPR(run, taskRunOf(run, 'theme'), '').catch((e: unknown) => e);
    expect(isGitHubError(err, 'GH_AUTH')).toBe(true);
  });

  test('rejects a run without an integration branch', async () => {
    const fake = new FakeGh();
    const run = scenarioRun();
    run.integrationBranch = undefined;

    const err = await trackerFor(fake)
      .openTaskPR(run, taskRunOf(run, 'theme'), '')
      .catch((e: unknown) => e);
    expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
  });

  test('rejects a task without a branch', async () => {
    const fake = new FakeGh();
    const run = scenarioRun();
    run.tasks.theme = { ...taskRunOf(run, 'theme'), branch: undefined };

    const err = await trackerFor(fake)
      .openTaskPR(run, taskRunOf(run, 'theme'), '')
      .catch((e: unknown) => e);
    expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
  });
});

describe('onMerged', () => {
  test('comments the verdict and closes the issue as completed', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();
    const numbers = await tracker.syncPlan(run);
    run.tasks.theme = { ...taskRunOf(run, 'theme'), issueNumber: numbers.theme };

    await tracker.onMerged(run, taskRunOf(run, 'theme'));

    const issue = fake.issue(100);
    expect(issue?.comments).toHaveLength(1);
    expect(issue?.comments[0]).toContain('### ✅ Merged');
    expect(issue?.comments[0]).toContain('Definition of done met on the second attempt.');
    expect(issue?.state).toBe('closed');
    expect(issue?.closeReason).toBe('completed');
  });

  test('closes as not planned when the last verdict failed', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();
    const numbers = await tracker.syncPlan(run);
    run.tasks.search = { ...taskRunOf(run, 'search'), status: 'merged', issueNumber: numbers.search };

    await tracker.onMerged(run, taskRunOf(run, 'search'));

    expect(fake.issue(101)?.closeReason).toBe('not planned');
  });

  test('finds the issue by marker when TaskRun.issueNumber is missing', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();
    await tracker.syncPlan(run);
    run.tasks.theme = { ...taskRunOf(run, 'theme'), issueNumber: undefined };

    await tracker.onMerged(run, taskRunOf(run, 'theme'));
    expect(fake.issue(100)?.state).toBe('closed');
  });
});

describe('openFinalPR', () => {
  test('pushes the integration branch and opens the final PR to the base branch', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake);
    const run = scenarioRun();

    const url = await tracker.openFinalPR(run, 'Run summary from the writer.');

    expect(url).toBe('https://github.com/acme/sky-todo/pull/1');
    const push = fake.callsStartingWith('git', 'push')[0];
    expect(push?.cmd).toEqual(['git', 'push', '-u', 'origin', INTEGRATION]);
    expect(push?.cwd).toBe(CWD);

    const prCall = fake.callsStartingWith('gh', 'pr', 'create')[0];
    const bodyIndex = prCall?.cmd.indexOf('--body-file') ?? -1;
    const normalized = (prCall?.cmd ?? []).map((arg, i) => (i === bodyIndex + 1 ? '<body-file>' : arg));
    expect(normalized).toEqual([
      'gh',
      'pr',
      'create',
      '--base',
      BASE,
      '--head',
      INTEGRATION,
      '--title',
      '[starling] Add dark mode and live search to sky-todo',
      '--body-file',
      '<body-file>',
      '--repo',
      REPO,
    ]);

    const body = fake.prs[0]?.body ?? '';
    expect(body).toContain('Run summary from the writer.');
    expect(body).toContain('## Tasks');
    expect(body).toContain('| API | 1,700 | 460 | 200 | $0.0005 |');
    expect(body).toContain('**Saved vs API:** $0.0034 across 6 local calls');
  });
});

describe('dry run', () => {
  test('executes nothing and records every gh/git argv', async () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake, { dryRun: true });
    const run = scenarioRun();

    expect(await tracker.syncPlan(run)).toEqual({});
    expect(await tracker.openTaskPR(run, taskRunOf(run, 'theme'), 'notes')).toBeUndefined();
    await tracker.onMerged(run, taskRunOf(run, 'theme'));
    expect(await tracker.openFinalPR(run, 'final notes')).toBeUndefined();

    expect(fake.calls).toHaveLength(0);
    const log = tracker.dryRunLog();
    expect(log.every((line) => line.startsWith('gh ') || line.startsWith('git '))).toBe(true);
    expect(log.some((line) => line.startsWith('gh label create starling '))).toBe(true);
    expect(
      log.some(
        (line) =>
          line.startsWith('gh issue create') && line.includes("--title '[starling] Dark mode with a toggle'"),
      ),
    ).toBe(true);
    expect(log).toContain(`git push -u origin starling/${RUN_SHORT}/theme`);
    expect(
      log.some(
        (line) => line.startsWith('gh pr create') && line.includes(`--head starling/${RUN_SHORT}/theme`),
      ),
    ).toBe(true);
    expect(
      log.some((line) => line.startsWith('gh issue close 100') && line.includes('--reason completed')),
    ).toBe(true);
    expect(log).toContain(`git push -u origin ${INTEGRATION}`);
    expect(log.some((line) => line.startsWith('gh pr create') && line.includes(`--base ${BASE}`))).toBe(true);
  });

  test('returns a defensive copy of the log', () => {
    const fake = new FakeGh();
    const tracker = trackerFor(fake, { dryRun: true });
    const log = tracker.dryRunLog();
    log.push('not a command');
    expect(tracker.dryRunLog()).not.toContain('not a command');
  });
});
