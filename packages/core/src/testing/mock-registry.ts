import type { NodeInfo } from '../contracts';
import type { ExecutionNode, NodeRegistry, NodeRegistryEvent } from '../ports';
import { makeNodeInfo } from './factories';
import type { MockNode } from './mock-node';

/** Kept as an alias so existing test imports keep working; the shape is core's. */
export type MockRegistryEvent = NodeRegistryEvent;

/**
 * `NodeRegistry` double: an ordered map of nodes with `joined` / `left` / `stats` notifications.
 * `MockNode`s get a matching `NodeInfo` built by `addMockNode`.
 */
export class MockRegistry implements NodeRegistry {
  readonly #nodes = new Map<string, { info: NodeInfo; node: ExecutionNode }>();
  readonly #listeners = new Set<(e: MockRegistryEvent) => void>();

  constructor(entries: Array<{ info: NodeInfo; node: ExecutionNode }> = []) {
    for (const entry of entries) this.#nodes.set(entry.node.id, entry);
  }

  add(node: ExecutionNode, info?: NodeInfo): NodeInfo {
    const resolved = info ?? makeNodeInfo({ id: node.id, name: node.id });
    this.#nodes.set(node.id, { info: resolved, node });
    this.#notify({ type: 'joined', node: resolved });
    return resolved;
  }

  addMockNode(node: MockNode, overrides: Partial<NodeInfo> = {}): NodeInfo {
    return this.add(node, makeNodeInfo({ id: node.id, kind: 'remote', name: node.id, ...overrides }));
  }

  remove(id: string, reason = 'left the flock'): void {
    const entry = this.#nodes.get(id);
    if (entry === undefined) return;
    this.#nodes.delete(id);
    this.#notify({ type: 'left', node: { ...entry.info, status: 'offline', activeSessions: 0 }, reason });
  }

  update(info: NodeInfo): void {
    const entry = this.#nodes.get(info.id);
    if (entry === undefined) {
      this.add(missingNode(info), info);
      return;
    }
    entry.info = info;
    this.#notify({ type: 'stats', node: info });
  }

  list(): NodeInfo[] {
    return [...this.#nodes.values()].map((entry) => ({ ...entry.info }));
  }

  get(id: string): ExecutionNode | undefined {
    return this.#nodes.get(id)?.node;
  }

  onChange(fn: (e: MockRegistryEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify(event: MockRegistryEvent): void {
    for (const fn of [...this.#listeners]) fn(event);
  }
}

function missingNode(info: NodeInfo): ExecutionNode {
  const unavailable = async (): Promise<never> => {
    throw new Error(`Node ${info.id} is not attached to this MockRegistry`);
  };
  return {
    id: info.id,
    info: unavailable,
    startTask: unavailable,
    sendPrompt: unavailable,
    abort: unavailable,
    collect: unavailable,
    cleanup: unavailable,
    onEvent: () => () => {},
  };
}
