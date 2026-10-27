import { describe, expect, test } from 'bun:test';
import type {
  AgentEvent,
  AuditVerdict,
  BundleOps,
  DiffSummary,
  DiscoveredPerch,
  FlockHub,
  LLM,
  MdnsAdvertiseOptions,
  MdnsAdvertiser,
  MdnsBrowser,
  MergePreflight,
  Merger,
  NodeInfo,
  NodeRegistry,
  NodeRegistryEvent,
  Plan,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
  TaskSpec,
} from './index';

/**
 * Type-level lock for the C1 port additions. These tests do not assert behaviour (the ports have no
 * implementation here); they fail to compile if a shape drifts, which is the whole point of moving
 * the handshake into core.
 */

const NODE: NodeInfo = {
  id: 'air',
  name: "Moksh's MacBook Air",
  kind: 'remote',
  url: 'http://air.local:7778',
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 8,
  memGb: 16,
  maxSessions: 5,
  activeSessions: 1,
  localModels: ['qwen3.6:35b-a3b'],
  status: 'online',
  lastSeen: 1,
};

describe('NodeRegistry.onChange carries a reason', () => {
  test('a left event can explain itself', () => {
    const timedOut: NodeRegistryEvent = { type: 'left', node: NODE, reason: 'heartbeat-timeout' };
    const joined: NodeRegistryEvent = { type: 'joined', node: NODE };
    expect(timedOut.reason).toBe('heartbeat-timeout');
    expect(joined.reason).toBeUndefined();
    const onChange: NodeRegistry['onChange'] = (fn) => {
      fn(timedOut);
      return () => undefined;
    };
    const seen: string[] = [];
    onChange((event) => seen.push(event.reason ?? event.type));
    expect(seen).toEqual(['heartbeat-timeout']);
  });
});

describe('Merger.preflight is optional but typed', () => {
  test('a merger without preflight is still a Merger', () => {
    const bare: Merger = {
      merge: async (): Promise<never> => {
        throw new Error('not used');
      },
    };
    expect(bare.preflight).toBeUndefined();
  });

  test('a preflight result has the four fields the engine reads', () => {
    const preflight: MergePreflight = {
      clean: false,
      conflictedFiles: ['src/app.ts'],
      alreadyMerged: false,
      detail: 'merge-tree found 1 conflict',
    };
    const merger: Merger = {
      merge: async () => {
        throw new Error('not used');
      },
      preflight: async () => preflight,
    };
    expect(merger.preflight).toBeDefined();
    expect(preflight.conflictedFiles).toEqual(['src/app.ts']);
  });
});

describe('BundleOps', () => {
  test('cloneFromBundle reports the path and branch it checked out', async () => {
    const ops = {
      createBundle: async (_repo: string, _ref: string) => '/tmp/x.bundle',
      cloneFromBundle: async (_bundle: string, dir: string, ref: string) => ({ path: dir, branch: ref }),
      fetchBundle: async () => undefined,
    } satisfies BundleOps;
    await expect(ops.cloneFromBundle('/tmp/x.bundle', '/tmp/clone', 'main')).resolves.toEqual({
      path: '/tmp/clone',
      branch: 'main',
    });
  });
});

describe('mDNS ports', () => {
  test('an advertiser may be synchronous and is safe to stop twice', async () => {
    const advertised: MdnsAdvertiseOptions[] = [];
    const advertiser: MdnsAdvertiser = {
      advertise(opts) {
        advertised.push(opts);
      },
      stop() {
        // idempotent by contract
      },
    };
    await advertiser.advertise({ name: 'hub', port: 7777, txt: { role: 'perch' } });
    advertiser.stop();
    advertiser.stop();
    expect(advertised[0]?.port).toBe(7777);
  });

  test('a browser hands back a stop function and typed perches', () => {
    const perch: DiscoveredPerch = {
      name: 'Moksh’s MacBook Air',
      host: '192.168.1.4',
      port: 7778,
      txt: { node: 'node-1' },
    };
    const browser: MdnsBrowser = {
      browse(onFound) {
        onFound(perch);
        return () => undefined;
      },
      close() {
        // no socket in tests
      },
    };
    const found: DiscoveredPerch[] = [];
    const stop = browser.browse((p) => found.push(p));
    stop();
    browser.close();
    expect(found).toHaveLength(1);
  });
});

describe('the port surface still composes', () => {
  test('an LLM can be passed where the engine expects one', async () => {
    const llm: LLM = {
      complete: async () => ({ text: '', usage: { input: 0, output: 0, cached: 0 }, model: { provider: 'p', model: 'm' }, costUsd: 0, local: true }),
      completeJson: async () => ({ text: '', usage: { input: 0, output: 0, cached: 0 }, model: { provider: 'p', model: 'm' }, costUsd: 0, local: true }),
    };
    expect((await llm.complete({ role: 'planner', system: 's', messages: [] })).text).toBe('');
  });

  test('the handshake types are reachable from the core index', () => {
    // Compile-time only: `import type` above proves each export exists. This keeps the test runnable.
    const samples: [
      Run?,
      Plan?,
      TaskRun?,
      TaskSpec?,
      StarlingEvent?,
      AgentEvent?,
      AuditVerdict?,
      RunMetrics?,
      DiffSummary?,
      FlockHub?,
    ] = [];
    expect(samples).toEqual([]);
  });
});
