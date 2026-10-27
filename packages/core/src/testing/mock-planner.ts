import type { Goal, Plan, PlanIssue, RepoMap } from '../contracts';
import type { Planner } from '../ports';
import { makePlan } from './factories';

export interface MockPlannerOptions {
  /** Scripted `plan()` results, consumed in order. */
  results?: Array<{ plan: Plan; issues: PlanIssue[] }>;
  /** Issues returned by `validate()`. Defaults to none. */
  issues?: PlanIssue[];
  /** Build a plan from the goal when no scripted result is left. */
  build?: (goal: Goal, map: RepoMap) => Plan;
}

/** Scripted `Planner` double. Records every call so tests can assert the goal reached the planner. */
export class MockPlanner implements Planner {
  readonly planCalls: Array<{ goal: Goal; map: RepoMap }> = [];
  readonly validateCalls: Plan[] = [];
  readonly #results: Array<{ plan: Plan; issues: PlanIssue[] }>;
  readonly #issues: PlanIssue[];
  readonly #build: (goal: Goal, map: RepoMap) => Plan;

  constructor(options: MockPlannerOptions = {}) {
    this.#results = [...(options.results ?? [])];
    this.#issues = options.issues ?? [];
    this.#build = options.build ?? ((goal) => makePlan({ goalId: goal.id }));
  }

  async plan(goal: Goal, map: RepoMap): Promise<{ plan: Plan; issues: PlanIssue[] }> {
    this.planCalls.push({ goal, map });
    const scripted = this.#results.shift();
    if (scripted !== undefined) return scripted;
    return { plan: this.#build(goal, map), issues: [...this.#issues] };
  }

  validate(plan: Plan): PlanIssue[] {
    this.validateCalls.push(plan);
    return [...this.#issues];
  }
}
