/**
 * Deterministic repair: the safety net behind the LLM repair loop.
 *
 * `plan()` asks the model to fix validator errors at most `maxRepairs` times. Models are not
 * reliable, so whatever is left is fixed here, by rules that always terminate:
 *
 *   1. drop duplicate keys (keep the first) and un-auditable tasks (no lane, no DoD);
 *   2. drop dependencies on tasks that do not exist;
 *   3. break every cycle by dropping the newest edge (the edge whose source was added last);
 *   4. serialise every lane-overlapping concurrent pair by making the later key depend on the earlier.
 *
 * Each step publishes a warn-level `PlanIssue` so the engine and dashboard can see what was fixed
 * instead of silently losing work. After this pass a plan has no error-level issues, which is the
 * guarantee `plan()` promises (an empty plan is rejected by the planner instead).
 */
import { globsOverlap, type Plan, type PlanIssue, type RepoMap, type TaskSpec } from '@starling/core';
import { buildDepGraph, canRunConcurrently, findCycles, formatCycle } from './graph';

export interface RepairPlanOptions {
  /** Accepted for symmetry with `validatePlan`; repair itself needs no repo map. */
  map?: RepoMap;
  minTasks?: number;
  maxTasks?: number;
}

export interface RepairOutcome {
  plan: Plan;
  /** Warn-level descriptions of every deterministic fix that was applied. */
  notices: PlanIssue[];
}

function notice(code: PlanIssue['code'], message: string, taskKeys: string[]): PlanIssue {
  return { severity: 'warn', code, message, taskKeys };
}

function cloneTask(task: TaskSpec): TaskSpec {
  return {
    ...task,
    deliverables: [...task.deliverables],
    outOfScope: [...task.outOfScope],
    definitionOfDone: [...task.definitionOfDone],
    dependsOn: [...task.dependsOn],
    lane: { owns: [...task.lane.owns], reads: [...task.lane.reads] },
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (clean === '' || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function indexOfKey(tasks: TaskSpec[]): Map<string, number> {
  const indexes = new Map<string, number>();
  for (const [index, task] of tasks.entries()) {
    if (!indexes.has(task.key)) indexes.set(task.key, index);
  }
  return indexes;
}

/**
 * Pick the "newest" edge of a cycle: the one whose source task appears latest in the plan's task
 * array (tie-break on the target, then lexicographically). Dropping the dependency of the most
 * recently added task keeps the oldest, most load-bearing edges intact.
 */
function newestEdge(cycle: string[], tasks: TaskSpec[]): { from: string; to: string } {
  const indexes = indexOfKey(tasks);
  let best: { from: string; to: string; fromIndex: number; toIndex: number } | undefined;
  for (let i = 0; i < cycle.length; i += 1) {
    const from = cycle[i] as string;
    const to = cycle[(i + 1) % cycle.length] as string;
    const candidate = {
      from,
      to,
      fromIndex: indexes.get(from) ?? Number.MAX_SAFE_INTEGER,
      toIndex: indexes.get(to) ?? Number.MAX_SAFE_INTEGER,
    };
    if (
      best === undefined ||
      candidate.fromIndex > best.fromIndex ||
      (candidate.fromIndex === best.fromIndex && candidate.toIndex > best.toIndex) ||
      (candidate.fromIndex === best.fromIndex &&
        candidate.toIndex === best.toIndex &&
        candidate.from > best.from)
    ) {
      best = candidate;
    }
  }
  // A non-empty cycle always yields at least one edge.
  return best ?? { from: cycle[0] as string, to: cycle[0] as string };
}

function firstOverlappingConcurrentPair(
  tasks: TaskSpec[],
): { a: TaskSpec; b: TaskSpec; hits: string[] } | undefined {
  const graph = buildDepGraph(tasks);
  const candidates: Array<{ a: TaskSpec; b: TaskSpec; hits: string[] }> = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const a = tasks[i] as TaskSpec;
    for (let j = i + 1; j < tasks.length; j += 1) {
      const b = tasks[j] as TaskSpec;
      if (a.key === b.key) continue;
      if (!canRunConcurrently(graph, a.key, b.key)) continue;
      const hits = globsOverlap(a.lane.owns, b.lane.owns);
      if (hits.length === 0) continue;
      const [first, second] = a.key <= b.key ? [a, b] : [b, a];
      candidates.push({ a: first, b: second, hits });
    }
  }
  candidates.sort((x, y) => (x.a.key < y.a.key ? -1 : x.a.key > y.a.key ? 1 : x.b.key < y.b.key ? -1 : 1));
  return candidates[0];
}

/** Apply the deterministic fixes. Pure: the input plan and its tasks are never mutated. */
export function repairPlan(plan: Plan, _options: RepairPlanOptions = {}): RepairOutcome {
  const notices: PlanIssue[] = [];
  let tasks = plan.tasks.map(cloneTask);

  // ── 1. unique, non-empty keys ──────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const unique: TaskSpec[] = [];
  for (const task of tasks) {
    if (task.key.trim() === '') {
      notices.push(notice('other', `dropped a task with an empty key ("${task.title}")`, []));
      continue;
    }
    if (seen.has(task.key)) {
      notices.push(
        notice('other', `dropped duplicate task key "${task.key}"; kept the first occurrence`, [task.key]),
      );
      continue;
    }
    seen.add(task.key);
    unique.push(task);
  }
  tasks = unique;

  // ── 2. tasks that cannot be audited or verified ────────────────────────────────────────────
  tasks = tasks.filter((task) => {
    if (task.lane.owns.filter((glob) => glob.trim() !== '').length === 0) {
      notices.push(
        notice('other', `dropped task "${task.key}": it owns no files, so its work could never be audited`, [
          task.key,
        ]),
      );
      return false;
    }
    if (task.definitionOfDone.filter((item) => item.trim() !== '').length === 0) {
      notices.push(
        notice(
          'other',
          `dropped task "${task.key}": it has no definitionOfDone, so its work could never be verified`,
          [task.key],
        ),
      );
      return false;
    }
    return true;
  });

  // ── 3. dangling dependencies ───────────────────────────────────────────────────────────────
  const keys = new Set(tasks.map((task) => task.key));
  for (const task of tasks) {
    const deprecated = task.dependsOn.filter((dep) => !keys.has(dep));
    for (const dep of deprecated) {
      notices.push(
        notice('missing-dep', `dropped "${task.key}" dependency on "${dep}": no such task in the plan`, [
          task.key,
          dep,
        ]),
      );
    }
    task.dependsOn = dedupe(task.dependsOn).filter((dep) => keys.has(dep));
  }

  // ── 4. cycles ──────────────────────────────────────────────────────────────────────────────
  let cycleGuard = tasks.length + 1;
  while (cycleGuard > 0) {
    cycleGuard -= 1;
    const cycles = findCycles(buildDepGraph(tasks));
    const cycle = cycles[0];
    if (cycle === undefined) break;
    const edge = newestEdge(cycle, tasks);
    const source = tasks.find((task) => task.key === edge.from);
    if (source !== undefined) {
      source.dependsOn = source.dependsOn.filter((dep) => dep !== edge.to);
    }
    notices.push(
      notice(
        'cycle',
        `broke cycle ${formatCycle(cycle)} by dropping "${edge.to}" from "${edge.from}".dependsOn`,
        [...cycle],
      ),
    );
  }

  // ── 5. lane overlaps between tasks that can still run concurrently ─────────────────────────
  let overlapGuard = tasks.length * tasks.length + 1;
  while (overlapGuard > 0) {
    overlapGuard -= 1;
    const pair = firstOverlappingConcurrentPair(tasks);
    if (pair === undefined) break;
    const later = tasks.find((task) => task.key === pair.b.key);
    if (later === undefined) break;
    if (!later.dependsOn.includes(pair.a.key)) later.dependsOn.push(pair.a.key);
    notices.push(
      notice(
        'lane-overlap',
        `serialised "${pair.b.key}" after "${pair.a.key}" (added dependsOn) because their lanes overlap: ${pair.hits.join('; ')}`,
        [pair.a.key, pair.b.key],
      ),
    );
  }

  return { plan: { ...plan, tasks }, notices };
}
