import type { NodeInfo, TaskSpec } from '../contracts';
import type { Scheduler } from '../ports';

/**
 * `Scheduler` double. Default policy mirrors the real one: the online node with the most free
 * session slots, tie-broken by lowest latency and then by list order (hub first).
 *
 * `force` pins specific tasks to specific nodes, which is how tests reproduce "the Air got it".
 */
export class MockScheduler implements Scheduler {
  readonly calls: Array<{ taskKey: string; nodeIds: string[] }> = [];
  readonly #force: Record<string, string>;
  readonly #picker: ((nodes: NodeInfo[], task: TaskSpec) => string | undefined) | undefined;

  constructor(
    options: {
      force?: Record<string, string>;
      picker?: (nodes: NodeInfo[], task: TaskSpec) => string | undefined;
    } = {},
  ) {
    this.#force = options.force ?? {};
    this.#picker = options.picker;
  }

  pick(nodes: NodeInfo[], task: TaskSpec): string | undefined {
    this.calls.push({ taskKey: task.key, nodeIds: nodes.map((n) => n.id) });
    if (this.#picker) return this.#picker(nodes, task);
    const forced = this.#force[task.key];
    if (forced !== undefined) return nodes.some((n) => n.id === forced) ? forced : undefined;

    const candidates = nodes.filter((n) => n.status !== 'offline' && n.activeSessions < n.maxSessions);
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => {
      const free = b.maxSessions - b.activeSessions - (a.maxSessions - a.activeSessions);
      if (free !== 0) return free;
      return (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER);
    });
    return candidates[0]?.id;
  }
}
