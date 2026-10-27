/**
 * The resolver prompt: handed to the task's agent when the merge queue reports a conflict.
 * It names both intents (its own task and every sibling whose lane touches a conflicted file)
 * and the rules that stop a model from "resolving" by deleting one side.
 */
import type { MergeResult, Plan, PromptContext, TaskSpec } from '@starling/core';
import { matchesAny, StarlingError } from '@starling/core';
import type { ResolvedPromptOptions } from './options';
import { finishLineSection, testCommandFor } from './sections';
import { bullets, code, joinSections, numbered, plural } from './text';

/**
 * Sibling tasks whose lane owns a conflicted file. This is how the resolver learns "both intents"
 * without the merger having to remember which tasks touched what.
 */
export function conflictingTasks(plan: Plan, taskKey: string, conflictedFiles: string[]): TaskSpec[] {
  return plan.tasks.filter(
    (task) => task.key !== taskKey && conflictedFiles.some((file) => matchesAny(file, task.lane.owns)),
  );
}

function filesBlock(conflict: MergeResult): string {
  if (conflict.conflictedFiles.length === 0) {
    return joinSections([
      '## Conflicted files',
      'The merger reported a conflict without naming files. Run `git status` and `git diff` to find the markers before you change anything.',
    ]);
  }
  return joinSections([
    '## Conflicted files',
    bullets(conflict.conflictedFiles.map(code)),
    conflict.detail ? `**Merger detail:** ${conflict.detail}` : undefined,
  ]);
}

function intentBlock(task: TaskSpec, heading: string, withTitle: boolean, withDod: boolean): string {
  return joinSections([
    heading,
    withTitle ? `**${task.title}**` : undefined,
    `**Goal:** ${task.goal}`,
    '**Deliverables**',
    bullets(task.deliverables),
    task.outOfScope.length > 0 ? `**Out of scope:** ${task.outOfScope.join('; ')}` : undefined,
    withDod ? joinSections(['**Definition of done**', numbered(task.definitionOfDone)]) : undefined,
  ]);
}

function otherSideBlock(ctx: PromptContext, conflict: MergeResult): string {
  const others = conflictingTasks(ctx.plan, ctx.task.key, conflict.conflictedFiles);
  if (others.length === 0) {
    const lanes = ctx.plan.tasks
      .filter((task) => task.key !== ctx.task.key)
      .map((task) => `${code(task.key)} (${task.lane.owns.map(code).join(', ') || 'no globs'})`);
    return joinSections([
      '## The other side',
      'The plan does not attribute these files to another task, so the other side is whatever already landed on the integration branch. Read that code before you change it.',
      lanes.length > 0
        ? joinSections(['Other tasks in the plan, for reference:', bullets(lanes)])
        : undefined,
    ]);
  }
  return joinSections([
    '## The other side',
    otherSideIntro(others.length),
    ...others.map((task) => intentBlock(task, `### ${code(task.key)} · ${task.title}`, false, false)),
  ]);
}

function otherSideIntro(count: number): string {
  return count === 1
    ? 'One other task also owns a conflicted file. Both behaviours must survive the resolution.'
    : `${count} other tasks also own conflicted files. Every behaviour must survive the resolution.`;
}

function rulesBlock(ctx: PromptContext, conflict: MergeResult): string {
  const test = testCommandFor(ctx);
  const owns = ctx.task.lane.owns.map(code).join(', ');
  const files = conflict.conflictedFiles.map(code).join(', ');
  return joinSections([
    '## Rules',
    bullets([
      'Preserve both behaviours. Never drop one side’s work to make the conflict disappear.',
      "Do not delete or weaken either side's tests. If two tests genuinely contradict each other, keep the stronger one and explain the choice in `notes`.",
      `Keep the change minimal: resolve the markers in ${files || 'the conflicted files'}, and avoid refactoring while you are there.`,
      `Your lane is ${owns}. A true conflict resolution may need one line in a sibling's file; keep it as small as possible and list every out-of-lane file in \`notes\`.`,
      'Resolve the markers in place. Do not `git merge --abort`, `git reset --hard`, or switch branches.',
      test
        ? `Run ${code(test)} and keep the whole suite green.`
        : 'Run the project’s existing test command and keep the whole suite green.',
      `Commit the resolution on ${code(ctx.branch)} with \`fix(${ctx.task.key}): resolve merge conflict\`.`,
    ]),
  ]);
}

export function buildResolverPrompt(
  ctx: PromptContext,
  conflict: MergeResult,
  options: ResolvedPromptOptions,
): string {
  if (conflict.taskKey !== ctx.task.key) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `merge result is for task "${conflict.taskKey}" but the context is task "${ctx.task.key}"`,
      { details: { mergeTaskKey: conflict.taskKey, contextTaskKey: ctx.task.key } },
    );
  }

  const count = conflict.conflictedFiles.length;
  return joinSections([
    `# Starling resolver — ${ctx.task.key}`,
    options.style === 'compact'
      ? `Merging ${code(ctx.branch)} into the integration branch conflicted in ${count} ${plural(count, 'file', 'files')}. Resolve it so both sides keep working.`
      : `Merging ${code(ctx.branch)} into the integration branch conflicted in ${count} ${plural(count, 'file', 'files')}. Resolve it so both sides' behaviour survives: this is real engineering, not marker deletion. Your work is already committed on the branch.`,
    filesBlock(conflict),
    intentBlock(ctx.task, "## Your task's intent", true, true),
    otherSideBlock(ctx, conflict),
    rulesBlock(ctx, conflict),
    finishLineSection(),
  ]);
}
