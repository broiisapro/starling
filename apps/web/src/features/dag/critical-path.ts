import type { Plan } from '@starling/core';

/**
 * The critical path: the longest dependency chain in the plan, measured by `estimateMin`.
 *
 * Why estimate and not "most tasks": the planner gives every task a minutes estimate, and the chain
 * whose estimates sum to the largest number is the one that decides how long the run can take. The
 * graph itself is a DAG (the planner validator rejects cycles), but this module still guards against
 * one so a bad plan can never hang the dashboard.
 *
 * Pure and memo-friendly: `DagView` computes it once per `Plan` identity and both the nodes and the
 * edges read the result.
 */
export interface CriticalPath {
  /** Task keys, root → leaf. Empty when there is no plan. */
  keys: string[];
  /** Sum of `estimateMin` along the chain. */
  estimateMin: number;
}

const EMPTY: CriticalPath = { keys: [], estimateMin: 0 };

/** Longer chain wins; equal totals break on the lexicographically smaller key list, for stability. */
function better(a: CriticalPath, b: CriticalPath): boolean {
  if (a.estimateMin !== b.estimateMin) return a.estimateMin > b.estimateMin;
  if (a.keys.length !== b.keys.length) return a.keys.length > b.keys.length;
  return a.keys.join('>') < b.keys.join('>');
}

function estimateOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function criticalPath(plan: Plan | undefined): CriticalPath {
  if (plan === undefined || plan.tasks.length === 0) return EMPTY;

  const byKey = new Map(plan.tasks.map((task) => [task.key, task] as const));
  const memo = new Map<string, CriticalPath>();
  const visiting = new Set<string>();

  /** Longest chain that ends at `key` (i.e. `key` plus its heaviest dependency chain). */
  const longestTo = (key: string): CriticalPath => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const task = byKey.get(key);
    if (task === undefined) return EMPTY;
    if (visiting.has(key)) return { keys: [key], estimateMin: estimateOf(task.estimateMin) };

    visiting.add(key);
    let best: CriticalPath = { keys: [], estimateMin: 0 };
    for (const dependency of task.dependsOn) {
      if (!byKey.has(dependency)) continue;
      const candidate = longestTo(dependency);
      if (better(candidate, best)) best = candidate;
    }
    visiting.delete(key);

    const result: CriticalPath = {
      keys: [...best.keys, key],
      estimateMin: best.estimateMin + estimateOf(task.estimateMin),
    };
    memo.set(key, result);
    return result;
  };

  let best: CriticalPath = EMPTY;
  for (const task of plan.tasks) {
    const candidate = longestTo(task.key);
    if (better(candidate, best)) best = candidate;
  }
  return best;
}

/** Just the keys, as a Set for O(1) membership checks while building nodes and edges. */
export function criticalKeys(plan: Plan | undefined): Set<string> {
  return new Set(criticalPath(plan).keys);
}

/**
 * Edge ids (`dep->key`) that lie on the critical chain. An edge is critical only when both ends are
 * adjacent **on that chain**: a dependency between two critical tasks that the chain skips is not
 * the bottleneck and must not glow.
 */
export function criticalEdges(plan: Plan | undefined): Set<string> {
  const { keys } = criticalPath(plan);
  const edges = new Set<string>();
  for (let index = 1; index < keys.length; index += 1) {
    const previous = keys[index - 1];
    const next = keys[index];
    if (previous !== undefined && next !== undefined) edges.add(`${previous}->${next}`);
  }
  return edges;
}
