import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodeInfo, StarlingConfig } from '@starling/core';
import { newId } from '@starling/core';
import { MockNode, MockRegistry, makeNodeInfo } from '@starling/core/testing';
import type { FlockHub, JoinInfo } from './handshake';

/**
 * A fully in-memory `FlockHub` for Wave 1: the hub plus a MacBook Air perch, a deterministic join
 * code, and a fake bundle path. No mDNS, no HTTP, no sockets — `starling flock` and `starling perch`
 * are runnable before the flock package exists.
 */
export function createMockFlockHub(config: StarlingConfig, options: { now?: () => number } = {}): FlockHub {
  const now = options.now ?? (() => Date.now());
  const hubNode = new MockNode({
    id: 'hub',
    info: {
      name: 'MacBook Pro',
      kind: 'local',
      platform: process.platform,
      arch: process.arch,
      cpuCores: 12,
      memGb: 32,
      maxSessions: config.flock.hubMaxSessions,
      localModels: ['qwen3.6:35b-a3b'],
      latencyMs: 1,
    },
  });
  const airNode = new MockNode({
    id: 'm2-air',
    info: {
      name: 'MacBook Air',
      kind: 'remote',
      url: 'http://192.168.1.42:7778',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 8,
      memGb: 16,
      maxSessions: 5,
      localModels: [],
      latencyMs: 18,
    },
  });

  const hubInfo = makeNodeInfo({
    ...hubNode.infoSnapshot(),
    lastSeen: now(),
  });
  const airInfo = makeNodeInfo({
    ...airNode.infoSnapshot(),
    status: config.flock.enabled ? 'online' : 'offline',
    lastSeen: now(),
  });
  const registry = new MockRegistry([
    { info: hubInfo, node: hubNode },
    ...(config.flock.enabled ? [{ info: airInfo, node: airNode }] : []),
  ]);

  const hubUrl = `http://localhost:${config.server.port}`;
  const code = 'STAR-LING';
  const joinInfo: JoinInfo = {
    code,
    hubUrl,
    command: `starling perch --hub ${hubUrl} --code ${code}`,
  };

  return {
    registry,
    joinInfo: () => joinInfo,
    verifyToken: (token) => token === code,
    async register(input) {
      const nodeId = input.info.id.length > 0 ? input.info.id : newId();
      const node = new MockNode({ id: nodeId, info: { ...input.info, kind: 'remote', url: input.url } });
      registry.add(node, { ...input.info, id: nodeId, kind: 'remote', url: input.url, lastSeen: now() });
      return { nodeId };
    },
    heartbeat(input) {
      const existing = registry.list().find((node) => node.id === input.nodeId);
      const info: NodeInfo = {
        ...input.info,
        id: input.nodeId,
        lastSeen: now(),
        kind: existing?.kind ?? input.info.kind,
      };
      registry.update(info);
    },
    async bundle(ref) {
      const safe = ref.replace(/[^\w.-]+/g, '-');
      return { path: join(tmpdir(), 'starling-mock', `${safe}.bundle`) };
    },
    setActiveRepo() {
      // The mock never fetches; the active repo only matters to the real bundle route.
    },
    async close() {
      // Nothing is listening.
    },
  };
}
