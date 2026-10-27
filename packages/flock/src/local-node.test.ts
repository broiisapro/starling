import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRunner, StartTaskOptions } from '@starling/core';
import { FakeClock, StarlingError } from '@starling/core';
import { immediateScheduler, MockRunner, MockWorkspace } from '@starling/core/testing';
import type { BundleOps } from './bundle-ops';
import { FLOCK_TOKEN_HEADER } from './http.ts';
import { createLocalNode } from './local-node.ts';

const runId = 'run-01';
const taskKey = 'csv-export';

function taskOpts(overrides: Partial<StartTaskOptions> = {}): StartTaskOptions {
  return {
    runId,
    taskKey,
    title: 'CSV export',
    repo: { kind: 'local', path: '/repo/sky-todo' },
    fromRef: 'main',
    branch: `starling/${runId}/${taskKey}`,
    prompt: 'do the thing',
    model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    ...overrides,
  };
}

function fakeBundleOps(): BundleOps & {
  cloned: Array<{ bundlePath: string; dir: string; ref: string }>;
  fetched: Array<{ repo: string; bundlePath: string; ref: string; intoBranch: string }>;
  created: Array<{ repo: string; ref: string; base?: string; outPath?: string }>;
} {
  const cloned: Array<{ bundlePath: string; dir: string; ref: string }> = [];
  const fetched: Array<{ repo: string; bundlePath: string; ref: string; intoBranch: string }> = [];
  const created: Array<{ repo: string; ref: string; base?: string; outPath?: string }> = [];
  return {
    cloned,
    fetched,
    created,
    async createBundle(repo, ref, opts) {
      created.push({ repo, ref, base: opts?.base, outPath: opts?.outPath });
      return opts?.outPath ?? join(tmpdir(), 'result.bundle');
    },
    async cloneFromBundle(bundlePath, dir, ref) {
      cloned.push({ bundlePath, dir, ref });
      await Bun.write(join(dir, '.git', 'keep'), '');
    },
    async fetchBundle(repo, bundlePath, ref, intoBranch) {
      fetched.push({ repo, bundlePath, ref, intoBranch });
    },
  };
}

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-flock-local-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function worktreePath(branch: string): string {
  return `/mock/worktrees/${branch.replace(/\//g, '-')}`;
}

describe('LocalNode', () => {
  test('reports OS capacity and its own identity', async () => {
    const clock = new FakeClock(5_000);
    const node = createLocalNode({
      name: 'Moksh’s MacBook Pro',
      workspace: new MockWorkspace(),
      runner: new MockRunner({ clock }),
      maxSessions: 8,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
      infoProvider: () => ({ localModels: ['qwen3.8:27b-mlx'] }),
    });

    const info = await node.info();
    expect(info.id).toBe('hub');
    expect(info.kind).toBe('local');
    expect(info.name).toBe('Moksh’s MacBook Pro');
    expect(info.maxSessions).toBe(8);
    expect(info.activeSessions).toBe(0);
    expect(info.status).toBe('online');
    expect(info.localModels).toEqual(['qwen3.8:27b-mlx']);
    expect(info.lastSeen).toBe(5_000);
    expect(info.cpuCores).toBeGreaterThan(0);
  });

  test('runs a local task through start, events, collect and cleanup', async () => {
    const clock = new FakeClock(1_000);
    const workspace = new MockWorkspace({ 'src/main.ts': 'export const x = 1;\n' });
    const runner = new MockRunner({ clock });
    const node = createLocalNode({
      name: 'hub',
      workspace,
      runner,
      maxSessions: 2,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
    });
    const events: string[] = [];
    node.onEvent((event) => events.push(event.kind));

    const handle = await node.startTask(taskOpts());
    await runner.flush();

    expect(handle.nodeId).toBe('hub');
    expect(handle.branch).toBe(`starling/${runId}/${taskKey}`);
    expect(handle.sessionId).not.toBe('');
    expect((await node.info()).activeSessions).toBe(1);
    expect((await node.info()).status).toBe('busy');
    expect(events).toContain('session.started');
    expect(events).toContain('session.idle');

    const path = worktreePath(handle.branch);
    workspace.writeFile(path, 'src/export.ts', 'export const rows = [];\n');
    const result = await node.collect(handle, '/repo/sky-todo', 'main');

    expect(result.commit).toBe('mock-commit-1');
    expect(result.changedFiles).toEqual(['src/export.ts']);
    expect(result.diff.files.map((file) => file.path)).toEqual(['src/export.ts']);
    expect(result.bundlePath).toBeUndefined();

    await node.cleanup(handle);
    expect(workspace.removed).toEqual([path]);
    expect((await node.info()).activeSessions).toBe(0);
    expect((await node.info()).status).toBe('online');
  });

  test('forwards only the sessions this node started from a shared runner', async () => {
    const clock = new FakeClock(0);
    const runner = new MockRunner({ clock });
    const workspace = new MockWorkspace();
    const hub = createLocalNode({ name: 'hub', workspace, runner, maxSessions: 2, worktreeRoot: '/tmp/a' });
    const air = createLocalNode({
      id: 'air',
      name: 'M2 Air',
      workspace,
      runner,
      maxSessions: 2,
      worktreeRoot: '/tmp/b',
    });
    const hubSessions = new Set<string>();
    const airSessions = new Set<string>();
    hub.onEvent((event) => hubSessions.add(event.sessionId));
    air.onEvent((event) => airSessions.add(event.sessionId));

    const hubHandle = await hub.startTask(taskOpts({ taskKey: 'theme' }));
    const airHandle = await air.startTask(taskOpts({ taskKey: 'chart' }));
    await runner.flush();

    expect([...hubSessions]).toEqual([hubHandle.sessionId]);
    expect([...airSessions]).toEqual([airHandle.sessionId]);
  });

  test('downloads a bundle with the flock token, clones it and returns a result bundle', async () => {
    const worktreeRoot = await tempDir();
    const fetchCalls: Array<{ url: string; token: string | null }> = [];
    const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      fetchCalls.push({ url: String(input), token: headers.get(FLOCK_TOKEN_HEADER) });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as typeof fetch;

    const clock = new FakeClock(2_000);
    const bundleOps = fakeBundleOps();
    const workspace = Object.assign(new MockWorkspace({ 'src/main.ts': 'main\n' }), bundleOps);
    const runner = new MockRunner({ clock });
    const node = createLocalNode({
      name: 'M2 Air',
      workspace,
      runner,
      maxSessions: 1,
      worktreeRoot,
      clock,
      fetch: fetchFake,
    });
    await workspace.ensureIntegrationBranch('/repo', 'main', 'starling/run/integration');

    const opts = taskOpts({
      repo: { kind: 'bundle', url: 'http://hub.test/api/flock/bundle?ref=integration', token: 'K7QM-3XPH' },
      fromRef: 'starling/run/integration',
      branch: 'starling/run/csv-export',
    });
    const handle = await node.startTask(opts);
    await runner.flush();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.token).toBe('K7QM-3XPH');
    expect(bundleOps.cloned).toHaveLength(1);
    expect(bundleOps.cloned[0]?.ref).toBe('starling/run/integration');
    expect(bundleOps.cloned[0]?.dir).toBe(join(worktreeRoot, '_repos', 'run-01'));
    const incoming = await readdir(join(worktreeRoot, '_bundles'));
    expect(incoming.some((name) => name.endsWith('.bundle'))).toBe(true);

    const path = worktreePath(handle.branch);
    workspace.writeFile(path, 'src/export.ts', 'rows\n');
    const result = await node.collect(handle, '/hub/repo', 'starling/run/integration');

    expect(bundleOps.created).toHaveLength(1);
    expect(bundleOps.created[0]).toMatchObject({
      repo: join(worktreeRoot, '_repos', 'run-01'),
      ref: 'starling/run/csv-export',
      base: 'starling/run/integration',
    });
    expect(result.bundlePath).toContain('_bundles');
    expect(result.bundlePath).toContain('result.bundle');
  });

  test('reuses the run cache repo by fetching a newer bundle for the next task', async () => {
    const worktreeRoot = await tempDir();
    const fetchFake = (async () =>
      new Response(new Uint8Array([9]), { status: 200 })) as unknown as typeof fetch;
    const bundleOps = fakeBundleOps();
    const workspace = Object.assign(new MockWorkspace({ 'src/main.ts': 'main\n' }), bundleOps);
    const runner = new MockRunner({ clock: new FakeClock(0) });
    const node = createLocalNode({
      name: 'M2 Air',
      workspace,
      runner,
      maxSessions: 2,
      worktreeRoot,
      fetch: fetchFake,
    });
    const repo = {
      kind: 'bundle' as const,
      url: 'http://hub.test/api/flock/bundle?ref=integration',
      token: 'CODE',
    };
    await workspace.ensureIntegrationBranch('/repo', 'main', 'starling/run/integration');

    const fromRef = 'starling/run/integration';
    await node.startTask(taskOpts({ taskKey: 'one', repo, fromRef, branch: 'starling/run/one' }));
    await node.startTask(taskOpts({ taskKey: 'two', repo, fromRef, branch: 'starling/run/two' }));
    await runner.flush();

    expect(bundleOps.cloned).toHaveLength(1);
    expect(bundleOps.fetched).toHaveLength(1);
    expect(bundleOps.fetched[0]).toMatchObject({
      repo: join(worktreeRoot, '_repos', 'run-01'),
      ref: 'starling/run/integration',
      intoBranch: 'starling/run/integration',
    });
  });

  test('refuses to oversubscribe and refuses bundle tasks without bundle ops', async () => {
    const clock = new FakeClock(0);
    const node = createLocalNode({
      name: 'hub',
      workspace: new MockWorkspace(),
      runner: new MockRunner({ clock }),
      maxSessions: 1,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
    });
    await node.startTask(taskOpts());

    const capacityError = await node.startTask(taskOpts({ taskKey: 'second' })).catch((err: unknown) => err);
    expect(capacityError).toBeInstanceOf(StarlingError);
    expect((capacityError as StarlingError).code).toBe('INVALID_ARGUMENT');
    expect((capacityError as StarlingError).message).toContain('at capacity');

    const bare = createLocalNode({
      name: 'air',
      workspace: new MockWorkspace(),
      runner: new MockRunner({ clock }),
      maxSessions: 1,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
    });
    const bundleError = await bare
      .startTask(
        taskOpts({
          repo: { kind: 'bundle', url: 'http://hub.test/bundle', token: 'CODE' },
        }),
      )
      .catch((err: unknown) => err);
    expect((bundleError as StarlingError).code).toBe('INVALID_ARGUMENT');
    expect((bundleError as StarlingError).message).toContain('BundleOps');
  });

  test('abort reaches the runner and sendPrompt targets the right session', async () => {
    const clock = new FakeClock(0);
    const runner = new MockRunner({ clock });
    const node = createLocalNode({
      name: 'hub',
      workspace: new MockWorkspace(),
      runner,
      maxSessions: 2,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
    });
    const kinds: string[] = [];
    node.onEvent((event) => kinds.push(event.kind));
    const handle = await node.startTask(taskOpts());
    await runner.flush();

    await node.sendPrompt(handle, 'try again');
    expect(runner.sentPrompts[0]?.sessionId).toBe(handle.sessionId);
    await runner.flush();

    await node.abort(handle);
    expect(kinds).toContain('session.error');
    expect(runner.sessions.get(handle.sessionId)?.aborted).toBe(true);
  });

  test('a runner failure removes the half-built worktree and frees the slot', async () => {
    const clock = new FakeClock(0);
    const workspace = new MockWorkspace();
    const brokenRunner: AgentRunner = {
      async start() {
        throw new StarlingError('RUNNER_ERROR', 'opencode would not start');
      },
      async send() {},
      async abort() {},
      onEvent: () => () => {},
      async close() {},
    };
    const node = createLocalNode({
      name: 'hub',
      workspace,
      runner: brokenRunner,
      maxSessions: 1,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
    });

    await expect(node.startTask(taskOpts())).rejects.toThrow('opencode would not start');
    expect(workspace.removed).toEqual([worktreePath(`starling/${runId}/${taskKey}`)]);
    expect((await node.info()).activeSessions).toBe(0);
  });

  test('two concurrent startTask calls cannot oversubscribe the node', async () => {
    const node = createLocalNode({
      name: 'hub',
      workspace: new MockWorkspace(),
      runner: new MockRunner(),
      maxSessions: 1,
      worktreeRoot: '/tmp/flock-worktrees',
    });

    const [first, second] = await Promise.allSettled([
      node.startTask(taskOpts({ taskKey: 'one', branch: 'starling/run/one' })),
      node.startTask(taskOpts({ taskKey: 'two', branch: 'starling/run/two' })),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await node.info()).activeSessions).toBe(1);
  });

  test('forwards session.started even when the runner emits it before start() resolves', async () => {
    const clock = new FakeClock(0);
    const runner = new MockRunner({ clock, schedule: immediateScheduler });
    const node = createLocalNode({
      name: 'hub',
      workspace: new MockWorkspace(),
      runner,
      maxSessions: 1,
      worktreeRoot: '/tmp/flock-worktrees',
      clock,
    });
    const kinds: string[] = [];
    node.onEvent((event) => kinds.push(event.kind));

    await node.startTask(taskOpts());
    expect(kinds).toEqual([
      'session.started',
      'text',
      'tool.call',
      'tool.result',
      'file.edited',
      'usage',
      'session.idle',
    ]);
  });

  test('unknown handles are rejected for collect and ignored by cleanup', async () => {
    const node = createLocalNode({
      name: 'hub',
      workspace: new MockWorkspace(),
      runner: new MockRunner(),
      maxSessions: 1,
      worktreeRoot: '/tmp/flock-worktrees',
    });
    const unknown = {
      nodeId: 'hub',
      runId: 'nope',
      taskKey: 'nope',
      branch: 'starling/nope/nope',
      sessionId: 'ses-nope',
    };

    await expect(node.collect(unknown, '/repo', 'main')).rejects.toThrow('no task');
    await node.cleanup(unknown);
  });
});
