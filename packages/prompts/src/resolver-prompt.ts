/**
 * The resolver prompt: handed to a fresh resolver session when the merge queue reports a conflict.
 * It names both intents (the task being merged and every sibling whose lane touches a conflicted
 * file), shows the trimmed conflict hunks the merger captured, and sets the rules that stop a model
 * from "resolving" by deleting one side.
 */
import type { MergeResult, Plan, PromptContext, TaskSpec } from '@starling/core';
import { matchesAny, StarlingError } from '@starling/core';
import { applySectionBudgets, type SectionInput } from './budget';
import type { ResolvedPromptOptions } from './options';
import { finishLineSection, testCommandFor } from './sections';
import { bullets, clamp, code, joinSections, numbered, plural } from './text';
import { fenceUntrusted, UNTRUSTED_NOTICE } from './untrusted';

/**
 * Additive extras for the resolver prompt.
 *
 * The core `PromptCompiler` port (ARCHITECTURE §6, LOCKED) takes two arguments. The merger builds
 * this third argument from the conflicted working tree it just committed, and passes it only when
 * the injected compiler accepts it — a compiler that ignores extras still type-checks and works.
 */
export interface ResolverPromptExtras {
  /**
   * Trimmed conflict hunks, already formatted by the caller. Each entry starts with a
   * `--- <path>` header followed by the marker block, so a file with two conflicts stays readable.
   */
  hunks?: string[];
}

/** Cap on the rendered hunks: enough to recognise both sides, not enough to blow the budget. */
export const DEFAULT_MAX_HUNK_CHARS = 6_000;

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
    conflict.detail ? `**Merger detail:** ${fenceUntrusted('conflict-hunk', conflict.detail)}` : undefined,
  ]);
}

/**
 * The trimmed marker blocks the merger committed on the resolve branch.
 *
 * Without them the model has to run `git diff` blind before it knows what the two sides disagree
 * about; with them the prompt already shows which lines to reconcile. The full files are always
 * still in the worktree, and the block says so.
 */
function hunksBlock(extras: ResolverPromptExtras): string {
  const hunks = (extras.hunks ?? []).map((hunk) => hunk.trim()).filter((hunk) => hunk.length > 0);
  if (hunks.length === 0) return '';
  const body = clamp(hunks.join('\n'), DEFAULT_MAX_HUNK_CHARS);
  return joinSections([
    '## Conflict hunks (trimmed)',
    'These are shortened excerpts of the marker blocks, `--- <path>` starts a file. Read the full files in your worktree before you edit them; the excerpts are here so you can see both sides at a glance.',
    fenceUntrusted('conflict-hunk', ['```text', body, '```'].join('\n')),
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
    ...others.map((task) => intentBlock(task, `### ${code(task.key)} · ${task.title}`, false, true)),
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
      'Preserve both behaviours. Keep both sets of tests. Never drop one side’s work to make the conflict disappear.',
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

export function resolverSections(
  ctx: PromptContext,
  conflict: MergeResult,
  options: ResolvedPromptOptions,
  extras: ResolverPromptExtras = {},
): SectionInput[] {
  const count = conflict.conflictedFiles.length;
  return [
    {
      id: 'role',
      text: joinSections([
        `# Starling resolver — ${ctx.task.key}`,
        options.style === 'compact'
          ? `Merging ${code(ctx.branch)} into the integration branch conflicted in ${count} ${plural(count, 'file', 'files')}. Resolve it so both sides keep working.`
          : `Merging ${code(ctx.branch)} into the integration branch conflicted in ${count} ${plural(count, 'file', 'files')}. Resolve it so both sides' behaviour survives: this is real engineering, not marker deletion. Your work is already committed on the branch.`,
        UNTRUSTED_NOTICE,
      ]),
      priority: 100,
    },
    { id: 'project', text: filesBlock(conflict), priority: 90 },
    { id: 'fix-detail', text: hunksBlock(extras), priority: 20 },
    { id: 'task', text: intentBlock(ctx.task, "## Your task's intent", true, true), priority: 0 },
    { id: 'siblings', text: otherSideBlock(ctx, conflict), priority: 40 },
    { id: 'git', text: rulesBlock(ctx, conflict), priority: 80 },
    { id: 'finish', text: finishLineSection(), priority: 0 },
  ];
}

export function buildResolverPrompt(
  ctx: PromptContext,
  conflict: MergeResult,
  options: ResolvedPromptOptions,
  extras: ResolverPromptExtras = {},
): string {
  if (conflict.taskKey !== ctx.task.key) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `merge result is for task "${conflict.taskKey}" but the context is task "${ctx.task.key}"`,
      { details: { mergeTaskKey: conflict.taskKey, contextTaskKey: ctx.task.key } },
    );
  }

  return applySectionBudgets(resolverSections(ctx, conflict, options, extras), options.budgetTokens).text;
}
