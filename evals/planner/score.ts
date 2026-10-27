import type { Plan, RepoMap, TaskSpec } from '../lib/core';
import { globsOverlap, matchesAny, normalizeGlobPath } from '../lib/core';
import type { PlannerCase } from './case';
import { validatePlan } from './validate';

export const PLANNER_CHECK_WEIGHTS = {
  validator: 0.2,
  'task-count': 0.1,
  'feature-coverage': 0.25,
  dependencies: 0.15,
  'lane-precision': 0.2,
  'definition-of-done': 0.1,
} as const;

export type PlannerCheckName = keyof typeof PLANNER_CHECK_WEIGHTS;

export interface PlanCheck {
  name: PlannerCheckName;
  ok: boolean;
  score: number;
  weight: number;
  detail: string;
}

export interface FeatureCoverage {
  feature: string;
  matchedTasks: string[];
}

export interface PlanScore {
  caseName: string;
  /** Weighted 0..1. A plan that satisfies every check scores exactly 1. */
  score: number;
  checks: PlanCheck[];
  coverage: FeatureCoverage[];
}

const TEST_ITEM = /test|spec|regress|verif/i;

/**
 * Score a plan against one answer-key case.
 *
 * The six checks map 1:1 to the assignment: validator cleanliness, task-count range, feature
 * coverage, dependency correctness, lane precision and DoD quality. Weights sum to 1, so a perfect
 * plan scores 1.0 and any single failure is directly readable from the check table.
 */
export function scorePlan(plan: Plan, testCase: PlannerCase, repoMap: RepoMap): PlanScore {
  const coverage = matchFeatures(plan, testCase);
  const taskFeatures = featureSetsByTask(plan, testCase);
  const knownFiles = new Set(repoMap.files.map((file) => file.path));

  const checks: PlanCheck[] = [
    checkValidator(plan, testCase),
    checkTaskCount(plan, testCase),
    checkCoverage(coverage, testCase),
    checkDependencies(plan, testCase, taskFeatures),
    checkLanes(plan, testCase, knownFiles),
    checkDefinitionOfDone(plan),
  ];

  const score = checks.reduce((sum, check) => sum + check.score * check.weight, 0);
  return { caseName: testCase.name, score: round(score), checks, coverage };
}

export function matchFeatures(plan: Plan, testCase: PlannerCase): FeatureCoverage[] {
  return testCase.features.map((feature) => ({
    feature: feature.id,
    matchedTasks: plan.tasks.filter((task) => matchesFeature(task, feature.keywords)).map((task) => task.key),
  }));
}

function matchesFeature(task: TaskSpec, keywordGroups: string[][]): boolean {
  const text = [task.key, task.title, task.goal, ...task.deliverables].join('\n').toLowerCase();
  return keywordGroups.every((group) => group.some((word) => text.includes(word.toLowerCase())));
}

function featureSetsByTask(plan: Plan, testCase: PlannerCase): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const task of plan.tasks) {
    const ids = new Set<string>();
    for (const feature of testCase.features) {
      if (matchesFeature(task, feature.keywords)) ids.add(feature.id);
    }
    out.set(task.key, ids);
  }
  return out;
}

function checkValidator(plan: Plan, testCase: PlannerCase): PlanCheck {
  const codes = [
    ...new Set(
      validatePlan(plan)
        .filter((i) => i.severity === 'error')
        .map((i) => i.code),
    ),
  ];
  const actual = [...codes].sort();
  const ok = testCase.validator.anyOf.some((allowed) => sameSet(actual, [...allowed].sort()));
  const accepted = testCase.validator.anyOf
    .map((set) => (set.length === 0 ? 'none' : set.join('+')))
    .join(' | ');
  return {
    name: 'validator',
    ok,
    score: ok ? 1 : 0,
    weight: PLANNER_CHECK_WEIGHTS.validator,
    detail: `errors: ${actual.length === 0 ? 'none' : actual.join(', ')} (accepted: ${accepted})`,
  };
}

function checkTaskCount(plan: Plan, testCase: PlannerCase): PlanCheck {
  const { min, max } = testCase.taskCount;
  const count = plan.tasks.length;
  const ok = count >= min && count <= max;
  return {
    name: 'task-count',
    ok,
    score: ok ? 1 : 0,
    weight: PLANNER_CHECK_WEIGHTS['task-count'],
    detail: `${count} task(s), expected ${min}–${max}`,
  };
}

function checkCoverage(coverage: FeatureCoverage[], testCase: PlannerCase): PlanCheck {
  const covered = coverage.filter((entry) => entry.matchedTasks.length > 0);
  const missing = coverage.filter((entry) => entry.matchedTasks.length === 0).map((entry) => entry.feature);
  const score = coverage.length === 0 ? 0 : covered.length / coverage.length;
  return {
    name: 'feature-coverage',
    ok: missing.length === 0,
    score: round(score),
    weight: PLANNER_CHECK_WEIGHTS['feature-coverage'],
    detail:
      missing.length === 0
        ? `all ${testCase.features.length} features covered`
        : `missing: ${missing.join(', ')}`,
  };
}

function checkDependencies(
  plan: Plan,
  testCase: PlannerCase,
  taskFeatures: Map<string, Set<string>>,
): PlanCheck {
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
  const edges = plan.tasks.flatMap((task) =>
    task.dependsOn.filter((dep) => byKey.has(dep)).map((dep) => ({ from: dep, to: task.key })),
  );

  const present = testCase.requiredDeps.filter(([dependency, dependent]) => {
    const fromTasks = tasksForFeature(taskFeatures, dependency);
    const toTasks = tasksForFeature(taskFeatures, dependent);
    return edges.some((edge) => fromTasks.has(edge.from) && toTasks.has(edge.to));
  });
  const requiredScore =
    testCase.requiredDeps.length === 0 ? 1 : present.length / testCase.requiredDeps.length;

  const mappedEdges = edges.filter(
    (edge) => (taskFeatures.get(edge.from)?.size ?? 0) > 0 && (taskFeatures.get(edge.to)?.size ?? 0) > 0,
  );
  /**
   * An edge is not a "spurious feature dependency" when the two tasks' lanes overlap: that edge is
   * the deterministic repair's serialisation of two tasks that cannot safely run concurrently (see
   * `repairPlan` step 5 and the carryover note in docs/epic-48-planner-quality.md). Penalising it
   * would punish the planner twice for one decision — once for the overlap, once for the fix — and
   * would push the prompt towards more tasks instead of better lanes.
   */
  const spurious = mappedEdges.filter((edge) => {
    const from = byKey.get(edge.from);
    const to = byKey.get(edge.to);
    if (from !== undefined && to !== undefined && globsOverlap(from.lane.owns, to.lane.owns).length > 0) {
      return false;
    }
    const fromFeatures = taskFeatures.get(edge.from) ?? new Set<string>();
    const toFeatures = taskFeatures.get(edge.to) ?? new Set<string>();
    return !testCase.requiredDeps.some(
      ([dependency, dependent]) => fromFeatures.has(dependency) && toFeatures.has(dependent),
    );
  });
  const spuriousPenalty = mappedEdges.length === 0 ? 0 : spurious.length / mappedEdges.length;
  const score = requiredScore * (1 - spuriousPenalty);
  const missing = testCase.requiredDeps.filter(
    (pair) => !present.some((hit) => hit[0] === pair[0] && hit[1] === pair[1]),
  );
  return {
    name: 'dependencies',
    ok: missing.length === 0 && spurious.length === 0,
    score: round(score),
    weight: PLANNER_CHECK_WEIGHTS.dependencies,
    detail:
      `required ${present.length}/${testCase.requiredDeps.length}` +
      (missing.length > 0 ? ` (missing ${missing.map((p) => p.join('<-')).join(', ')})` : '') +
      `, spurious ${spurious.length}`,
  };
}

function tasksForFeature(taskFeatures: Map<string, Set<string>>, feature: string): Set<string> {
  const out = new Set<string>();
  for (const [taskKey, features] of taskFeatures) {
    if (features.has(feature)) out.add(taskKey);
  }
  return out;
}

function checkLanes(plan: Plan, testCase: PlannerCase, knownFiles: Set<string>): PlanCheck {
  const covered = testCase.requiredLaneFiles.filter((file) =>
    plan.tasks.some(
      (task) => matchesAny(file, task.lane.owns) || coversNewFeatureFolder(file, task, testCase, knownFiles),
    ),
  );
  const violations = testCase.forbiddenFiles.filter((file) =>
    plan.tasks.some((task) => matchesAny(file, task.lane.owns)),
  );
  const requiredScore =
    testCase.requiredLaneFiles.length === 0 ? 1 : covered.length / testCase.requiredLaneFiles.length;
  const forbiddenScore =
    testCase.forbiddenFiles.length === 0 ? 1 : 1 - violations.length / testCase.forbiddenFiles.length;
  const missing = testCase.requiredLaneFiles.filter((file) => !covered.includes(file));
  const newFiles = covered.filter((file) => !knownFiles.has(file));
  return {
    name: 'lane-precision',
    ok: missing.length === 0 && violations.length === 0,
    score: round(requiredScore * forbiddenScore),
    weight: PLANNER_CHECK_WEIGHTS['lane-precision'],
    detail:
      `covered ${covered.length}/${testCase.requiredLaneFiles.length}` +
      (newFiles.length > 0 ? ` (${newFiles.length} new)` : '') +
      (missing.length > 0 ? `, missing ${missing.join(', ')}` : '') +
      (violations.length > 0 ? `, forbids-touched ${violations.join(', ')}` : ''),
  };
}

/**
 * Coverage for a feature folder that does not exist yet.
 *
 * The answer key names a concrete new path (`src/features/undo/index.ts`), but the goal never
 * dictates the folder's name: `src/features/undo-redo/**` is an equally good home for the same
 * capability. For a path that is not in the repo map, accept any owned path under the same feature
 * root *when the owning task is the task for that feature*. Existing files and shared paths still
 * need exact coverage, and `forbiddenFiles` still catches shared writes.
 */
function coversNewFeatureFolder(
  file: string,
  task: TaskSpec,
  testCase: PlannerCase,
  knownFiles: Set<string>,
): boolean {
  if (knownFiles.has(file)) return false;
  const segments = normalizeGlobPath(file).split('/');
  if (segments.length < 3) return false;
  const folder = (segments[segments.length - 2] ?? '').toLowerCase();
  if (folder === '') return false;
  const root = segments.slice(0, -2).join('/');
  if (!task.lane.owns.some((glob) => normalizeGlobPath(glob).startsWith(`${root}/`))) return false;

  const candidates = testCase.features.filter(
    (feature) =>
      feature.id
        .toLowerCase()
        .split('-')
        .some((word) => word.length > 2 && folder.includes(word)) ||
      feature.keywords.some((group) => group.some((word) => folder.includes(word.toLowerCase()))),
  );
  return candidates.some((feature) => matchesFeature(task, feature.keywords));
}

function checkDefinitionOfDone(plan: Plan): PlanCheck {
  if (plan.tasks.length === 0) {
    return {
      name: 'definition-of-done',
      ok: false,
      score: 0,
      weight: PLANNER_CHECK_WEIGHTS['definition-of-done'],
      detail: 'no tasks',
    };
  }
  const withTest = plan.tasks.filter((task) => task.definitionOfDone.some((item) => TEST_ITEM.test(item)));
  const missing = plan.tasks.filter((task) => !withTest.includes(task)).map((task) => task.key);
  return {
    name: 'definition-of-done',
    ok: missing.length === 0,
    score: round(withTest.length / plan.tasks.length),
    weight: PLANNER_CHECK_WEIGHTS['definition-of-done'],
    detail:
      missing.length === 0
        ? `all ${plan.tasks.length} tasks have a test step`
        : `no test step: ${missing.join(', ')}`,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
