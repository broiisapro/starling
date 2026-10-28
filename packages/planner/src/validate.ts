/**
 * Deterministic plan validation — the half of the planner the LLM cannot talk its way out of.
 *
 * The planner proposes; this file decides. Errors mean "this plan must not be executed" and the
 * planner responds by asking the model again and then repairing deterministically. Warnings are
 * advisory: they are returned to the engine (and shown in the dashboard) but do not block a run.
 *
 * The central rule: two tasks that can run concurrently (neither is an ancestor of the other) must
 * have disjoint `lane.owns` globs. A false positive costs one serialised task; a false negative
 * costs a merge conflict, so `globsOverlap` is intentionally conservative.
 */
import {
  matchesGlob,
  normalizeGlobPath,
  type Plan,
  type PlanIssue,
  type RepoMap,
  type TaskSpec,
} from '@starling/core';
import { buildDepGraph, findCycles, formatCycle } from './graph';
import { overlappingConcurrentPairs, ownedFileCount } from './lanes';

export const DEFAULT_MIN_TASKS = 1;
export const DEFAULT_MAX_TASKS = 12;
/**
 * Hard ceiling for `CreatePlannerOptions.maxTasks`. Wave 3 runs swarms of 30–60 tasks, so the old
 * advisory ceiling of 12 would warn on every real plan. The default stays 12: a plan that wants
 * more tasks should ask for it explicitly.
 */
export const PLANNER_MAX_TASKS_LIMIT = 100;
/** Warn when one task's lane matches more files than this in the repo map. */
export const DEFAULT_OWNED_FILES_WARN_AT = 40;
/** A task that takes one agent longer than this is a planning smell, not a hard error. */
export const MAX_ESTIMATE_MIN = 40;

export interface ValidatePlanOptions {
  /** Enables "owns a glob that matches nothing" warnings. Without a map those checks are skipped. */
  map?: RepoMap;
  minTasks?: number;
  maxTasks?: number;
  /**
   * Warn when a task owns more than this many files in `map`. Default 40: the planner prompt spends
   * its whole map budget on 60 owned files, so a package-wide lane starves the worker of context.
   * Ignored without a map. Non-positive or non-finite values fall back to the default.
   */
  ownedFilesWarnAt?: number;
}

function issue(
  severity: PlanIssue['severity'],
  code: PlanIssue['code'],
  message: string,
  taskKeys: string[],
): PlanIssue {
  return { severity, code, message, taskKeys };
}

function isBlank(value: string): boolean {
  return value.trim() === '';
}

/**
 * Append a concrete, actionable hint to a validator message. The original message is kept
 * byte-identical as the prefix: evals and snapshots match on the first clause.
 */
function fix(message: string, hint: string): string {
  return `${message}; fix: ${hint}`;
}

function ownedFilesThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_OWNED_FILES_WARN_AT;
  }
  return Math.floor(value);
}

function hasWildcard(value: string): boolean {
  return /[*?[]/.test(value);
}

function filesUnder(map: RepoMap, dir: string): boolean {
  const prefix = `${dir}/`;
  return map.files.some((file) => normalizeGlobPath(file.path).startsWith(prefix));
}

/**
 * True when a lane glob either matches a file that exists or plausibly names a *new* file in a
 * directory that exists (a new file in the repo root, a new file in a known folder, or a new folder
 * under a known folder). Used only for warnings, so the bias is towards "plausible".
 */
export function globCanNameNewFile(glob: string, map: RepoMap): boolean {
  const clean = normalizeGlobPath(glob);
  if (clean === '' || clean === '**') return true;
  if (map.files.some((file) => matchesGlob(normalizeGlobPath(file.path), clean))) return true;

  const separator = clean.lastIndexOf('/');
  const dir = separator === -1 ? '' : clean.slice(0, separator);
  if (dir === '') return map.files.length > 0;

  if (!hasWildcard(dir)) {
    if (filesUnder(map, dir)) return true;
    const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    // A brand-new folder directly under a known folder is exactly how feature folders are born.
    if (parent === '') return map.files.length > 0;
    return filesUnder(map, parent);
  }

  return map.files.some((file) => {
    const path = normalizeGlobPath(file.path);
    const slash = path.lastIndexOf('/');
    if (slash === -1) return false;
    return matchesGlob(path.slice(0, slash), dir);
  });
}

/** DoD items that never mention tests are a planning smell: the auditor needs something to run. */
function definitionOfDoneMentionsTests(task: TaskSpec): boolean {
  return task.definitionOfDone.some((item) => /\btest(s|ing|ed)?\b/i.test(item));
}

/**
 * Validate a plan without touching the LLM. Returns issues in a deterministic order:
 * duplicate keys, cycles, per-task problems (in task order), lane overlaps, task-count bounds.
 */
export function validatePlan(plan: Plan, options: ValidatePlanOptions = {}): PlanIssue[] {
  const minTasks = options.minTasks ?? DEFAULT_MIN_TASKS;
  const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
  const issues: PlanIssue[] = [];
  const tasks = plan.tasks;

  // ── duplicate keys ──────────────────────────────────────────────────────────────────────────
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.key, (counts.get(task.key) ?? 0) + 1);
  for (const [key, count] of counts) {
    if (count > 1) {
      issues.push(
        issue(
          'error',
          'other',
          fix(`task key "${key}" appears ${count} times; keys must be unique`, `rename all but one "${key}"`),
          [key],
        ),
      );
    }
  }

  const graph = buildDepGraph(tasks);

  // ── cycles ─────────────────────────────────────────────────────────────────────────────────
  for (const cycle of findCycles(graph)) {
    const [from, to] = cycle;
    const hint =
      to === undefined
        ? `remove one dependsOn edge in ${formatCycle(cycle)}`
        : `remove "${to}" from "${from}".dependsOn, or remove the reverse edge`;
    issues.push(issue('error', 'cycle', fix(`dependency cycle: ${formatCycle(cycle)}`, hint), [...cycle]));
  }

  // ── per-task checks ────────────────────────────────────────────────────────────────────────
  for (const [index, task] of tasks.entries()) {
    if (isBlank(task.key)) {
      issues.push(
        issue(
          'error',
          'other',
          fix(`task #${index + 1} has an empty key`, 'give it a short kebab-case key, e.g. "csv-export"'),
          [task.key],
        ),
      );
    }
    const owns = task.lane.owns.filter((glob) => !isBlank(glob));
    if (owns.length === 0) {
      issues.push(
        issue(
          'error',
          'empty-lane',
          fix(
            `task "${task.key}" has an empty lane.owns; a worker would have nowhere to write`,
            `add the folder this capability creates, e.g. "src/features/${task.key || 'capability'}/**"`,
          ),
          [task.key],
        ),
      );
    }
    const dod = task.definitionOfDone.filter((item) => !isBlank(item));
    if (dod.length === 0) {
      issues.push(
        issue(
          'error',
          'empty-dod',
          fix(
            `task "${task.key}" has an empty definitionOfDone; the auditor cannot verify it`,
            'add the test command plus one observable assertion',
          ),
          [task.key],
        ),
      );
    }

    for (const dep of task.dependsOn) {
      if (!counts.has(dep)) {
        issues.push(
          issue(
            'error',
            'missing-dep',
            fix(
              `task "${task.key}" depends on unknown task "${dep}"`,
              `add a task with key "${dep}" or remove it from "${task.key}".dependsOn`,
            ),
            [task.key, dep],
          ),
        );
      }
    }

    if (task.estimateMin > MAX_ESTIMATE_MIN) {
      issues.push(
        issue(
          'warn',
          'other',
          fix(
            `task "${task.key}" is estimated at ${task.estimateMin} min; split anything over ${MAX_ESTIMATE_MIN}`,
            `split "${task.key}" into two capabilities or lower estimateMin`,
          ),
          [task.key],
        ),
      );
    } else if (!Number.isFinite(task.estimateMin) || task.estimateMin <= 0) {
      issues.push(
        issue(
          'warn',
          'other',
          fix(
            `task "${task.key}" has a non-positive estimate`,
            'set estimateMin to a realistic 5–25 minutes',
          ),
          [task.key],
        ),
      );
    }

    if (dod.length > 0 && !definitionOfDoneMentionsTests(task)) {
      issues.push(
        issue(
          'warn',
          'other',
          fix(
            `task "${task.key}" has no test step in definitionOfDone; every task should prove itself with tests`,
            'add "<test command> passes" plus one assertion that proves the behaviour',
          ),
          [task.key],
        ),
      );
    }

    if (options.map !== undefined) {
      for (const glob of owns) {
        if (!globCanNameNewFile(glob, options.map)) {
          issues.push(
            issue(
              'warn',
              'other',
              fix(
                `task "${task.key}" owns "${glob}", which matches no file in the repo map and does not look like a new file in an existing directory`,
                'point it at an existing folder or the new folder the task creates',
              ),
              [task.key],
            ),
          );
        }
      }

      const owned = ownedFileCount(task, options.map);
      const warnAt = ownedFilesThreshold(options.ownedFilesWarnAt);
      if (owned > warnAt) {
        issues.push(
          issue(
            'warn',
            'other',
            fix(
              `task "${task.key}" owns ${owned} files in the repo map, above the ${warnAt}-file advisory limit`,
              'split it into per-capability tasks or narrow its lane',
            ),
            [task.key],
          ),
        );
      }
    }
  }

  // ── lane overlap between tasks that can run concurrently ───────────────────────────────────
  for (const { a, b, hits } of overlappingConcurrentPairs(tasks)) {
    issues.push(
      issue(
        'error',
        'lane-overlap',
        fix(
          `tasks "${a.key}" and "${b.key}" can run concurrently but their lanes overlap: ${hits.join('; ')}`,
          `add "${a.key}" to ${b.key}.dependsOn or narrow ${b.key}'s lane (${hits.join('; ')})`,
        ),
        [a.key, b.key],
      ),
    );
  }

  // ── plan size ──────────────────────────────────────────────────────────────────────────────
  if (tasks.length < minTasks || tasks.length > maxTasks) {
    const hint =
      tasks.length > maxTasks
        ? `split the goal into smaller runs or raise maxTasks above ${tasks.length}`
        : `add a task per capability the goal names or lower minTasks to ${tasks.length}`;
    issues.push(
      issue(
        'warn',
        'other',
        fix(
          `plan has ${tasks.length} task${tasks.length === 1 ? '' : 's'}, outside the configured bounds (${minTasks}..${maxTasks})`,
          hint,
        ),
        tasks.map((task) => task.key),
      ),
    );
  }

  return issues;
}

/** True when at least one issue is error-level (i.e. the plan is not executable). */
export function hasErrors(issues: PlanIssue[]): boolean {
  return issues.some((entry) => entry.severity === 'error');
}

/** Convenience: the warnings a caller should surface after a plan is repaired. */
export function warningsOf(issues: PlanIssue[]): PlanIssue[] {
  return issues.filter((entry) => entry.severity === 'warn');
}
