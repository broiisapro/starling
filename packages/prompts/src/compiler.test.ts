import { describe, expect, test } from 'bun:test';
import type { PromptCompiler } from '@starling/core';
import { createPromptCompiler, estimateTokens } from './index.ts';
import {
  helpOverlayConflict,
  skyTodoContext,
  themeFailureVerdict,
  unattributedConflict,
} from './testing/context.ts';

const ctx = skyTodoContext('csv-export');

describe('createPromptCompiler', () => {
  test('returns a PromptCompiler with the three port methods', () => {
    const compiler: PromptCompiler = createPromptCompiler();
    expect(typeof compiler.worker).toBe('function');
    expect(typeof compiler.fixer).toBe('function');
    expect(typeof compiler.resolver).toBe('function');
  });

  test('is stateless: every call returns the same string', () => {
    const compiler = createPromptCompiler();
    const verdict = themeFailureVerdict();
    const themeCtx = skyTodoContext('theme');
    expect(compiler.worker(ctx)).toBe(compiler.worker(ctx));
    expect(compiler.fixer(themeCtx, verdict)).toBe(compiler.fixer(themeCtx, verdict));
    expect(compiler.resolver(skyTodoContext('help-overlay'), helpOverlayConflict())).toBe(
      compiler.resolver(skyTodoContext('help-overlay'), helpOverlayConflict()),
    );
  });

  test('methods do not depend on `this`, so they can be destructured', () => {
    const { worker } = createPromptCompiler();
    expect(worker(ctx)).toContain('# Starling worker — csv-export');
  });

  test('leaks no JavaScript artefacts into any prompt', () => {
    const prompts = [
      createPromptCompiler().worker(ctx),
      createPromptCompiler().fixer(skyTodoContext('theme'), themeFailureVerdict()),
      createPromptCompiler().resolver(skyTodoContext('csv-export'), unattributedConflict()),
    ];
    for (const prompt of prompts) {
      expect(prompt).not.toContain('undefined');
      expect(prompt).not.toContain('[object Object]');
      expect(prompt).not.toContain('NaN');
    }
  });

  test('honours a tighter maxChars end to end', () => {
    const budget = 6000;
    const prompt = createPromptCompiler({ maxChars: budget, maxRepoMapChars: 12000 }).worker(ctx);
    expect(prompt.length).toBeLessThanOrEqual(budget);
    for (const item of ctx.task.definitionOfDone) expect(prompt).toContain(item);
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(Math.ceil(budget / 4));
  });

  test('matches the compact-style worker snapshot', () => {
    expect(createPromptCompiler({ style: 'compact' }).worker(ctx)).toMatchSnapshot();
  });
});
