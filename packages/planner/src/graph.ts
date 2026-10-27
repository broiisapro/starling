/**
 * Dependency-graph helpers shared by the validator and the deterministic repair pass.
 *
 * A task graph is `taskKey -> taskKeys it depends on`. Only keys that exist in the plan become
 * edges, so a dangling dependency cannot make the traversal loop or invent a node. Everything is
 * pure and deterministic: iteration follows the task array order and graph insertion order.
 */
import type { TaskSpec } from '@starling/core';

export type DepGraph = Map<string, string[]>;

/** Build `key -> deps` edges from the plan's tasks. Unknown and blank deps are ignored. */
export function buildDepGraph(tasks: TaskSpec[]): DepGraph {
  const known = new Set(tasks.map((task) => task.key));
  const graph: DepGraph = new Map();
  for (const task of tasks) {
    if (graph.has(task.key)) continue; // duplicates are a validator error; keep the first task
    const deps: string[] = [];
    const seen = new Set<string>();
    for (const dep of task.dependsOn) {
      const clean = dep.trim();
      if (clean === '' || seen.has(clean) || !known.has(clean)) continue;
      seen.add(clean);
      deps.push(clean);
    }
    graph.set(task.key, deps);
  }
  return graph;
}

/**
 * Find dependency cycles. Each cycle is returned once as a path without its repeated tail
 * (`['a', 'b']` means `a -> b -> a`).
 */
export function findCycles(graph: DepGraph): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    state.set(node, 'visiting');
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      const depState = state.get(dep);
      if (depState === 'visiting') {
        const start = stack.indexOf(dep);
        if (start !== -1) {
          const cycle = stack.slice(start);
          const key = canonicalCycle(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      } else if (depState !== 'done') {
        visit(dep);
      }
    }
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.keys()) {
    if (state.get(node) === undefined) visit(node);
  }
  return cycles;
}

/** Rotation-independent identity for a cycle, so `a->b->a` and `b->a->b` collapse to one report. */
export function canonicalCycle(cycle: string[]): string {
  if (cycle.length === 0) return '';
  let pivot = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if ((cycle[i] as string) < (cycle[pivot] as string)) pivot = i;
  }
  return [...cycle.slice(pivot), ...cycle.slice(0, pivot)].join('\u0000');
}

/** Human-readable cycle path: `a -> b -> a`. */
export function formatCycle(cycle: string[]): string {
  if (cycle.length === 0) return '';
  return [...cycle, cycle[0] as string].join(' -> ');
}

/** Every key reachable from `from` by following dependencies (excludes `from` unless it is in a cycle). */
export function reachableFrom(graph: DepGraph, from: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...(graph.get(from) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

/** True when `ancestor` must merge before `descendant` (transitively). */
export function isAncestor(graph: DepGraph, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return false;
  return reachableFrom(graph, descendant).has(ancestor);
}

/** Two tasks can run at the same time when neither depends on the other, transitively. */
export function canRunConcurrently(graph: DepGraph, a: string, b: string): boolean {
  if (a === b) return false;
  return !isAncestor(graph, a, b) && !isAncestor(graph, b, a);
}
