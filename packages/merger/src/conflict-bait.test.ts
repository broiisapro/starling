/**
 * Demo proof, no LLM: the sky-todo `conflict-bait` goal, end to end.
 *
 * `conflict-bait` deliberately plans two tasks that both own `src/ui/render.ts` (see
 * `examples/sky-todo/demo-goals/conflict-bait.expected.md`). This test runs that story with real git:
 * two hand-made branches edit the same footer function, the merge queue predicts and then reports the
 * conflict, the resolver agent (scripted — it writes the reconciled function) fixes it, and the merge
 * lands. The target repo is a hermetic miniature of sky-todo's renderer with a real `bun test` suite,
 * so nothing here needs the network, an LLM or the demo app's dependencies.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MergeResult, PromptCompiler, PromptContext, RepoMap } from '@starling/core';
import { FakeClock } from '@starling/core';
import { makeGoal, makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { type ConflictResolver, createConflictResolver, createMerger, type MergerService } from './index.ts';
import {
  cleanupTempDirs,
  createBranch,
  createIntegrationBranch,
  createWorkspaceFor,
  git,
  makeRepo,
  makeTask,
  rev,
} from './test-helpers.ts';
import { ScriptedNode } from './testing/scripted-node.ts';

const INTEGRATION = 'starling/c0ffee/integration';
const SORT_BRANCH = 'starling/c0ffee/date-sort';
const DELETE_BRANCH = 'starling/c0ffee/delete-all';
const RESOLVE_BRANCH = 'starling/c0ffee/resolve-delete-all';

/** The footer shell both tasks must extend, in miniature. */
const BASE = [
  'export interface FooterButton {',
  '  action: string',
  '  label: string',
  '}',
  '',
  'export function footerButtons(): FooterButton[] {',
  '  return []',
  '}',
  '',
].join('\n');

const SORT = BASE.replace('  return []', "  return [{ action: 'sort-by-due', label: 'By due date' }]");

const DELETE = BASE.replace('  return []', "  return [{ action: 'delete-all', label: 'Delete all' }]");

/** What a good resolver produces: both behaviours, no markers, one function. */
const RESOLVED = BASE.replace(
  '  return []',
  [
    '  return [',
    "    { action: 'sort-by-due', label: 'By due date' },",
    "    { action: 'delete-all', label: 'Delete all' },",
    '  ]',
  ].join('\n'),
);

/** The suite the demo target ships: it encodes both tasks' definitions of done. */
const SUITE = [
  "import { expect, test } from 'bun:test';",
  "import { footerButtons } from './render';",
  '',
  "test('the footer can sort by due date', () => {",
  "  expect(footerButtons().map((b) => b.action)).toContain('sort-by-due');",
  '});',
  '',
  "test('the footer can delete everything', () => {",
  "  expect(footerButtons().map((b) => b.action)).toContain('delete-all');",
  '});',
  '',
  "test('neither button was dropped to make the merge pass', () => {",
  '  expect(footerButtons()).toHaveLength(2);',
  '});',
  '',
].join('\n');

const MODEL = { provider: 'deepseek', model: 'deepseek-v4.1-flash' } as const;

const prompts: PromptCompiler = {
  worker: () => 'worker',
  fixer: () => 'fixer',
  resolver: (ctx, conflict) =>
    `# Resolve ${ctx.task.key} on ${ctx.branch}\nKeep both behaviours and both sets of tests.\n${conflict.detail}`,
};

afterAll(cleanupTempDirs);

describe('conflict-bait demo proof (no LLM, real git)', () => {
  test('preflight predicts it, the queue reports it, the resolver fixes it, the merge lands', async () => {
    const { repo, worktreeRoot } = await makeRepo({
      'src/ui/render.ts': BASE,
      'src/ui/render.test.ts': SUITE,
    });
    await createIntegrationBranch(repo, INTEGRATION);
    await createBranch(
      repo,
      SORT_BRANCH,
      { 'src/ui/render.ts': SORT },
      { message: 'feat(date-sort): footer toggle' },
    );
    await createBranch(
      repo,
      DELETE_BRANCH,
      { 'src/ui/render.ts': DELETE },
      {
        message: 'feat(delete-all): footer button',
      },
    );

    const clock = new FakeClock(1_700_000_000_000);
    const merger: MergerService = createMerger({ worktreeRoot, clock });
    const workspace = createWorkspaceFor(worktreeRoot);

    // ── 1. date-sort lands, then preflight predicts what delete-all will hit. ───────────────────
    expect((await merger.merge(repo, INTEGRATION, makeTask(SORT_BRANCH, 'date-sort'), {})).status).toBe(
      'merged',
    );
    const forecast = await merger.preflight(repo, INTEGRATION, DELETE_BRANCH);
    expect(forecast.clean).toBe(false);
    expect(forecast.alreadyMerged).toBe(false);
    expect(forecast.conflictedFiles).toEqual(['src/ui/render.ts']);

    // ── 2. delete-all collides with it in the merge queue. ──────────────────────────────────────
    const collision = await merger.merge(repo, INTEGRATION, makeTask(DELETE_BRANCH, 'delete-all'), {
      testCommand: 'bun test',
    });
    expect(collision.status).toBe('conflict');
    expect(collision.conflictedFiles).toEqual(forecast.conflictedFiles);

    // ── 3. The resolver rebuilds the conflict and a scripted agent reconciles the two diffs. ────
    const plan = makePlan({
      goalId: 'goal-conflict-bait',
      tasks: [
        makeTaskSpec({
          key: 'date-sort',
          title: 'Sort-by-due toggle in the footer',
          lane: { owns: ['src/ui/render.ts', 'src/ui/styles.css'], reads: ['src/lib/dates.ts'] },
          definitionOfDone: [
            'Clicking reorders the rendered list',
            'Clicking again restores insertion order',
          ],
        }),
        makeTaskSpec({
          key: 'delete-all',
          title: 'Delete-all button in the footer',
          lane: { owns: ['src/ui/render.ts', 'src/ui/styles.css'], reads: ['src/store/todos.ts'] },
          definitionOfDone: ['Confirm removes every todo', 'The button is disabled when empty'],
        }),
      ],
    });
    const spec = plan.tasks[1];
    if (spec === undefined) throw new Error('conflict-bait plan lost its delete-all task');
    const goal = makeGoal({ id: 'goal-conflict-bait', repoPath: repo, text: 'Conflict bait' });
    const run = makeRun({ id: 'c0ffee', goal, plan });
    const map: RepoMap = { root: repo, tree: '', files: [], languages: {}, tokenEstimate: 0, createdAt: 0 };
    const prompt: PromptContext = {
      goal,
      plan,
      map,
      task: spec,
      branch: DELETE_BRANCH,
      testCommand: 'bun test',
    };

    const node = new ScriptedNode({
      workspace,
      clock,
      script: async ({ dir }) => {
        await writeFile(join(dir, 'src/ui/render.ts'), RESOLVED);
      },
    });
    const resolver: ConflictResolver = createConflictResolver({
      node,
      prompts,
      workspace,
      merger,
      clock,
      sessionTimeoutMs: 10_000,
    });

    const conflict: MergeResult = collision;
    const result = await resolver.resolve({
      run,
      integrationBranch: INTEGRATION,
      taskA: makeTaskRun({ runId: run.id, taskKey: 'delete-all', branch: DELETE_BRANCH, status: 'conflict' }),
      taskB: makeTaskRun({ runId: run.id, taskKey: 'date-sort', branch: SORT_BRANCH }),
      conflict,
      prompt,
      model: MODEL,
      testCommand: 'bun test',
    });

    // ── 4. It landed, with the resolver's own history preserved on the resolve branch. ─────────
    expect(result.status).toBe('merged');
    expect(result.resolved).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.resolveBranch).toBe(RESOLVE_BRANCH);

    const landed = await git(repo, ['show', `${INTEGRATION}:src/ui/render.ts`]);
    expect(landed).toContain('sort-by-due');
    expect(landed).toContain('delete-all');
    expect(landed).not.toContain('<<<<<<< ');
    expect(landed).not.toContain('>>>>>>> ');

    // The commit before the fix is the merged conflict itself, markers and all.
    const markerCommit = await rev(repo, `${RESOLVE_BRANCH}^`);
    const markerMessage = await git(repo, ['log', '-1', '--format=%s', markerCommit]);
    expect(markerMessage).toContain('left in place for the resolver');
    const marked = await git(repo, ['show', `${markerCommit}:src/ui/render.ts`]);
    expect(marked).toContain('<<<<<<< ');
    expect(marked).toContain('=======');
    expect(marked).toContain('>>>>>>> ');

    // ── 5. The suite that encodes both DoDs is green on the integration branch. ─────────────────
    expect(result.detail).toContain('tests passed');
    expect(result.commit).toBe(await rev(repo, INTEGRATION));

    // Nothing of the resolver's is left checked out.
    const worktrees = await git(repo, ['worktree', 'list', '--porcelain']);
    expect(worktrees).not.toContain('resolve-delete-all');

    await merger.dispose();
  });

  test('the same conflict still fails when the agent only deletes the other side', async () => {
    // The negative control: without a real resolution the suite stays red and nothing lands.
    const { repo, worktreeRoot } = await makeRepo({
      'src/ui/render.ts': BASE,
      'src/ui/render.test.ts': SUITE,
    });
    await createIntegrationBranch(repo, INTEGRATION);
    await createBranch(repo, SORT_BRANCH, { 'src/ui/render.ts': SORT });
    await createBranch(repo, DELETE_BRANCH, { 'src/ui/render.ts': DELETE });
    const clock = new FakeClock(1_700_000_000_000);
    const merger = createMerger({ worktreeRoot, clock });
    const workspace = createWorkspaceFor(worktreeRoot);
    await merger.merge(repo, INTEGRATION, makeTask(SORT_BRANCH, 'date-sort'), {});
    const collision = await merger.merge(repo, INTEGRATION, makeTask(DELETE_BRANCH, 'delete-all'), {});
    expect(collision.status).toBe('conflict');
    const before = await rev(repo, INTEGRATION);

    const plan = makePlan({ tasks: [makeTaskSpec({ key: 'delete-all', title: 'Delete-all button' })] });
    const goal = makeGoal({ repoPath: repo });
    const spec = plan.tasks[0];
    if (spec === undefined) throw new Error('plan lost its task');
    const node = new ScriptedNode({
      workspace,
      clock,
      script: async ({ dir }) => {
        await writeFile(join(dir, 'src/ui/render.ts'), DELETE);
      },
    });
    const resolver = createConflictResolver({
      node,
      prompts,
      workspace,
      merger,
      clock,
      sessionTimeoutMs: 10_000,
    });

    const result = await resolver.resolve({
      run: makeRun({ id: 'c0ffee', goal, plan }),
      integrationBranch: INTEGRATION,
      taskA: makeTaskRun({ runId: 'c0ffee', taskKey: 'delete-all', branch: DELETE_BRANCH }),
      conflict: collision,
      prompt: {
        goal,
        plan,
        map: { root: repo, tree: '', files: [], languages: {}, tokenEstimate: 0, createdAt: 0 },
        task: spec,
        branch: DELETE_BRANCH,
        testCommand: 'bun test',
      },
      model: MODEL,
      testCommand: 'bun test',
    });

    expect(result.status).toBe('tests-failed');
    expect(result.resolved).toBe(false);
    // The nested suite's own test name proves the drop was caught, not just "some test failed".
    expect(result.failures[0]).toContain('dropped');
    expect(await rev(repo, INTEGRATION)).toBe(before);
    const landed = await git(repo, ['show', `${INTEGRATION}:src/ui/render.ts`]);
    expect(landed).not.toContain('delete-all');
    await merger.dispose();
  });
});
