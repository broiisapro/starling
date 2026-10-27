import { describe, expect, test } from 'bun:test';
import { createPromptCompiler, parseHandback } from './index.ts';
import { skyTodoContext } from './testing/context.ts';

const ctx = skyTodoContext('csv-export');
const prompt = createPromptCompiler().worker(ctx);
const siblingTasks = ctx.plan.tasks.filter((task) => task.key !== ctx.task.key);

describe('worker prompt — sky-todo fixture', () => {
  test('matches the committed snapshot', () => {
    expect(prompt).toMatchSnapshot();
  });

  test('opens with the role and names every parallel agent', () => {
    expect(prompt.startsWith('# Starling worker — csv-export')).toBe(true);
    expect(prompt).toContain('You are one of 7 agents working in parallel');
    expect(prompt).toContain(ctx.branch);
  });

  test('states the goal, the plan summary and every locked decision', () => {
    expect(prompt).toContain(ctx.goal.text);
    expect(prompt).toContain(ctx.plan.summary);
    for (const decision of ctx.plan.lockedDecisions) expect(prompt).toContain(decision);
    for (const constraint of ctx.goal.constraints) expect(prompt).toContain(constraint);
  });

  test('carries the task spec verbatim: deliverables, out of scope and every DoD item', () => {
    expect(prompt).toContain(ctx.task.title);
    expect(prompt).toContain(ctx.task.goal);
    for (const item of ctx.task.deliverables) expect(prompt).toContain(item);
    for (const item of ctx.task.outOfScope) expect(prompt).toContain(item);
    for (const item of ctx.task.definitionOfDone) expect(prompt).toContain(item);
  });

  test('lists every lane glob and explains how violations are detected', () => {
    for (const glob of ctx.task.lane.owns) expect(prompt).toContain(glob);
    for (const glob of ctx.task.lane.reads) expect(prompt).toContain(glob);
    expect(prompt).toContain('You may create or modify **only** files matching these globs');
    expect(prompt).toContain('lane violation');
    expect(prompt).toContain('fails the audit');
  });

  test('describes every sibling task with its lane, so nobody duplicates work', () => {
    expect(prompt).toContain('## What the others are doing');
    for (const sibling of siblingTasks) {
      expect(prompt).toContain(`- \`${sibling.key}\` — ${sibling.title} · owns `);
      for (const glob of sibling.lane.owns) expect(prompt).toContain(glob);
    }
  });

  test('points a dependent task at the work it can build on', () => {
    const dependent = createPromptCompiler().worker(skyTodoContext('due-badges'));
    expect(dependent).toContain('`dates-fix` is already merged');
    expect(dependent).toContain('do not re-implement it');
  });

  test('focuses the repo map on the lane', () => {
    expect(prompt).toContain('In your lane (editable):');
    expect(prompt).toContain('src/features/export/index.ts');
    expect(prompt).toContain('You will read:');
    expect(prompt).toContain('src/store/todos.ts');
  });

  test('includes the test command and repeats the DoD as the verification checklist', () => {
    expect(prompt).toContain('## How to verify');
    expect(prompt).toContain('`bun test`');
    for (const item of ctx.task.definitionOfDone) expect(prompt).toContain(item);
  });

  test('sets the git rules: commit here, never push or switch branches', () => {
    expect(prompt).toContain('## Git rules');
    expect(prompt).toContain('Conventional Commits');
    expect(prompt).toContain('Do not push, merge, rebase or switch branches');
    expect(prompt).toContain('never touch `main`');
  });

  test('ends with the handback markers and the block contract', () => {
    expect(prompt).toContain('<<<STARLING_HANDBACK');
    expect(prompt).toContain('STARLING_HANDBACK>>>');
    expect(prompt).toContain('"filesChanged"');
    expect(prompt).toContain('"testsAdded"');
    expect(prompt).toContain('counts as a partial result');
    // A prompt with no agent output must never parse as a finished handback.
    expect(parseHandback(prompt)).toBeUndefined();
  });

  test('follows the required section order', () => {
    const headings = [
      '# Starling worker',
      '## Project context',
      '## Your task',
      '## Your lane',
      '## What the others are doing',
      '## Repo orientation',
      '## How to verify',
      '## Git rules',
      '## Finish line',
    ];
    const positions = headings.map((heading) => prompt.indexOf(heading));
    for (const [index, position] of positions.entries()) {
      expect(position).toBeGreaterThanOrEqual(0);
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1] as number);
    }
  });

  test('is deterministic across compilers and calls', () => {
    const again = createPromptCompiler().worker(ctx);
    expect(again).toBe(prompt);
    expect(again).toBe(createPromptCompiler({ style: 'full' }).worker(ctx));
  });

  test('does not mutate the context it was given', () => {
    const before = JSON.stringify(ctx);
    createPromptCompiler({ maxChars: 2000 }).worker(ctx);
    expect(JSON.stringify(ctx)).toBe(before);
  });
});

describe('worker prompt — budget guard', () => {
  test('shrinks the repo map and then the sibling list before exceeding maxChars', () => {
    const tight = createPromptCompiler({ maxChars: 2000 }).worker(ctx);

    // The task spec and lane are never shrunk, even when the prompt cannot fit.
    for (const item of [...ctx.task.deliverables, ...ctx.task.outOfScope, ...ctx.task.definitionOfDone]) {
      expect(tight).toContain(item);
    }
    for (const glob of ctx.task.lane.owns) expect(tight).toContain(glob);

    expect(tight.length).toBeLessThan(prompt.length);
    expect(tight).toContain('…and 3 more');

    const fileLines = (text: string): number =>
      text.split('\n').filter((line) => line.startsWith('- src/')).length;
    expect(fileLines(tight)).toBeLessThan(fileLines(prompt));
  });

  test('a tighter map budget still keeps every editable lane file', () => {
    const smallMap = createPromptCompiler({ maxRepoMapChars: 450 }).worker(ctx);
    expect(smallMap).toContain('src/features/export/index.ts');
    expect(smallMap).toContain('In your lane (editable):');
    expect(smallMap.length).toBeLessThan(prompt.length);
  });

  test('fits the budget when there is room to shrink', () => {
    const budget = 5500;
    const tight = createPromptCompiler({ maxChars: budget }).worker(ctx);
    expect(tight.length).toBeLessThanOrEqual(budget);
  });
});

describe('worker prompt — compact style', () => {
  test('drops prose but keeps every fact', () => {
    const compact = createPromptCompiler({ style: 'compact' }).worker(ctx);
    expect(compact.length).toBeLessThan(prompt.length);
    for (const item of ctx.task.definitionOfDone) expect(compact).toContain(item);
    for (const glob of ctx.task.lane.owns) expect(compact).toContain(glob);
    expect(compact).toContain('<<<STARLING_HANDBACK');
    expect(compact).not.toContain('Nobody reviews your work in real time');
  });
});
