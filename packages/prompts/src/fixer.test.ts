import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import { createPromptCompiler } from './index.ts';
import { skyTodoContext, themeFailureVerdict } from './testing/context.ts';

const ctx = skyTodoContext('theme');
const verdict = themeFailureVerdict();
const prompt = createPromptCompiler().fixer(ctx, verdict);

describe('fixer prompt — sky-todo fixture', () => {
  test('matches the committed snapshot', () => {
    expect(prompt).toMatchSnapshot();
  });

  test('names the task, the failed attempt and the branch', () => {
    expect(prompt.startsWith('# Starling fixer — theme (audit attempt 1 failed)')).toBe(true);
    expect(prompt).toContain('starling/9w0x1y/theme');
    expect(prompt).toContain('do not start over');
  });

  test('lists the failing checks with the auditor detail', () => {
    expect(prompt).toContain('Failed checks');
    expect(prompt).toContain('`tests` — bun test: 1 failing test in src/features/theme');
    expect(prompt).toContain('`definition-of-done` — Missing: toggle persists across reloads');
  });

  test('separates the checks that already passed', () => {
    expect(prompt).toContain('**Passed checks:** `lane`');
  });

  test('quotes the fix instructions verbatim', () => {
    expect(verdict.fixInstructions).toBeDefined();
    expect(prompt).toContain(verdict.fixInstructions as string);
    expect(prompt).toContain('Follow these instructions literally');
  });

  test('says the lane check passed when there are no violations', () => {
    expect(prompt).toContain('Lane violations:** none — the lane check passed');
  });

  test('tells the agent to fix only these things and not redo completed work', () => {
    expect(prompt).toContain('Fix only what is listed above');
    expect(prompt).toContain('Do not redo work that already passed');
    expect(prompt).toContain('do not refactor beyond the fix');
  });

  test('restates the same lane rules', () => {
    expect(prompt).toContain('The same lane rules apply');
    for (const glob of ctx.task.lane.owns) expect(prompt).toContain(glob);
  });

  test('keeps the task spec for reference, including every DoD item', () => {
    expect(prompt).toContain('## Your task (unchanged, for reference)');
    for (const item of ctx.task.definitionOfDone) expect(prompt).toContain(item);
    for (const deliverable of ctx.task.deliverables) expect(prompt).toContain(deliverable);
  });

  test('requires the same handback block', () => {
    expect(prompt).toContain('## Finish line');
    expect(prompt).toContain('<<<STARLING_HANDBACK');
    expect(prompt).toContain('STARLING_HANDBACK>>>');
  });

  test('re-runs the test command from the context', () => {
    expect(prompt).toContain('Run `bun test` again');
    const narrower = createPromptCompiler().fixer(
      { ...ctx, testCommand: 'bun test src/features/theme' },
      verdict,
    );
    expect(narrower).toContain('Run `bun test src/features/theme` again');
  });

  test('is deterministic', () => {
    expect(createPromptCompiler().fixer(ctx, verdict)).toBe(prompt);
  });
});

describe('fixer prompt — lane violations', () => {
  test('lists the violations and tells the agent to revert them', () => {
    const violating = createPromptCompiler().fixer(ctx, {
      ...verdict,
      laneViolations: ['src/ui/render.ts', 'src/main.ts'],
    });
    expect(violating).toContain('Lane violations — revert these before you continue');
    expect(violating).toContain('src/ui/render.ts');
    expect(violating).toContain('src/main.ts');
    expect(violating).toContain('Changes outside it must be reverted, not built on');
    expect(violating).toContain('revert those changes rather than building on them');
  });
});

describe('fixer prompt — degraded input', () => {
  test('falls back to the audit summary when there are no fix instructions', () => {
    const noInstructions = createPromptCompiler().fixer(ctx, {
      ...verdict,
      fixInstructions: undefined,
    });
    expect(noInstructions).toContain('treat the audit summary above as the instruction');
    expect(noInstructions).toContain(verdict.summary);
  });

  test('handles a verdict that failed without naming a failing check', () => {
    const vague = createPromptCompiler().fixer(ctx, {
      ...verdict,
      checks: [{ name: 'lane', ok: true, detail: 'passed' }],
    });
    expect(vague).toContain('without naming a failing check');
  });

  test('refuses a verdict for a different task', () => {
    try {
      createPromptCompiler().fixer(ctx, { ...verdict, taskKey: 'search' });
      throw new Error('expected the compiler to reject a mismatched verdict');
    } catch (error) {
      expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('compact style keeps the verdict but drops the commentary', () => {
    const compact = createPromptCompiler({ style: 'compact' }).fixer(ctx, verdict);
    expect(compact.length).toBeLessThan(prompt.length);
    expect(compact).toContain('`tests` — bun test: 1 failing test');
    expect(compact).toContain(verdict.fixInstructions as string);
    expect(compact).not.toContain('Ignore anything else that looks improvable');
  });
});
