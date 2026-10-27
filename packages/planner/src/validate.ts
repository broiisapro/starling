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
  globsOverlap,
  matchesGlob,
  normalizeGlobPath,
  type Plan,
  type PlanIssue,
  type RepoMap,
  type TaskSpec,
} from '@starling/core';
import { buildDepGraph, canRunConcurrently, findCycles, formatCycle } from './graph';

export const DEFAULT_MIN_TASKS = 2;
export const DEFAULT_MAX_TASKS = 12;
/** A task that takes one agent longer than this is a planning smell, not a hard error. */
export const MAX_ESTIMATE_MIN = 40;

export interface ValidatePlanOptions {
  /** Enables "owns a glob that matches nothing" warnings. Without a map those checks are skipped. */
  map?: RepoMap;
  minTasks?: number;
  maxTasks?: number;
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
        issue('error', 'other', `task key "${key}" appears ${count} times; keys must be unique`, [key]),
      );
    }
  }

  const graph = buildDepGraph(tasks);

  // ── cycles ─────────────────────────────────────────────────────────────────────────────────
  for (const cycle of findCycles(graph)) {
    issues.push(issue('error', 'cycle', `dependency cycle: ${formatCycle(cycle)}`, [...cycle]));
  }

  // ── per-task checks ────────────────────────────────────────────────────────────────────────
  for (const [index, task] of tasks.entries()) {
    if (isBlank(task.key)) {
      issues.push(issue('error', 'other', `task #${index + 1} has an empty key`, [task.key]));
    }
    const owns = task.lane.owns.filter((glob) => !isBlank(glob));
    if (owns.length === 0) {
      issues.push(
        issue(
          'error',
          'empty-lane',
          `task "${task.key}" has an empty lane.owns; a worker would have nowhere to write`,
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
          `task "${task.key}" has an empty definitionOfDone; the auditor cannot verify it`,
          [task.key],
        ),
      );
    }

    for (const dep of task.dependsOn) {
      if (!counts.has(dep)) {
        issues.push(
          issue('error', 'missing-dep', `task "${task.key}" depends on unknown task "${dep}"`, [
            task.key,
            dep,
          ]),
        );
      }
    }

    if (task.estimateMin > MAX_ESTIMATE_MIN) {
      issues.push(
        issue(
          'warn',
          'other',
          `task "${task.key}" is estimated at ${task.estimateMin} min; split anything over ${MAX_ESTIMATE_MIN}`,
          [task.key],
        ),
      );
    } else if (!Number.isFinite(task.estimateMin) || task.estimateMin <= 0) {
      issues.push(issue('warn', 'other', `task "${task.key}" has a non-positive estimate`, [task.key]));
    }

    if (dod.length > 0 && !definitionOfDoneMentionsTests(task)) {
      issues.push(
        issue(
          'warn',
          'other',
          `task "${task.key}" has no test step in definitionOfDone; every task should prove itself with tests`,
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
              `task "${task.key}" owns "${glob}", which matches no file in the repo map and does not look like a new file in an existing directory`,
              [task.key],
            ),
          );
        }
      }
    }
  }

  // ── lane overlap between tasks that can run concurrently ───────────────────────────────────
  for (let i = 0; i < tasks.length; i += 1) {
    const a = tasks[i] as TaskSpec;
    for (let j = i + 1; j < tasks.length; j += 1) {
      const b = tasks[j] as TaskSpec;
      if (a.key === b.key) continue;
      if (!canRunConcurrently(graph, a.key, b.key)) continue;
      const hits = globsOverlap(
        a.lane.owns.filter((glob) => !isBlank(glob)),
        b.lane.owns.filter((glob) => !isBlank(glob)),
      );
      if (hits.length > 0) {
        issues.push(
          issue(
            'error',
            'lane-overlap',
            `tasks "${a.key}" and "${b.key}" can run concurrently but their lanes overlap: ${hits.join('; ')}`,
            [a.key, b.key],
          ),
        );
      }
    }
  }

  // ── plan size ──────────────────────────────────────────────────────────────────────────────
  if (tasks.length < minTasks || tasks.length > maxTasks) {
    issues.push(
      issue(
        'warn',
        'other',
        `plan has ${tasks.length} task${tasks.length === 1 ? '' : 's'}, outside the configured bounds (${minTasks}..${maxTasks})`,
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
