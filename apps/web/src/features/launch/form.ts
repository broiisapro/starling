import type { LaunchFormErrors, LaunchFormValues, LaunchInput } from './types';

/**
 * Pure form rules for the launch panel.
 *
 * Everything the user can get wrong is validated here (not in JSX), so the tests can state the
 * contract without a DOM and the component stays a thin renderer.
 */

/** Below this the planner has nothing to decompose; it is also a cheap guard against a stray keypress. */
export const MIN_GOAL_LENGTH = 10;

/** Mirrors `MAX_PARALLEL_LIMIT` in `apps/server/src/routes/runs.ts` (the API rejects more). */
export const MAX_PARALLEL_LIMIT = 64;

/** `starling.config.example.yaml` ships `maxParallel: 8`; the form starts there. */
export const DEFAULT_MAX_PARALLEL = 8;

/** `starling.config.example.yaml` ships `budget.maxUsd: 5`. */
export const DEFAULT_BUDGET_USD = 5;

/** A sanity cap so a typo ("5000") cannot silently authorise a holiday. */
export const MAX_BUDGET_USD = 1_000;

export const DEFAULT_FORM: LaunchFormValues = {
  repoPath: '',
  goal: '',
  maxParallel: String(DEFAULT_MAX_PARALLEL),
  budgetUsd: String(DEFAULT_BUDGET_USD),
  dryRun: false,
};

/** Start a form, preferring the most recent repo when the shell has one. */
export function initialFormValues(recentRepos: readonly string[]): LaunchFormValues {
  const repoPath = recentRepos.find((repo) => repo.trim().length > 0) ?? '';
  return { ...DEFAULT_FORM, repoPath };
}

/** A goal is only invalid when it is too short; whitespace is not content. */
export function goalError(goal: string): string | undefined {
  const trimmed = goal.trim();
  if (trimmed.length === 0) return 'Tell the flock what to build.';
  if (trimmed.length < MIN_GOAL_LENGTH) {
    return `A little more detail, please — at least ${MIN_GOAL_LENGTH} characters.`;
  }
  return undefined;
}

/** `1…64` integers only; the server's zod schema rejects floats and zero. */
export function maxParallelError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Pick how many agents may fly at once.';
  if (!/^\d+$/.test(trimmed)) return 'Whole numbers only — the flock cannot split an agent.';
  const parsed = Number(trimmed);
  if (parsed < 1) return 'At least one agent has to fly.';
  if (parsed > MAX_PARALLEL_LIMIT) return `${MAX_PARALLEL_LIMIT} is the most this server accepts.`;
  return undefined;
}

/** `0…1000` USD; 0 means "plan only, no API spend" (the engine's guardrail blocks dispatch). */
export function budgetError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Set a budget — 0 means plan only.';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 'That is not a number of dollars.';
  if (parsed < 0) return 'A budget cannot be negative.';
  if (parsed > MAX_BUDGET_USD) return `Keep it under $${MAX_BUDGET_USD} — this is a demo, not a mortgage.`;
  return undefined;
}

export function validateForm(values: LaunchFormValues): LaunchFormErrors {
  const errors: LaunchFormErrors = {};
  if (values.repoPath.trim().length === 0) {
    errors.repoPath = 'Choose the repo the flock should work in.';
  }
  const goal = goalError(values.goal);
  if (goal !== undefined) errors.goal = goal;
  const parallel = maxParallelError(values.maxParallel);
  if (parallel !== undefined) errors.maxParallel = parallel;
  const budget = budgetError(values.budgetUsd);
  if (budget !== undefined) errors.budgetUsd = budget;
  return errors;
}

export function hasErrors(errors: LaunchFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Build the `StartRunInput` the shell receives. Only called with a valid form; optional keys are
 * omitted rather than set to `undefined` so a JSON body stays clean.
 */
export function toLaunchInput(values: LaunchFormValues): LaunchInput {
  const input: LaunchInput = {
    goal: values.goal.trim(),
    repoPath: values.repoPath.trim(),
    maxParallel: Number(values.maxParallel),
    budgetUsd: Number(values.budgetUsd),
  };
  if (values.dryRun) input.dryRun = true;
  return input;
}

/**
 * Stable identity for "the plan on screen is for these inputs" (stale-preview detection).
 *
 * Only the repo and the goal change the DAG; agents/budget/dry-run are dispatch knobs, so adjusting
 * them must not mark a perfectly good plan stale.
 */
export function requestKey(values: LaunchFormValues): string {
  return JSON.stringify([values.repoPath.trim(), values.goal.trim()]);
}

/** Apply a quick-pick chip: the text becomes the goal and the chip remembers it is selected. */
export function applyGoal(values: LaunchFormValues, goal: { name: string; text: string }): LaunchFormValues {
  return { ...values, goal: goal.text, goalName: goal.name };
}

/**
 * A hand-edited goal is no longer the chip's goal. Keeps `aria-pressed` honest without fighting the
 * user: we only drop the label, never rewrite the text.
 */
export function editedGoal(values: LaunchFormValues, goal: string): LaunchFormValues {
  return { ...values, goal, goalName: undefined };
}
