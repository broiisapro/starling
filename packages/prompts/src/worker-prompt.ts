/**
 * The worker prompt: everything a fresh agent needs to do one lane of work without asking a
 * human anything. Section order is part of the product (see docs/epic-13-prompts.md):
 * role → context → task → lane → siblings → repo → verify → git → finish line.
 */
import type { PromptContext } from '@starling/core';
import type { ResolvedPromptOptions } from './options';
import {
  finishLineSection,
  gitSection,
  laneSection,
  projectContextSection,
  repoOrientationSection,
  siblingsSection,
  taskSection,
  verificationSection,
  workerRoleSection,
} from './sections';
import { joinSections } from './text';

/** Below this the repo map stops being orientation and becomes noise. */
const MIN_MAP_CHARS = 400;

/** Keep at least this many siblings listed; the tail is what gets cut first. */
const MIN_SIBLINGS = 3;

/** The number of halving steps before giving up and accepting a long prompt. */
const MAX_SHRINK_STEPS = 12;

function assemble(
  ctx: PromptContext,
  options: ResolvedPromptOptions,
  mapBudget: number,
  siblingLimit: number,
): string {
  return joinSections([
    workerRoleSection(ctx, options),
    projectContextSection(ctx),
    taskSection(ctx),
    laneSection(ctx, options),
    siblingsSection(ctx, siblingLimit, options),
    repoOrientationSection(ctx, mapBudget, options),
    verificationSection(ctx, options),
    gitSection(ctx),
    finishLineSection(),
  ]);
}

/**
 * Build a worker prompt, shrinking the repo map and then the sibling list until it fits
 * `options.maxChars`. The task spec (deliverables, out-of-scope, definition of done) and the lane
 * globs are never touched: a long prompt is safer than an incomplete one.
 */
export function buildWorkerPrompt(ctx: PromptContext, options: ResolvedPromptOptions): string {
  const siblings = Math.max(0, ctx.plan.tasks.length - 1);
  let mapBudget = Math.max(MIN_MAP_CHARS, Math.floor(options.maxRepoMapChars * options.mapShare));
  let siblingLimit = siblings;
  let prompt = assemble(ctx, options, mapBudget, siblingLimit);

  for (let step = 0; step < MAX_SHRINK_STEPS; step += 1) {
    if (prompt.length <= options.maxChars) return prompt;
    if (mapBudget > MIN_MAP_CHARS) {
      mapBudget = Math.max(MIN_MAP_CHARS, Math.floor(mapBudget / 2));
      prompt = assemble(ctx, options, mapBudget, siblingLimit);
      continue;
    }
    if (siblingLimit > MIN_SIBLINGS && siblings > MIN_SIBLINGS) {
      siblingLimit = Math.max(MIN_SIBLINGS, Math.floor(siblingLimit / 2));
      prompt = assemble(ctx, options, mapBudget, siblingLimit);
      continue;
    }
    return prompt;
  }

  return prompt;
}
