/**
 * `@starling/planner` — turn one goal plus a `RepoMap` into a lane-safe task DAG.
 *
 * ```ts
 * import { createPlanner } from '@starling/planner';
 *
 * const planner = createPlanner({ llm });
 * const { plan, issues } = await planner.plan(goal, map);
 * // plan.tasks never contains an error-level issue: cycles, dangling deps and overlapping lanes
 * // were either fixed by the model or repaired deterministically before returning.
 * ```
 */
export const PACKAGE = '@starling/planner' as const;

export {
  createDefaultLlm,
  discoverOpencodeService,
  type OpencodeService,
  serviceFileCandidates,
} from './default-llm';
export { type PlanDraft, PlanDraftSchema } from './draft';
export { buildDepGraph, canRunConcurrently, findCycles, formatCycle, isAncestor } from './graph';
export { assignTaskKeys, dependencyOrder, stripTaskNumber } from './keys';
export { type CreatePlannerOptions, createPlanner, planFromDraft } from './planner';
export {
  buildPlanPrompt,
  buildRepairMessages,
  buildRepairRequest,
  DEFAULT_MAP_RENDERER,
  type MapRenderer,
  PLANNER_SYSTEM_PROMPT,
  type PlanPrompt,
  type PlanPromptOptions,
  renderMapFor,
} from './prompt';
export { type RenderRepoMapOptions, renderRepoMap } from './render-map';
export { type RepairOutcome, repairPlan } from './repair';
export {
  DEFAULT_MAX_TASKS,
  DEFAULT_MIN_TASKS,
  globCanNameNewFile,
  hasErrors,
  MAX_ESTIMATE_MIN,
  type ValidatePlanOptions,
  validatePlan,
  warningsOf,
} from './validate';
