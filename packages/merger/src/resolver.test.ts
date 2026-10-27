import { afterAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MergeResult, ModelRef, PromptCompiler, PromptContext, RepoMap } from '@starling/core';
import { exec as coreExec, FakeClock, isStarlingError } from '@starling/core';
import { makeGoal, makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import {
  type ConflictResolver,
  createConflictResolver,
  createGit,
  createMerger,
  findConflictMarkers,
  type MergerService,
  type ResolveContext,
} from './index.ts';
import {
  cleanupTempDirs,
  createBranch,
  createIntegrationBranch,
  createWorkspaceFor,
  git,
  gitResult,
  makeRepo,
  makeTask,
  rev,
} from './test-helpers.ts';
import { type ScriptedAgent, ScriptedNode } from './testing/scripted-node.ts';

const INTEGRATION = 'starling/run1/integration';
const SORT_BRANCH = 'starling/run1/date-sort';
const DELETE_BRANCH = 'starling/run1/delete-all';
const RESOLVE_BRANCH = 'starling/run1/resolve-delete-all';
const RESOLVE_DIR = 'starling-run1-resolve-delete-all';

const BASE = 'export function footerButtons(): string[] {\n  return []\n}\n';
const SORT = "export function footerButtons(): string[] {\n  return ['sort-by-due']\n}\n";
const DELETE = "export function footerButtons(): string[] {\n  return ['delete-all']\n}\n";
const BOTH = "export function footerButtons(): string[] {\n  return ['sort-by-due', 'delete-all']\n}\n";
const SUITE = [
  "import { expect, test } from 'bun:test';",
  "import { footerButtons } from './render';",
  '',
  "test('the footer keeps both behaviours', () => {",
  '  const buttons = footerButtons();',
  "  expect(buttons).toContain('sort-by-due');",
  "  expect(buttons).toContain('delete-all');",
  '});',
  '',
].join('\n');

const MODEL: ModelRef = { provider: 'deepseek', model: 'deepseek-v4.1-flash' };

/**
 * A compiler-shaped object that echoes the hunks back, so the test can assert what the resolver
 * passed without depending on `@starling/prompts` (the port is all this package knows).
 */
interface TestPromptCompiler extends PromptCompiler {
  resolver(ctx: PromptContext, conflict: MergeResult, extras?: { hunks?: string[] }): string;
}

const prompts: TestPromptCompiler = {
  worker: () => 'worker prompt',
  fixer: () => 'fixer prompt',
  resolver: (ctx, conflict, extras = {}) =>
    [
      `RESOLVE ${ctx.task.key} on ${ctx.branch}`,
      `test command: ${ctx.testCommand ?? 'none'}`,
      `conflicted: ${conflict.conflictedFiles.join(', ')}`,
      ...(extras.hunks ?? []),
    ].join('\n'),
};

interface Fixture {
  repo: string;
  worktreeRoot: string;
  merger: MergerService;
  resolverFor: (script: ScriptedAgent) => { resolver: ConflictResolver; node: ScriptedNode };
  context: (overrides?: Partial<ResolveContext>) => ResolveContext;
}

function repoMap(repo: string): RepoMap {
  return { root: repo, tree: '', files: [], languages: {}, tokenEstimate: 0, createdAt: 0 };
}

/**
 * The conflict-bait setup: two hand-made branches that both edit `src/ui/render.ts`.
 * `date-sort` lands first (cleanly), so `delete-all` is the one whose merge conflicts.
 */
async function makeFixture(): Promise<Fixture> {
  const { repo, worktreeRoot } = await makeRepo({
    'src/ui/render.ts': BASE,
    'src/ui/render.test.ts': SUITE,
  });
  await createBranch(repo, SORT_BRANCH, { 'src/ui/render.ts': SORT });
  await createBranch(repo, DELETE_BRANCH, { 'src/ui/render.ts': DELETE });
  await createIntegrationBranch(repo, INTEGRATION);

  const clock = new FakeClock(1_000);
  const merger = createMerger({ worktreeRoot, clock });
  const first = await merger.merge(repo, INTEGRATION, makeTask(SORT_BRANCH, 'date-sort'), {});
  expect(first.status).toBe('merged');
  expect((await merger.preflight(repo, INTEGRATION, DELETE_BRANCH)).clean).toBe(false);

  const workspace = createWorkspaceFor(worktreeRoot);
  const goal = makeGoal({ id: 'goal1', repoPath: repo });
  const plan = makePlan({
    goalId: goal.id,
    tasks: [
      makeTaskSpec({
        key: 'date-sort',
        title: 'Sort-by-due toggle in the footer',
        lane: { owns: ['src/ui/render.ts'], reads: [] },
        definitionOfDone: ['Clicking reorders the list', 'Clicking again restores insertion order'],
      }),
      makeTaskSpec({
        key: 'delete-all',
        title: 'Delete-all button in the footer',
        lane: { owns: ['src/ui/render.ts'], reads: [] },
        definitionOfDone: ['Confirm removes every todo', 'The button is disabled when empty'],
      }),
    ],
  });
  const task = plan.tasks[1];
  if (task === undefined) throw new Error('fixture plan has no delete-all task');
  const run = makeRun({ id: 'run1', goal, plan });

  const prompt: PromptContext = {
    goal,
    plan,
    map: repoMap(repo),
    task,
    branch: DELETE_BRANCH,
    testCommand: 'bun test',
  };
  const conflict: MergeResult = {
    taskKey: 'delete-all',
    status: 'conflict',
    conflictedFiles: ['src/ui/render.ts'],
    detail: 'CONFLICT (content): Merge conflict in src/ui/render.ts',
    ts: 1_500,
  };
  const taskA = makeTaskRun({
    runId: 'run1',
    taskKey: 'delete-all',
    branch: DELETE_BRANCH,
    status: 'conflict',
  });

  return {
    repo,
    worktreeRoot,
    merger,
    resolverFor(script) {
      const node = new ScriptedNode({ workspace, script, clock });
      const resolver = createConflictResolver({
        node,
        prompts,
        workspace,
        merger,
        clock,
        sessionTimeoutMs: 10_000,
      });
      return { resolver, node };
    },
    context(overrides = {}) {
      return {
        run,
        integrationBranch: INTEGRATION,
        taskA,
        taskB: makeTaskRun({ runId: 'run1', taskKey: 'date-sort', branch: SORT_BRANCH }),
        conflict,
        prompt,
        model: MODEL,
        testCommand: 'bun test',
        ...overrides,
      };
    },
  };
}

const writeBoth: ScriptedAgent = async ({ dir }) => {
  await writeFile(join(dir, 'src/ui/render.ts'), BOTH);
};

/** Leaves the markers exactly where they were: the classic "the model did nothing" failure. */
const keepMarkers: ScriptedAgent = () => undefined;

/** Removes the markers but silently drops the sibling's behaviour: green markers, red suite. */
const dropOneSide: ScriptedAgent = async ({ dir }) => {
  await writeFile(join(dir, 'src/ui/render.ts'), DELETE);
};

afterAll(cleanupTempDirs);

describe('createConflictResolver — happy path', () => {
  test('resolves, proves and lands the conflict on the integration branch', async () => {
    const fixture = await makeFixture();
    const { resolver, node } = fixture.resolverFor(writeBoth);

    const result = await resolver.resolve(fixture.context());

    expect(result.status).toBe('merged');
    expect(result.resolved).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.taskKey).toBe('delete-all');
    expect(result.resolveBranch).toBe(RESOLVE_BRANCH);
    expect(result.sessions).toHaveLength(1);
    expect(result.failures).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.commit).toBeDefined();
    expect(result.detail).toContain(RESOLVE_BRANCH);

    // The agent ran on the resolve branch, with the resolver model.
    expect(node.startedTasks).toHaveLength(1);
    expect(node.startedTasks[0]?.branch).toBe(RESOLVE_BRANCH);
    expect(node.startedTasks[0]?.model).toEqual(MODEL);

    // The prompt named the branch, the files, and carried the trimmed hunks.
    const prompt = node.startedTasks[0]?.prompt ?? '';
    expect(prompt).toContain('RESOLVE delete-all');
    expect(prompt).toContain(`on ${RESOLVE_BRANCH}`);
    expect(prompt).toContain('src/ui/render.ts');
    expect(prompt).toContain('<<<<<<< ');
    expect(prompt).toContain('=======');
    expect(prompt).toContain('>>>>>>> ');

    // Both behaviours survived on the integration branch.
    const landed = await git(fixture.repo, ['show', `${INTEGRATION}:src/ui/render.ts`]);
    expect(landed).toContain('sort-by-due');
    expect(landed).toContain('delete-all');

    // Nothing of ours is still checked out.
    const worktrees = await git(fixture.repo, ['worktree', 'list', '--porcelain']);
    expect(worktrees).not.toContain(RESOLVE_DIR);

    // And the branch is really merged: the conflicted task branch is now an ancestor of integration.
    const after = await fixture.merger.preflight(fixture.repo, INTEGRATION, DELETE_BRANCH);
    expect(after.clean).toBe(true);
    expect(after.alreadyMerged).toBe(true);
    await fixture.merger.dispose();
  });

  test('the resolve branch tip is the landed merge commit', async () => {
    const fixture = await makeFixture();
    const { resolver } = fixture.resolverFor(writeBoth);

    const result = await resolver.resolve(fixture.context());

    expect(result.commit).toBe(await rev(fixture.repo, INTEGRATION));
    // The resolve branch is the merge commit's parent, so integration now contains it.
    const ancestor = await gitResult(fixture.repo, [
      'merge-base',
      '--is-ancestor',
      RESOLVE_BRANCH,
      INTEGRATION,
    ]);
    expect(ancestor.code).toBe(0);
    await fixture.merger.dispose();
  });
});

describe('createConflictResolver — still conflicted', () => {
  test('retries on a fresh copy, then gives up without touching the integration branch', async () => {
    const fixture = await makeFixture();
    const before = await rev(fixture.repo, INTEGRATION);
    const { resolver, node } = fixture.resolverFor(keepMarkers);

    const result = await resolver.resolve(fixture.context());

    expect(result.status).toBe('conflict');
    expect(result.resolved).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.sessions).toHaveLength(2);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toContain('conflict marker(s) remain');
    expect(result.detail).toContain('Gave up resolving "delete-all" after 2 attempt(s)');
    expect(result.detail).toContain('conflict marker(s) remain');

    // Two fresh sessions, one per attempt, and the retry says what went wrong.
    expect(node.startedTasks).toHaveLength(2);
    expect(node.startedTasks[1]?.prompt).toContain('## Previous attempt did not land');
    expect(node.startedTasks[1]?.prompt).toContain('This is attempt 2 of 2.');

    // The integration branch never moved, and the resolve branch is left for a human to inspect.
    expect(await rev(fixture.repo, INTEGRATION)).toBe(before);
    const markers = await findConflictMarkers(createGit(coreExec), fixture.repo, RESOLVE_BRANCH);
    expect(markers.length).toBeGreaterThan(0);
    const worktrees = await git(fixture.repo, ['worktree', 'list', '--porcelain']);
    expect(worktrees).not.toContain(RESOLVE_DIR);
    await fixture.merger.dispose();
  });
});

describe('createConflictResolver — a red suite after the resolution', () => {
  test('reports tests-failed with the suite output, twice, and leaves integration alone', async () => {
    const fixture = await makeFixture();
    const before = await rev(fixture.repo, INTEGRATION);
    const { resolver, node } = fixture.resolverFor(dropOneSide);

    const result = await resolver.resolve(fixture.context());

    expect(result.status).toBe('tests-failed');
    expect(result.resolved).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.failures[0]).toContain('tests failed');
    // The failure detail carries the nested suite's own assertion message.
    expect(result.failures[0]).toContain('keeps both behaviours');
    expect(result.detail).toContain('tests failed');
    expect(node.startedTasks).toHaveLength(2);
    expect(await rev(fixture.repo, INTEGRATION)).toBe(before);
    await fixture.merger.dispose();
  });
});

describe('createConflictResolver — the conflict no longer reproduces', () => {
  test('lands the branch without spending a session', async () => {
    const fixture = await makeFixture();
    // A late branch that already contains the resolved content, based on integration: clean merge.
    const workspace = createWorkspaceFor(fixture.worktreeRoot);
    const late = await workspace.create(fixture.repo, 'starling/run1/late', INTEGRATION);
    await writeFile(join(late.path, 'src/ui/render.ts'), BOTH);
    await writeFile(join(late.path, 'src/late.ts'), 'export {}\n');
    await workspace.commitAll(late.path, 'feat(late): both footer behaviours');
    await workspace.remove(late.path);
    const { resolver, node } = fixture.resolverFor(writeBoth);

    const result = await resolver.resolve(
      fixture.context({
        taskA: makeTaskRun({
          runId: 'run1',
          taskKey: 'delete-all',
          branch: 'starling/run1/late',
          status: 'conflict',
        }),
        conflict: {
          taskKey: 'delete-all',
          status: 'conflict',
          conflictedFiles: ['src/ui/render.ts'],
          detail: 'a stale conflict report',
          ts: 2_000,
        },
      }),
    );

    expect(result.status).toBe('merged');
    expect(result.resolved).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.sessions).toEqual([]);
    expect(node.startedTasks).toHaveLength(0);
    const landed = await git(fixture.repo, ['show', `${INTEGRATION}:src/late.ts`]);
    expect(landed).toContain('export');
    await fixture.merger.dispose();
  });
});

describe('createConflictResolver — wiring', () => {
  test('names the resolve branch deterministically', async () => {
    const fixture = await makeFixture();
    const { resolver } = fixture.resolverFor(writeBoth);
    expect(resolver.branchFor('01jd2k7m3p4q5r6s7t8v9w0x3a', 'delete-all')).toBe(
      'starling/9w0x3a/resolve-delete-all',
    );
    expect(resolver.branchFor('run1', 'delete-all')).toBe(RESOLVE_BRANCH);
    await fixture.merger.dispose();
  });

  test('rejects a merge result for another task before touching git', async () => {
    const fixture = await makeFixture();
    const { resolver } = fixture.resolverFor(writeBoth);
    const ctx = fixture.context({
      conflict: {
        taskKey: 'date-sort',
        status: 'conflict',
        conflictedFiles: ['src/ui/render.ts'],
        detail: 'wrong task',
        ts: 1,
      },
    });

    try {
      await resolver.resolve(ctx);
      throw new Error('expected the resolver to reject a mismatched merge result');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
    await fixture.merger.dispose();
  });

  test('rejects a non-conflict merge result', async () => {
    const fixture = await makeFixture();
    const { resolver } = fixture.resolverFor(writeBoth);
    const ctx = fixture.context({
      conflict: {
        taskKey: 'delete-all',
        status: 'tests-failed',
        conflictedFiles: [],
        detail: 'not a conflict',
        ts: 1,
      },
    });

    try {
      await resolver.resolve(ctx);
      throw new Error('expected the resolver to reject a non-conflict result');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
    await fixture.merger.dispose();
  });

  test('rejects a task without a branch', async () => {
    const fixture = await makeFixture();
    const { resolver } = fixture.resolverFor(writeBoth);
    const ctx = fixture.context({
      taskA: makeTaskRun({ runId: 'run1', taskKey: 'delete-all', status: 'conflict' }),
    });

    try {
      await resolver.resolve(ctx);
      throw new Error('expected the resolver to reject a branchless task');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
    await fixture.merger.dispose();
  });

  test('validates its own options', () => {
    const fixture = {} as never;
    expect(() =>
      createConflictResolver({
        node: fixture,
        prompts,
        workspace: fixture,
        merger: fixture,
        maxAttempts: 0,
      }),
    ).toThrow();
    expect(() =>
      createConflictResolver({
        node: fixture,
        prompts,
        workspace: fixture,
        merger: fixture,
        testTimeoutMs: -1,
      }),
    ).toThrow();
  });
});
