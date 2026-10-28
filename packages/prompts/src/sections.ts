/**
 * The building blocks every prompt shares. Sections are plain strings; the builders decide which
 * ones to include and in what order, which keeps the worker/fixer/resolver voices consistent.
 */
import type { PromptContext, TaskSpec } from '@starling/core';
import { handbackInstructions } from './handback';
import type { ResolvedPromptOptions } from './options';
import { renderRepoMap } from './repo-map';
import { bullets, code, joinSections, numbered, plural } from './text';
import { fenceUntrusted, UNTRUSTED_NOTICE } from './untrusted';

/** The effective test command: the context override wins, then the map, and `auto` means "unknown". */
export function testCommandFor(ctx: PromptContext): string | undefined {
  const raw = ctx.testCommand?.trim() || ctx.map.testCommand?.trim();
  if (!raw || raw.toLowerCase() === 'auto') return undefined;
  return raw;
}

export function workerRoleSection(ctx: PromptContext, options: ResolvedPromptOptions): string {
  const total = ctx.plan.tasks.length;
  const compact = options.style === 'compact';
  return joinSections([
    `# Starling worker — ${ctx.task.key}`,
    compact
      ? `You are one of ${total} agents working in parallel on one goal. Work autonomously; do not stop to ask questions.`
      : `You are one of ${total} agents working in parallel on one goal. Each agent owns a lane of files and runs in its own git worktree. Nobody reviews your work in real time: investigate, decide, write down why, and finish. Do not stop to ask questions.`,
    `Branch: ${code(ctx.branch)} — already created and checked out. Do not switch branches.`,
    UNTRUSTED_NOTICE,
  ]);
}

export function projectContextSection(ctx: PromptContext): string {
  const location = [`**Repo:** ${code(ctx.map.root)}`];
  const test = testCommandFor(ctx);
  if (test) location.push(`tests: ${code(test)}`);
  if (ctx.map.lintCommand) location.push(`lint: ${code(ctx.map.lintCommand)}`);

  return joinSections([
    '## Project context',
    `**Goal:** ${ctx.goal.text}`,
    `**Plan:** ${ctx.plan.summary}`,
    location.join(' · '),
    ctx.plan.lockedDecisions.length > 0
      ? joinSections([
          '**Locked decisions — repo-wide, do not relitigate:**',
          bullets(ctx.plan.lockedDecisions),
        ])
      : undefined,
    ctx.goal.constraints.length > 0
      ? joinSections(['**Constraints from the goal:**', bullets(ctx.goal.constraints)])
      : undefined,
  ]);
}

function dependencyLine(task: TaskSpec, ctx: PromptContext): string {
  if (task.dependsOn.length === 0) {
    return '**Dependencies:** none — you start from the integration branch, so your work must stand on its own.';
  }
  const deps = task.dependsOn.map(code).join(', ');
  const verb = task.dependsOn.length === 1 ? 'is' : 'are';
  const them = task.dependsOn.length === 1 ? 'it' : 'them';
  return `**Dependencies:** ${deps} ${verb} already merged into ${code(ctx.branch)}. Build on ${them}; do not re-implement ${them}.`;
}

export function taskSection(ctx: PromptContext, heading = `## Your task: ${ctx.task.title}`): string {
  const task = ctx.task;
  return joinSections([
    heading,
    task.goal,
    '**Deliverables**',
    bullets(task.deliverables.map((item) => `[ ] ${item}`)),
    task.outOfScope.length > 0
      ? joinSections(['**Out of scope — do not do these**', bullets(task.outOfScope)])
      : undefined,
    joinSections(['**Definition of done — Starling checks every item**', numbered(task.definitionOfDone)]),
    dependencyLine(task, ctx),
  ]);
}

export function laneSection(ctx: PromptContext, options: ResolvedPromptOptions): string {
  const { owns, reads } = ctx.task.lane;
  if (owns.length === 0) {
    return joinSections([
      '## Your lane',
      '**Your lane is empty, which should never happen.** Do not edit anything outside the task you were given; finish with `"status":"partial"` and explain in `notes`.',
    ]);
  }

  const detection =
    options.style === 'compact'
      ? 'Changed files outside these globs fail the audit. Describe any out-of-lane change you need in your handback instead of making it.'
      : 'When you go idle Starling diffs your branch against the integration branch. Any changed file outside these globs is a lane violation and fails the audit — including a "one-line fix" in a sibling\'s file. If you genuinely need a change outside your lane, describe it in your handback notes instead of making it.';

  return joinSections([
    '## Your lane',
    joinSections(['You may create or modify **only** files matching these globs:', bullets(owns.map(code))]),
    reads.length > 0
      ? joinSections([
          'You may read anything, but these are the files that matter:',
          bullets(reads.map(code)),
        ])
      : 'You may read anything in the repo.',
    `**Lane violations fail the audit.** ${detection}`,
  ]);
}

export function siblingsSection(ctx: PromptContext, limit: number, options: ResolvedPromptOptions): string {
  const siblings = ctx.plan.tasks.filter((task) => task.key !== ctx.task.key);
  if (siblings.length === 0) {
    return joinSections([
      '## What the others are doing',
      'You are the only agent on this plan, so there are no sibling lanes to avoid.',
    ]);
  }

  const shown = siblings.slice(0, Math.max(0, limit));
  const lines = shown.map((task) => {
    const owns = task.lane.owns.length > 0 ? task.lane.owns.map(code).join(', ') : '(no globs declared)';
    return `- ${code(task.key)} — ${task.title} · owns ${owns}`;
  });
  const hidden = siblings.length - shown.length;
  if (hidden > 0) {
    lines.push(`- …and ${hidden} more; their lanes are in the plan and still off-limits.`);
  }

  const intro =
    options.style === 'compact'
      ? 'Other agents are working in parallel. Their lanes are off-limits: do not edit their files or duplicate their work.'
      : `${siblings.length} other ${plural(siblings.length, 'agent is', 'agents are')} working in parallel right now. Their lanes are off-limits: do not edit their files, and do not duplicate their work.`;

  return joinSections(['## What the others are doing', intro, lines.join('\n')]);
}

export function repoOrientationSection(
  ctx: PromptContext,
  mapBudget: number,
  options: ResolvedPromptOptions,
): string {
  const rendered = renderRepoMap(ctx.map, {
    lane: ctx.task.lane,
    maxChars: mapBudget,
  });
  return joinSections([
    '## Repo orientation',
    options.style === 'full'
      ? 'A snapshot, not the source of truth: read a file before you edit it.'
      : undefined,
    fenceUntrusted('repo-map', rendered.text),
  ]);
}

export function verificationSection(ctx: PromptContext, options: ResolvedPromptOptions): string {
  const test = testCommandFor(ctx);
  return joinSections([
    '## How to verify',
    test
      ? `Run ${code(test)} from the repo root before you finish. It must pass; a green suite is the difference between merged and failed.`
      : "No test command was detected for this repo. Use the project's existing runner (usually the `test` script in package.json); do not introduce a new test framework.",
    'Starling will check the definition of done item by item:',
    numbered(ctx.task.definitionOfDone),
    options.style === 'full'
      ? 'Prefer a real check to a claim: when an item describes behaviour, add or extend a test that fails without your change.'
      : undefined,
  ]);
}

export function gitSection(ctx: PromptContext): string {
  return joinSections([
    '## Git rules',
    bullets([
      `Commit on ${code(ctx.branch)} with Conventional Commits: \`feat(${ctx.task.key}): …\`, \`fix(${ctx.task.key}): …\`, \`test(${ctx.task.key}): …\`.`,
      'Commit small and often, and leave the working tree clean when you finish.',
      'Do not push, merge, rebase or switch branches, and never touch `main`. Starling handles integration.',
      'Never commit secrets, `.env`, `node_modules` or build output.',
    ]),
  ]);
}

export function finishLineSection(): string {
  return joinSections(['## Finish line', handbackInstructions()]);
}
