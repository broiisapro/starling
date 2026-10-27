import { describe, expect, test } from 'bun:test';
import type { PromptContext } from '../ports';
import { BASE_TS, makeAuditVerdict, makeGoal, makePlan, makeTaskSpec } from './factories';
import { MockPromptCompiler } from './mock-prompts';
import { makeRepoMap } from './mock-repomap';

const ctx: PromptContext = {
  goal: makeGoal(),
  plan: makePlan(),
  map: makeRepoMap(),
  task: makeTaskSpec(),
  branch: 'starling/abc/theme',
  testCommand: 'bun test',
};

describe('MockPromptCompiler', () => {
  test('worker prompt names the task, branch and goal', () => {
    const compiler = new MockPromptCompiler();
    const prompt = compiler.worker(ctx);
    expect(prompt).toContain('theme');
    expect(prompt).toContain('starling/abc/theme');
    expect(compiler.calls).toEqual([{ kind: 'worker', taskKey: 'theme' }]);
  });

  test('fixer prompt includes the verdict instructions', () => {
    const compiler = new MockPromptCompiler();
    const prompt = compiler.fixer(ctx, makeAuditVerdict({ pass: false, fixInstructions: 'add a test' }));
    expect(prompt).toContain('add a test');
    expect(compiler.calls[0]?.kind).toBe('fixer');
  });

  test('resolver prompt includes conflicted files', () => {
    const compiler = new MockPromptCompiler();
    const prompt = compiler.resolver(ctx, {
      taskKey: 'theme',
      status: 'conflict',
      conflictedFiles: ['src/ui/styles.css'],
      detail: 'conflict',
      ts: BASE_TS,
    });
    expect(prompt).toContain('src/ui/styles.css');
    expect(compiler.calls[0]?.kind).toBe('resolver');
  });
});
