/**
 * e2e.ts — prove the GitHub tracker against a real private repo, with no engine and no LLM.
 *
 *   bash tools/github-sandbox/setup.sh
 *   bun tools/github-sandbox/e2e.ts [--keep] [--repo owner/name] [--dir /path/to/clone]
 *
 * What it does, in order:
 *   1. clones the sandbox (or reuses `--dir`), creates the integration branch on `main`
 *   2. `syncPlan` over the 7-task launch-day fixture → 7 issues; a second tracker instance must
 *      create 0 more (checked against the real issue list, not just in memory)
 *   3. for two tasks: a branch with a tiny real commit → `openTaskPR` (into the integration
 *      branch, body carries the verdict table) → `onMerged` (comment + close the issue)
 *   4. `openFinalPR` from the integration branch to `main`
 *   5. prints every issue/PR URL, then runs `teardown.sh` unless `--keep`
 *
 * It is deliberately not a test: `bun test` must never touch GitHub (ARCHITECTURE L23). This is the
 * manual, judge-visible proof (Epic 43) and it lives outside the workspace on purpose, importing
 * the packages by relative path because `tools/` is not a Bun workspace member.
 */

import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditVerdict, Plan, Run, TaskRun } from '../../packages/core/src/index.ts';
import { emptyMetrics, exec, newId, PlanSchema, shortId } from '../../packages/core/src/index.ts';
import { createGitHubTracker } from '../../packages/github/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIXTURE = join(ROOT, 'fixtures', 'plans', 'sky-todo-launch-day.json');
const TEARDOWN = join(HERE, 'teardown.sh');

interface E2eOptions {
  repo?: string;
  dir?: string;
  keep: boolean;
}

interface Created {
  task: string;
  issue: number;
  issueUrl: string;
  prUrl?: string;
}

function parseArgs(argv: string[]): E2eOptions {
  const options: E2eOptions = { keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep') options.keep = true;
    else if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--dir') options.dir = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: bun tools/github-sandbox/e2e.ts [--keep] [--repo owner/name] [--dir path]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repo = options.repo ?? process.env.STARLING_SANDBOX_REPO ?? (await defaultRepo());
  await assertRepoExists(repo);

  const dir = options.dir ?? join(tmpdir(), `starling-gh-e2e-${Date.now()}`);
  await clone(repo, dir);

  const plan: Plan = PlanSchema.parse(await Bun.file(FIXTURE).json());
  const runId = newId();
  const integrationBranch = `starling/${shortId(runId)}/integration`;
  const run = buildRun(plan, runId, integrationBranch, dir);

  header(`Epic 43 tracker E2E · ${repo}`, [
    `run     ${runId} (short ${shortId(runId)})`,
    `clone   ${dir}`,
    `branch  ${integrationBranch} (from ${run.goal.baseBranch})`,
  ]);

  await createIntegrationBranch(dir, integrationBranch);

  const tracker = createGitHubTracker({ repo, cwd: dir, warn: (m) => note(`warn: ${m}`) });

  // ── 1. plan → issues, three ways ────────────────────────────────────────────────────────────
  const first = await tracker.syncPlan(run);
  const created = Object.keys(first).length;
  expect(created === plan.tasks.length, `syncPlan created ${created} issues, expected ${plan.tasks.length}`);
  const afterFirst = await waitForRunIssues(repo, run.id, dir, plan.tasks.length);
  expect(
    afterFirst.length === plan.tasks.length,
    `expected ${plan.tasks.length} issues for this run, GitHub shows ${afterFirst.length}`,
  );
  assignIssues(run, first);

  // Re-run 1: a new tracker with the numbers a resumed engine restored from the store.
  const rerunSame = await createGitHubTracker({ repo, cwd: dir }).syncPlan(run);
  // Re-run 2: marker-only, i.e. a process that lost its state and must find the issues by body.
  const rerunMarkers = await createGitHubTracker({ repo, cwd: dir }).syncPlan(withoutIssues(run));

  const sameNumbers = (a: Record<string, number>, b: Record<string, number>): boolean =>
    JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  expect(sameNumbers(first, rerunSame), 'the second syncPlan returned different issue numbers');
  expect(sameNumbers(first, rerunMarkers), 'the marker-only syncPlan returned different issue numbers');

  const afterReruns = await waitForRunIssues(repo, run.id, dir, plan.tasks.length);
  expect(
    afterReruns.length === plan.tasks.length,
    `re-running syncPlan created duplicates: ${afterReruns.length} issues for ${plan.tasks.length} tasks`,
  );

  note(`syncPlan: ${created} issues created`);
  note(`syncPlan again (numbers restored): 0 created, same ${Object.keys(rerunSame).length} numbers`);
  note(`syncPlan a third time (markers only): 0 created, no duplicates (${afterReruns.length} issues)`);
  for (const task of plan.tasks) {
    const number = first[task.key];
    if (number === undefined) continue;
    note(`  ${task.key.padEnd(12)} #${number}  ${issueUrl(repo, number)}`);
  }

  // ── 2. two task branches → PRs → merged issues ──────────────────────────────────────────────
  const demoTaskKeys = ['theme', 'search'];
  const results: Created[] = [];
  for (const key of demoTaskKeys) {
    const spec = plan.tasks.find((task) => task.key === key);
    if (spec === undefined) throw new Error(`fixture has no task ${key}`);
    const issueNumber = first[key];
    if (issueNumber === undefined) throw new Error(`syncPlan returned no issue for ${key}`);

    const branch = `starling/${shortId(runId)}/${key}`;
    await createTaskBranch(dir, branch, integrationBranch, key, spec.title);

    const taskRun: TaskRun = {
      runId,
      taskKey: key,
      status: 'merged',
      branch,
      worktreePath: dir,
      attempts: 1,
      startedAt: run.startedAt + 1_000,
      finishedAt: run.startedAt + 120_000,
      usage: { input: 2_400, output: 620, cached: 480 },
      costUsd: 0.00071,
      issueNumber,
      nodeId: 'hub',
      lastVerdict: verdictFor(key, spec.title),
    };
    run.tasks[key] = taskRun;

    const prUrl = await tracker.openTaskPR(run, taskRun, workerNotes(key, spec.title));
    taskRun.prUrl = prUrl;
    // The engine merges an audited branch into the integration branch; do the same so the final PR
    // has something to propose (the task PR is just the human-facing review artifact).
    await mergeIntoIntegration(dir, branch, integrationBranch, key);
    await tracker.onMerged(run, taskRun);

    results.push({
      task: key,
      issue: issueNumber,
      issueUrl: issueUrl(repo, issueNumber),
      ...(prUrl === undefined ? {} : { prUrl }),
    });
    note(`${key}: PR ${prUrl ?? '(skipped: nothing to review)'} → issue #${issueNumber} closed`);
  }

  // ── 3. final PR ─────────────────────────────────────────────────────────────────────────────
  const merged = Object.values(run.tasks).filter((task) => task.status === 'merged').length;
  run.status = 'finished';
  run.finishedAt = run.startedAt + 180_000;
  run.metrics = {
    ...emptyMetrics(),
    tasksMerged: merged,
    tasksFailed: 0,
    apiUsage: { input: 8_900, output: 2_100, cached: 1_300 },
    apiCostUsd: 0.0021,
    elapsedMs: 180_000,
  };

  const finalUrl = await tracker.openFinalPR(
    run,
    `Sandbox run for Epic 43. ${merged} of ${plan.tasks.length} tasks were merged by hand; the rest are untouched on purpose so the final PR shows pending tasks too.`,
  );
  note(`final PR: ${finalUrl ?? '(skipped: nothing to review)'}`);

  printSummary(repo, run, integrationBranch, results, finalUrl);

  if (options.keep) {
    note('');
    note('Keeping the sandbox artifacts (--keep). Clean up with:');
    note(`  STARLING_SANDBOX_DIR="${dir}" bash tools/github-sandbox/teardown.sh`);
    return;
  }

  note('');
  note('Running teardown…');
  const teardown = await exec(['bash', TEARDOWN], {
    cwd: ROOT,
    env: {
      STARLING_SANDBOX_OWNER: repo.split('/')[0] ?? '',
      STARLING_SANDBOX_NAME: repo.split('/')[1] ?? '',
      STARLING_SANDBOX_DIR: dir,
    },
  });
  process.stderr.write(teardown.stdout);
  process.stderr.write(teardown.stderr);
  expect(teardown.code === 0, 'teardown.sh failed; the repo is still there, run it by hand to inspect');
  await rm(dir, { recursive: true, force: true });
  note('Sandbox clean. The repo was kept.');
}

// ── run construction ────────────────────────────────────────────────────────────────────────────

function buildRun(plan: Plan, runId: string, integrationBranch: string, repoPath: string): Run {
  const tasks: Record<string, TaskRun> = {};
  for (const task of plan.tasks) {
    tasks[task.key] = {
      runId,
      taskKey: task.key,
      status: 'pending',
      attempts: 0,
      usage: { input: 0, output: 0, cached: 0 },
      costUsd: 0,
      nodeId: 'hub',
    };
  }
  return {
    id: runId,
    goal: {
      id: plan.goalId,
      text: 'Ship the sky-todo launch day: dark mode, search, CSV export, shortcuts, due-date badges, and the two date bugs',
      repoPath,
      baseBranch: 'main',
      createdAt: Date.now(),
      constraints: ['No new runtime dependencies'],
    },
    plan,
    tasks,
    status: 'running',
    integrationBranch,
    startedAt: Date.now(),
    metrics: emptyMetrics(),
  };
}

function verdictFor(taskKey: string, title: string): AuditVerdict {
  return {
    taskKey,
    attempt: 1,
    pass: true,
    checks: [
      { name: 'tests', ok: true, detail: 'bun test: 14 pass, 0 fail', durationMs: 4_100 },
      { name: 'lane', ok: true, detail: 'every changed file is inside the lane', durationMs: 11 },
      { name: 'build', ok: true, detail: 'bunx tsc --noEmit: clean', durationMs: 2_600 },
    ],
    laneViolations: [],
    dod: [
      { item: 'bun test passes', met: true, evidence: '14 pass, 0 fail' },
      { item: `${title} is wired into the header`, met: true, evidence: 'checked in src/main.ts' },
      { item: 'Keyboard reachable', met: true, evidence: 'tab order verified in the diff' },
    ],
    summary: `${title} meets its definition of done; the sandbox commit is intentionally tiny.`,
    model: { provider: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    ts: Date.now(),
  };
}

function workerNotes(taskKey: string, title: string): string {
  const handback = {
    status: 'complete',
    summary: `${title} implemented in the sandbox (demo commit).`,
    filesChanged: [`docs/starling/${taskKey}.md`],
    testsAdded: [],
    notes: 'Hand-built fixture: Epic 43 drives the tracker without an engine or an LLM.',
  };
  return [
    `## What changed`,
    '',
    `Sandbox demo commit for \`${taskKey}\`: one markdown file, so the PR has a real diff.`,
    '',
    '<<<STARLING_HANDBACK',
    JSON.stringify(handback),
    'STARLING_HANDBACK>>>',
  ].join('\n');
}

// ── git / gh plumbing ──────────────────────────────────────────────────────────────────────────

async function defaultRepo(): Promise<string> {
  const login = await sh(['gh', 'api', 'user', '--jq', '.login']);
  return `${login.trim()}/starling-sandbox`;
}

async function assertRepoExists(repo: string): Promise<void> {
  const res = await exec(['gh', 'repo', 'view', repo, '--json', 'name,visibility'], { cwd: ROOT });
  expect(
    res.code === 0,
    `cannot see ${repo}; run \`bash tools/github-sandbox/setup.sh\` first.\n${res.stderr.trim()}`,
  );
  const info = JSON.parse(res.stdout) as { visibility?: string };
  expect(info.visibility === 'PRIVATE', `${repo} must be private, it is ${info.visibility ?? 'unknown'}`);
}

async function clone(repo: string, dir: string): Promise<void> {
  const res = await exec(['git', 'clone', `https://github.com/${repo}.git`, dir], { cwd: ROOT });
  expect(res.code === 0, `git clone failed: ${res.stderr.trim()}`);
  // A fresh laptop may have no git identity; the demo repo must not depend on global config.
  const email = await exec(['git', 'config', 'user.email'], { cwd: dir });
  if (email.code !== 0 || email.stdout.trim() === '') {
    await sh(['git', 'config', 'user.email', 'sandbox@starling.local'], dir);
    await sh(['git', 'config', 'user.name', 'Starling Sandbox'], dir);
  }
}

async function createIntegrationBranch(dir: string, integration: string): Promise<void> {
  await sh(['git', 'checkout', '-q', '-b', integration, 'origin/main'], dir);
  await sh(['git', 'push', '-q', '-u', 'origin', integration], dir);
}

async function createTaskBranch(
  dir: string,
  branch: string,
  integration: string,
  taskKey: string,
  title: string,
): Promise<void> {
  await sh(['git', 'checkout', '-q', integration], dir);
  await sh(['git', 'checkout', '-q', '-b', branch], dir);
  const file = join(dir, 'docs', 'starling', `${taskKey}.md`);
  await Bun.write(
    file,
    `# ${title}\n\nSandbox demo commit for the Epic 43 tracker end-to-end run.\n\nThis file exists so the branch has a real diff.\n`,
  );
  await sh(['git', 'add', file], dir);
  await sh(['git', 'commit', '-q', '-m', `docs(${taskKey}): sandbox demo commit`], dir);
  await sh(['git', 'checkout', '-q', integration], dir);
}

async function mergeIntoIntegration(
  dir: string,
  branch: string,
  integration: string,
  taskKey: string,
): Promise<void> {
  await sh(['git', 'checkout', '-q', integration], dir);
  await sh(
    ['git', 'merge', '-q', '--ff-only', branch, '-m', `merge: ${taskKey} into the integration branch`],
    dir,
  );
}

async function starlingIssuesFor(
  repo: string,
  runId: string,
  cwd: string,
): Promise<Array<{ number: number }>> {
  const res = await exec(
    [
      'gh',
      'issue',
      'list',
      '--repo',
      repo,
      '--label',
      'starling:task',
      '--state',
      'all',
      '--limit',
      '500',
      '--json',
      'number,body',
    ],
    { cwd },
  );
  expect(res.code === 0, `gh issue list failed: ${res.stderr.trim()}`);
  const issues = JSON.parse(res.stdout) as Array<{ number: number; body: string }>;
  const marker = `<!-- starling:run=${runId} `;
  return issues.filter((issue) => issue.body.startsWith(marker));
}

/**
 * Poll until the run's issues are visible. GitHub's read model lags writes by a second or two, so
 * counting immediately after `gh issue create` makes a correct run look wrong (that is exactly the
 * lag the tracker's `settleIssues` handles).
 */
async function waitForRunIssues(
  repo: string,
  runId: string,
  cwd: string,
  expected: number,
): Promise<Array<{ number: number }>> {
  let issues = await starlingIssuesFor(repo, runId, cwd);
  for (let attempt = 1; attempt <= 12 && issues.length < expected; attempt += 1) {
    await sleep(500);
    issues = await starlingIssuesFor(repo, runId, cwd);
  }
  // One more beat so a duplicate that is still replicating has time to show up too.
  await sleep(1_000);
  return starlingIssuesFor(repo, runId, cwd);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withoutIssues(run: Run): Run {
  const clone = structuredClone(run);
  for (const task of Object.values(clone.tasks)) {
    task.issueNumber = undefined;
    task.prUrl = undefined;
  }
  return clone;
}

async function sh(cmd: string[], cwd = ROOT): Promise<string> {
  const res = await exec(cmd, { cwd });
  expect(res.code === 0, `${cmd.join(' ')} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────

function assignIssues(run: Run, numbers: Record<string, number>): void {
  for (const [key, number] of Object.entries(numbers)) {
    const task = run.tasks[key];
    if (task !== undefined) task.issueNumber = number;
  }
}

function issueUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/issues/${number}`;
}

function sortKeys(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

function printSummary(
  repo: string,
  run: Run,
  integration: string,
  results: Created[],
  finalUrl: string | undefined,
): void {
  console.log('');
  console.log(`✅ ${repo}`);
  console.log('');
  console.log(`Run ${run.id}`);
  console.log(`Integration branch: ${integration}`);
  console.log('');
  console.log('Issues:');
  for (const task of run.plan?.tasks ?? []) {
    const number = run.tasks[task.key]?.issueNumber;
    const state = run.tasks[task.key]?.status === 'merged' ? 'closed' : 'open';
    console.log(
      `  ${task.key.padEnd(12)} ${number === undefined ? '(none)' : `#${number} ${issueUrl(repo, number)}`} [${state}]`,
    );
  }
  console.log('');
  console.log('Task PRs:');
  for (const result of results) {
    console.log(`  ${result.task.padEnd(12)} ${result.prUrl ?? '(no PR: nothing to review)'}`);
  }
  console.log('');
  console.log(`Final PR: ${finalUrl ?? '(no PR: nothing to review)'}`);
}

function header(title: string, lines: string[]): void {
  console.log(`\n── ${title} ──`);
  for (const line of lines) console.log(`   ${line}`);
  console.log('');
}

function note(message: string): void {
  console.log(`   ${message}`);
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ E2E failed: ${message}`);
  console.error('   The sandbox was left as it is. Clean up with:');
  console.error('   bash tools/github-sandbox/teardown.sh');
  process.exitCode = 1;
});
