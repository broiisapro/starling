/**
 * The fixer prompt: sent to the *same* session and worktree after a failed audit. It repeats the
 * failed checks and the auditor's exact instructions, because a model that lost the thread needs
 * the verdict more than a pep talk.
 */
import type { AuditVerdict, PromptContext } from '@starling/core';
import { StarlingError } from '@starling/core';
import type { ResolvedPromptOptions } from './options';
import { finishLineSection, laneSection, taskSection, testCommandFor } from './sections';
import { bullets, code, joinSections } from './text';

function checksBlock(verdict: AuditVerdict, options: ResolvedPromptOptions): string {
  const failed = verdict.checks.filter((check) => !check.ok);
  const passed = verdict.checks.filter((check) => check.ok);

  return joinSections([
    '## What the audit found',
    failed.length > 0
      ? joinSections([
          '**Failed checks**',
          bullets(failed.map((check) => `${code(check.name)} — ${check.detail}`)),
        ])
      : 'The auditor failed the task without naming a failing check. Use the summary and the fix instructions below.',
    `**Passed checks:** ${passed.length > 0 ? passed.map((check) => code(check.name)).join(', ') : 'none'}`,
    `**Audit summary:** ${verdict.summary}`,
    options.style === 'full'
      ? 'The checks above are the whole reason this attempt failed. Ignore anything else that looks improvable.'
      : undefined,
  ]);
}

function laneViolationBlock(verdict: AuditVerdict, ctx: PromptContext): string {
  if (verdict.laneViolations.length === 0) {
    return joinSections(['**Lane violations:** none — the lane check passed.']);
  }
  const owns = ctx.task.lane.owns.map(code).join(', ');
  return joinSections([
    '**Lane violations — revert these before you continue**',
    bullets(verdict.laneViolations),
    `Your lane is ${owns}. Changes outside it must be reverted, not built on.`,
  ]);
}

function fixInstructionBlock(verdict: AuditVerdict): string {
  if (verdict.fixInstructions === undefined || verdict.fixInstructions.trim().length === 0) {
    return joinSections([
      '## Fix instructions',
      'The auditor gave no separate instructions; treat the audit summary above as the instruction.',
    ]);
  }
  return joinSections([
    '## Fix instructions',
    verdict.fixInstructions,
    'Follow these instructions literally. They were written after the auditor read your diff.',
  ]);
}

function rulesBlock(ctx: PromptContext, verdict: AuditVerdict): string {
  const test = testCommandFor(ctx);
  const owns = ctx.task.lane.owns.map(code).join(', ');
  const reverted =
    verdict.laneViolations.length > 0
      ? ' You already changed files outside your lane: revert those changes rather than building on them.'
      : '';

  return joinSections([
    '## Rules',
    bullets([
      'Fix only what is listed above. Do not redo work that already passed, and do not refactor beyond the fix.',
      `The same lane rules apply: you may change only ${owns}.${reverted}`,
      `Commit on the same branch ${code(ctx.branch)}. Do not push, merge, rebase or switch branches.`,
      test
        ? `Run ${code(test)} again and keep the whole suite green.`
        : 'Run the project’s existing test command again and keep the whole suite green.',
      'If a check is wrong, say so in `notes` with evidence. Never delete or weaken a test to make it pass.',
    ]),
  ]);
}

export function buildFixerPrompt(
  ctx: PromptContext,
  verdict: AuditVerdict,
  options: ResolvedPromptOptions,
): string {
  if (verdict.taskKey !== ctx.task.key) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `audit verdict is for task "${verdict.taskKey}" but the context is task "${ctx.task.key}"`,
      { details: { verdictTaskKey: verdict.taskKey, contextTaskKey: ctx.task.key } },
    );
  }

  return joinSections([
    `# Starling fixer — ${ctx.task.key} (audit attempt ${verdict.attempt} failed)`,
    options.style === 'compact'
      ? `Your previous attempt on ${code(ctx.branch)} failed the audit. Your work is still in the worktree: fix what is listed, then finish again.`
      : `Your previous attempt on ${code(ctx.branch)} failed the audit. You are still in the same worktree with your work in place, so fix what is listed below and finish again — do not start over.`,
    checksBlock(verdict, options),
    laneViolationBlock(verdict, ctx),
    fixInstructionBlock(verdict),
    rulesBlock(ctx, verdict),
    taskSection(ctx, '## Your task (unchanged, for reference)'),
    laneSection(ctx, options),
    finishLineSection(),
  ]);
}
