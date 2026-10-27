import type { Goal, ModelRef, Plan, TaskSpec } from '@starling/core';
import { makePlan, makeTaskSpec } from '@starling/core/testing';

export interface MockPlanOptions {
  model?: ModelRef;
}

/**
 * The canned five-task DAG used by `compose(..., { mode: 'mock' })`.
 *
 * It is deliberately shaped like a real Starling plan: a survey, one core change, tests and docs
 * fanning out, then polish. Lanes are disjoint where tasks can run together, estimates add up, and
 * every task has a literal definition of done.
 */
export function buildMockPlan(goal: Goal, options: MockPlanOptions = {}): Plan {
  const subject = shortSubject(goal.text);
  const tasks: TaskSpec[] = [
    makeTaskSpec({
      key: 'survey',
      title: 'Survey the repo and lock the plan',
      goal: `Read the code related to “${subject}” and write down the seams the other tasks will use.`,
      deliverables: ['notes/survey.md lists the files, commands and risks'],
      outOfScope: ['Changing application code'],
      definitionOfDone: ['bun test passes', 'notes/survey.md names the test and lint commands'],
      dependsOn: [],
      lane: { owns: ['notes/**'], reads: ['**'] },
      estimateMin: 4,
    }),
    makeTaskSpec({
      key: 'core-change',
      title: 'Make the core change',
      goal: `Implement “${subject}” in the smallest coherent change.`,
      deliverables: [
        'The feature works from the app entry point',
        'Source lives under src/core/** or src/lib/**',
      ],
      outOfScope: ['Refactoring unrelated modules'],
      definitionOfDone: ['bun test passes', 'The change is exercised by at least one test'],
      dependsOn: ['survey'],
      lane: { owns: ['src/core/**', 'src/lib/**'], reads: ['src/main.ts', 'notes/**'] },
      estimateMin: 14,
    }),
    makeTaskSpec({
      key: 'tests',
      title: 'Add regression tests',
      goal: 'Cover the new behaviour and the edge cases the plan called out.',
      deliverables: ['Tests under test/**'],
      outOfScope: ['Changing production behaviour to make a test pass'],
      definitionOfDone: ['bun test passes', 'A failing edge case is covered'],
      dependsOn: ['core-change'],
      lane: { owns: ['test/**'], reads: ['src/core/**', 'src/lib/**'] },
      estimateMin: 8,
    }),
    makeTaskSpec({
      key: 'docs',
      title: 'Document the change',
      goal: 'Explain the new behaviour where a user will look for it.',
      deliverables: ['docs/** updated'],
      outOfScope: ['A changelog or release notes'],
      definitionOfDone: ['The docs mention the new behaviour', 'No broken links'],
      dependsOn: ['core-change'],
      lane: { owns: ['docs/**'], reads: ['src/core/**'] },
      estimateMin: 5,
    }),
    makeTaskSpec({
      key: 'polish',
      title: 'Polish the edges',
      goal: 'Handle empty states, keyboard access and the rough copying in the UI.',
      deliverables: ['src/ui/** updated'],
      outOfScope: ['A visual redesign'],
      definitionOfDone: ['bun test passes', 'Keyboard-only smoke test passes'],
      dependsOn: ['tests', 'docs'],
      lane: { owns: ['src/ui/**'], reads: ['src/core/**', 'src/ui/**'] },
      estimateMin: 6,
    }),
  ];

  return makePlan({
    goalId: goal.id,
    summary: `Five lane-disjoint tasks for “${subject}”: survey, core change, tests and docs, then polish.`,
    tasks,
    lockedDecisions: [
      'Work in the repo’s existing style — no new runtime dependencies',
      'Tests live beside their sources and run with `bun test`',
      'The integration branch is the deliverable; main is never touched',
    ],
    model: options.model ?? { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
  });
}

function shortSubject(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 64) return clean;
  return `${clean.slice(0, 63)}…`;
}
