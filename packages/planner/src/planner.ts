/**
 * `createPlanner` — goal + repo map -> lane-safe task DAG.
 *
 * The LLM proposes a plan; deterministic code verifies it, asks the model to fix errors a bounded
 * number of times, and then repairs whatever is left with rules that cannot fail. The result always
 * has zero error-level issues, so the engine can trust it enough to start work.
 */
import {
  type Clock,
  type Goal,
  type LLM,
  type LLMResponse,
  newId,
  normalizeGlobPath,
  type Plan,
  type PlanIssue,
  type Planner,
  type RepoMap,
  StarlingError,
  systemClock,
  type TaskSpec,
} from '@starling/core';
import { createDefaultLlm } from './default-llm';
import { type PlanDraft, PlanDraftSchema } from './draft';
import { assignTaskKeys } from './keys';
import { buildPlanPrompt, buildRepairMessages, type MapRenderer, type PlanPrompt } from './prompt';
import { repairPlan } from './repair';
import {
  DEFAULT_MAX_TASKS,
  DEFAULT_MIN_TASKS,
  hasErrors,
  PLANNER_MAX_TASKS_LIMIT,
  validatePlan,
  warningsOf,
} from './validate';

export interface CreatePlannerOptions {
  /**
   * The model. Omit it to build the default router from the environment
   * (`starling.config.yaml` + `STARLING_LLM_PROFILE`), which is what the CLI, the server and the
   * eval harness do.
   */
  llm?: LLM;
  clock?: Clock;
  /** How many times the model is asked to fix validator errors. Default 2. */
  maxRepairs?: number;
  /** Lowest acceptable task count; below it the plan gets a warning. Default 2. */
  minTasks?: number;
  /**
   * Highest acceptable task count (2..`PLANNER_MAX_TASKS_LIMIT`, i.e. 2..100); above it the plan
   * gets a warning. Default 12 — ask for more explicitly when planning at swarm scale.
   */
  maxTasks?: number;
  /** Token budget for each planner completion. */
  maxTokens?: number;
  /** 0 by default: planning should be repeatable, not creative. */
  temperature?: number;
  /**
   * Repo-map renderer embedded in the prompt. Default `repomap` (see `docs/epic-48-planner-quality.md`).
   *
   * @deprecated `'verbose'` is kept only for the recorded A/B and will be removed; use the default.
   */
  mapRenderer?: MapRenderer;
  /** Approximate token budget for the repo-map block. Default 3000. */
  mapTokens?: number;
}

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeGlobs(globs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of globs) {
    const clean = normalizeGlobPath(raw);
    if (clean === '' || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const clean = raw.trim();
    if (clean === '' || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeTask(task: TaskSpec): TaskSpec {
  const dependsOn = normalizeStrings(task.dependsOn.map(normalizeKey));
  return {
    key: normalizeKey(task.key),
    title: task.title.trim(),
    goal: task.goal.trim(),
    deliverables: normalizeStrings(task.deliverables),
    outOfScope: normalizeStrings(task.outOfScope),
    definitionOfDone: normalizeStrings(task.definitionOfDone),
    dependsOn,
    lane: {
      owns: normalizeGlobs(task.lane.owns),
      reads: normalizeGlobs(task.lane.reads),
    },
    estimateMin: Number.isFinite(task.estimateMin) ? task.estimateMin : 0,
  };
}

/**
 * Turn the model's draft into a `Plan`: Starling mints the id, attaches the goal, records the model
 * that actually answered and stamps the clock. Keys and globs are normalised so branch names and
 * file paths stay safe; duplicate keys survive normalisation and are caught by the validator.
 */
export function planFromDraft(draft: PlanDraft, goal: Goal, model: Plan['model'], createdAt: number): Plan {
  return {
    id: newId(),
    goalId: goal.id,
    summary: draft.summary.trim(),
    tasks: draft.tasks.map(normalizeTask),
    lockedDecisions: normalizeStrings(draft.lockedDecisions),
    model,
    createdAt,
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function createPlanner(options: CreatePlannerOptions): Planner {
  let llm = options.llm;
  const clock = options.clock ?? systemClock;
  const maxRepairs = positiveInt(options.maxRepairs, 2);
  const minTasks = options.minTasks ?? DEFAULT_MIN_TASKS;
  const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
  const maxTokens = options.maxTokens ?? 8192;
  const temperature = options.temperature ?? 0;

  if (!Number.isInteger(minTasks) || minTasks < 1) {
    throw new StarlingError('INVALID_ARGUMENT', 'planner minTasks must be an integer >= 1', {
      details: { minTasks },
    });
  }
  if (!Number.isInteger(maxTasks) || maxTasks < 2 || maxTasks > PLANNER_MAX_TASKS_LIMIT) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `planner maxTasks must be an integer in 2..${PLANNER_MAX_TASKS_LIMIT}`,
      { details: { maxTasks } },
    );
  }
  if (minTasks > maxTasks) {
    throw new StarlingError('INVALID_ARGUMENT', 'planner minTasks cannot exceed maxTasks', {
      details: { minTasks, maxTasks },
    });
  }

  // The frozen `Planner` port has `validate(plan)`, so the most recent repo map is kept here for
  // glob-existence warnings. `validatePlan(plan, { map })` is the map-aware form for other callers.
  let lastMap: RepoMap | undefined;

  async function requestPlan(
    system: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<{ draft: PlanDraft; response: LLMResponse<PlanDraft> }> {
    // Resolved once and cached: a caller that supplied an `LLM` never touches the environment, and
    // a caller that did not pays the router construction exactly once.
    llm ??= await createDefaultLlm();
    const response = await llm.completeJson<PlanDraft>(
      {
        role: 'planner',
        system,
        messages,
        maxTokens,
        temperature,
      },
      PlanDraftSchema,
    );
    if (response.parsed === undefined) {
      throw new StarlingError('LLM_ERROR', 'planner LLM returned no parsed plan', {
        details: { model: response.model },
      });
    }
    return { draft: response.parsed, response };
  }

  async function plan(goal: Goal, map: RepoMap): Promise<{ plan: Plan; issues: PlanIssue[] }> {
    lastMap = map;
    const prompt: PlanPrompt = buildPlanPrompt(goal, map, {
      minTasks,
      maxTasks,
      ...(options.mapRenderer === undefined ? {} : { mapRenderer: options.mapRenderer }),
      ...(options.mapTokens === undefined ? {} : { mapTokens: options.mapTokens }),
    });
    const validateOptions = { map, minTasks, maxTasks };

    const first = await requestPlan(prompt.system, [{ role: 'user', content: prompt.user }]);
    let draft = first.draft;
    let planValue = planFromDraft(draft, goal, first.response.model, clock.now());
    let issues = validatePlan(planValue, validateOptions);

    let repairs = 0;
    while (hasErrors(issues) && repairs < maxRepairs) {
      repairs += 1;
      const repair = await requestPlan(prompt.system, buildRepairMessages(prompt, draft, issues));
      draft = repair.draft;
      planValue = planFromDraft(draft, goal, repair.response.model, clock.now());
      issues = validatePlan(planValue, validateOptions);
    }

    const repaired = repairPlan(planValue);
    if (repaired.plan.tasks.length === 0) {
      throw new StarlingError('PLAN_INVALID', 'planner produced no executable tasks', {
        details: { goalId: goal.id, goal: goal.text, issues },
      });
    }

    // Renumber only once the plan is final: validator errors and repair notices keep the model's
    // own keys, so the repair transcript reads naturally, while every task branch and dashboard row
    // gets the stable `tNN-kebab` key.
    const finalPlan = assignTaskKeys(repaired.plan);
    const remaining = validatePlan(finalPlan, validateOptions);
    const errors = remaining.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      // Defensive: the repair pass is designed to make this unreachable. If it ever fires, the plan
      // must not be executed, and the details are enough to reproduce the bug from a fixture.
      throw new StarlingError('PLAN_INVALID', 'deterministic repair left error-level issues', {
        details: { goalId: goal.id, issues: errors },
      });
    }

    return { plan: finalPlan, issues: [...repaired.notices, ...warningsOf(remaining)] };
  }

  function validate(planValue: Plan): PlanIssue[] {
    return validatePlan(planValue, { map: lastMap, minTasks, maxTasks });
  }

  return { plan, validate };
}
