import type { Plan, TokenUsage } from '@starling/core';
import { DEFAULT_SAVED_MODEL, PRICING, usageCostUsd } from '@starling/core/browser';

/**
 * Rough cost/time estimates for the confirm step.
 *
 * These are deliberately simple, documented heuristics, not a forecast: the confirm gate exists so
 * a presenter can say "about ten cents" out loud, and so nobody launches a $50 run by accident.
 * They use the shared `PRICING` table (peak DeepSeek rates) and a per-task token profile measured
 * from a typical opencode session on sky-todo.
 */
export const TASK_TOKEN_ESTIMATE: TokenUsage = { input: 40_000, output: 6_000, cached: 0 };
export const PLANNER_TOKEN_ESTIMATE: TokenUsage = { input: 24_000, output: 3_000, cached: 0 };

/**
 * A run usually needs ~1.35 worker attempts per task (one audit failure in three). The engine
 * retries in the same session, so only the extra tokens count, not another session.
 */
export const RETRY_FACTOR = 1.35;

function multiply(usage: TokenUsage, factor: number): TokenUsage {
  return {
    input: Math.round(usage.input * factor),
    output: Math.round(usage.output * factor),
    cached: Math.round(usage.cached * factor),
  };
}

/** The price key to use: the plan's model when priced, else the API model as a conservative default. */
function priceKey(plan: Plan): string {
  return PRICING[plan.model.model] === undefined ? DEFAULT_SAVED_MODEL : plan.model.model;
}

/** Planner call + `tasks × RETRY_FACTOR` worker calls, at the plan model's price. */
export function estimatePlanCostUsd(plan: Plan): number {
  const key = priceKey(plan);
  const tasks = Math.max(1, plan.tasks.length);
  const workers = usageCostUsd(key, multiply(TASK_TOKEN_ESTIMATE, tasks * RETRY_FACTOR));
  const planner = usageCostUsd(key, PLANNER_TOKEN_ESTIMATE);
  return workers + planner;
}

/**
 * Longest dependency chain per task (1 = no dependencies). Unknown task keys are ignored and a
 * cycle settles at the last relaxation instead of spinning: the validator blocks cycles anyway.
 */
export function planDepths(plan: Plan): Map<string, number> {
  const tasks = new Map(plan.tasks.map((task) => [task.key, task]));
  const depths = new Map<string, number>();
  for (const task of plan.tasks) depths.set(task.key, 1);

  for (let pass = 0; pass < plan.tasks.length; pass += 1) {
    let changed = false;
    for (const task of plan.tasks) {
      let depth = 1;
      for (const dependency of task.dependsOn) {
        if (!tasks.has(dependency)) continue;
        depth = Math.max(depth, (depths.get(dependency) ?? 1) + 1);
      }
      if (depth !== depths.get(task.key)) {
        depths.set(task.key, depth);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depths;
}

/**
 * Wall-clock minutes assuming tasks at the same depth run in parallel (the DAG's natural width).
 * A `maxParallel` lower than that width makes this optimistic; the confirm step says "approximately".
 */
export function estimateMinutes(plan: Plan): number {
  if (plan.tasks.length === 0) return 0;
  const depths = planDepths(plan);
  const perDepth = new Map<number, number>();
  for (const task of plan.tasks) {
    const depth = depths.get(task.key) ?? 1;
    const minutes = Number.isFinite(task.estimateMin) ? Math.max(0, task.estimateMin) : 0;
    perDepth.set(depth, Math.max(perDepth.get(depth) ?? 0, minutes));
  }
  let total = 0;
  for (const minutes of perDepth.values()) total += minutes;
  return total;
}

/** Natural width of the DAG: how many agents can actually fly at once. */
export function estimateWidth(plan: Plan): number {
  if (plan.tasks.length === 0) return 0;
  const perDepth = new Map<number, number>();
  for (const depth of planDepths(plan).values()) {
    perDepth.set(depth, (perDepth.get(depth) ?? 0) + 1);
  }
  return Math.max(...perDepth.values());
}

/** 0…100: how much of the budget the estimate spends. */
export function budgetUsedPercent(costUsd: number, budgetUsd: number): number {
  if (!Number.isFinite(costUsd) || !Number.isFinite(budgetUsd) || budgetUsd <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((costUsd / budgetUsd) * 100)));
}
