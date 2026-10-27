import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import { conflictingTasks, createPromptCompiler } from './index.ts';
import { helpOverlayConflict, skyTodoContext, unattributedConflict } from './testing/context.ts';

const ctx = skyTodoContext('help-overlay');
const conflict = helpOverlayConflict();
const prompt = createPromptCompiler().resolver(ctx, conflict);

describe('resolver prompt — sky-todo fixture', () => {
  test('matches the committed snapshot', () => {
    expect(prompt).toMatchSnapshot();
  });

  test('names the task, the branch and the conflicted files', () => {
    expect(prompt.startsWith('# Starling resolver — help-overlay')).toBe(true);
    expect(prompt).toContain('starling/9w0x1y/help-overlay');
    expect(prompt).toContain('## Conflicted files');
    expect(prompt).toContain('`src/features/search/index.ts`');
    expect(prompt).toContain('CONFLICT (content)');
  });

  test("states the task's own intent from the plan", () => {
    expect(prompt).toContain("## Your task's intent");
    expect(prompt).toContain(ctx.task.title);
    expect(prompt).toContain(ctx.task.goal);
    for (const deliverable of ctx.task.deliverables) expect(prompt).toContain(deliverable);
    for (const item of ctx.task.definitionOfDone) expect(prompt).toContain(item);
  });

  test('names every task that owns a conflicted file', () => {
    const multi = createPromptCompiler().resolver(ctx, {
      ...conflict,
      conflictedFiles: ['src/features/theme/index.ts', 'src/features/search/index.ts'],
    });
    expect(multi).toContain('2 other tasks also own conflicted files');
    expect(multi).toContain('`theme` · Dark mode with a toggle');
    expect(multi).toContain('`search` · Live search filtering');
  });

  test("states the other side's intent by attributing the conflicted file", () => {
    const search = ctx.plan.tasks.find((task) => task.key === 'search');
    if (search === undefined) throw new Error('fixture plan has no search task');
    expect(prompt).toContain('## The other side');
    expect(prompt).toContain('`search` · Live search filtering');
    expect(prompt).toContain(search.goal);
    for (const deliverable of search.deliverables) expect(prompt).toContain(deliverable);
  });

  test('sets the both-sides-survive rules', () => {
    expect(prompt).toContain('Preserve both behaviours');
    expect(prompt).toContain('Never drop one side’s work');
    expect(prompt).toContain("Do not delete or weaken either side's tests");
    expect(prompt).toContain('Do not `git merge --abort`');
    expect(prompt).toContain('Run `bun test`');
  });

  test('tells the agent where to commit the resolution', () => {
    expect(prompt).toContain('`fix(help-overlay): resolve merge conflict`');
  });

  test('requires the same handback block', () => {
    expect(prompt).toContain('<<<STARLING_HANDBACK');
    expect(prompt).toContain('STARLING_HANDBACK>>>');
    expect(prompt).toContain('"filesChanged"');
  });

  test('is deterministic', () => {
    expect(createPromptCompiler().resolver(ctx, conflict)).toBe(prompt);
  });

  test('compact style is shorter but keeps both intents', () => {
    const compact = createPromptCompiler({ style: 'compact' }).resolver(ctx, conflict);
    expect(compact.length).toBeLessThan(prompt.length);
    expect(compact).toContain('src/features/search/index.ts');
    expect(compact).toContain('Live search filtering');
    expect(compact).not.toContain('this is real engineering, not marker deletion');
  });
});

describe('resolver prompt — degraded input', () => {
  test('falls back to the integration branch when no lane claims the file', () => {
    const csvCtx = skyTodoContext('csv-export');
    const fallback = createPromptCompiler().resolver(csvCtx, unattributedConflict());
    expect(fallback).toContain('The plan does not attribute these files to another task');
    expect(fallback).toContain('already landed on the integration branch');
    expect(fallback).toContain('Other tasks in the plan, for reference');
    expect(fallback).toContain('`theme`');
  });

  test('handles a conflict with no files listed', () => {
    const empty = createPromptCompiler().resolver(ctx, { ...conflict, conflictedFiles: [] });
    expect(empty).toContain('without naming files');
    expect(empty).toContain('git status');
  });

  test('refuses a merge result for a different task', () => {
    try {
      createPromptCompiler().resolver(ctx, { ...conflict, taskKey: 'search' });
      throw new Error('expected the compiler to reject a mismatched merge result');
    } catch (error) {
      expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
    }
  });
});

describe('conflictingTasks', () => {
  const plan = skyTodoContext('help-overlay').plan;

  test('finds the lane that owns the conflicted file', () => {
    expect(
      conflictingTasks(plan, 'help-overlay', ['src/features/search/index.ts']).map((t) => t.key),
    ).toEqual(['search']);
  });

  test('never returns the task being resolved', () => {
    const keys = conflictingTasks(plan, 'search', ['src/features/search/index.ts']).map((t) => t.key);
    expect(keys).not.toContain('search');
  });

  test('returns nothing when no lane owns the file', () => {
    expect(conflictingTasks(plan, 'csv-export', ['src/main.ts'])).toEqual([]);
  });

  test('returns every matching task in plan order', () => {
    const keys = conflictingTasks(plan, 'csv-export', [
      'src/features/theme/index.ts',
      'src/features/search/index.ts',
    ]).map((task) => task.key);
    expect(keys).toEqual(['theme', 'search']);
  });
});
