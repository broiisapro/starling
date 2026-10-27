import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../clock';
import type { AgentEvent } from '../contracts';
import { StarlingError } from '../errors';
import { MockNode } from './mock-node';
import { immediateScheduler } from './mock-runner';

const startOptions = {
  runId: 'run-1',
  taskKey: 'theme',
  title: 'Theme',
  repo: { kind: 'local' as const, path: '/repo' },
  fromRef: 'main',
  branch: 'starling/abc/theme',
  prompt: 'do it',
  model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
};

describe('MockNode', () => {
  test('startTask returns a handle and emits a scripted session', async () => {
    const node = new MockNode();
    const events: AgentEvent[] = [];
    node.onEvent((e) => events.push(e));
    const handle = await node.startTask(startOptions);
    await node.flush();
    expect(handle).toEqual({
      nodeId: 'hub',
      runId: 'run-1',
      taskKey: 'theme',
      branch: 'starling/abc/theme',
      sessionId: 'ses_node_1',
    });
    expect(node.startedTasks).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe('session.idle');
  });

  test('info reports busy while a task is active', async () => {
    const node = new MockNode({ id: 'air', info: { kind: 'remote', name: 'MacBook Air' } });
    expect((await node.info()).status).toBe('online');
    const handle = await node.startTask(startOptions);
    const info = await node.info();
    expect(info.status).toBe('busy');
    expect(info.activeSessions).toBe(1);
    await node.cleanup(handle);
    expect((await node.info()).status).toBe('online');
  });

  test('sendPrompt records a fixer prompt and emits pass 2', async () => {
    const node = new MockNode();
    const handle = await node.startTask(startOptions);
    await node.flush();
    const events: AgentEvent[] = [];
    node.onEvent((e) => events.push(e));
    await node.sendPrompt(handle, 'fix it');
    await node.flush();
    expect(node.prompts).toEqual([{ taskKey: 'theme', prompt: 'fix it' }]);
    expect(events.some((e) => String(e.data.text).includes('pass 2'))).toBe(true);
  });

  test('collect returns a commit, diff and changed files', async () => {
    const node = new MockNode({ result: { changedFiles: ['src/features/theme/index.ts'] } });
    const handle = await node.startTask(startOptions);
    const result = await node.collect(handle, '/hub', 'main');
    expect(result.commit).toBe('mock-node-commit-1');
    expect(result.changedFiles).toEqual(['src/features/theme/index.ts']);
    expect(result.diff.files[0]?.path).toBe('src/main.ts');
    expect(node.collected).toEqual([handle]);
  });

  test('simulateDeath stops events and rejects every later call', async () => {
    const clock = new FakeClock(1000);
    const node = new MockNode({ clock, schedule: immediateScheduler });
    const events: AgentEvent[] = [];
    node.onEvent((e) => events.push(e));
    const handle = await node.startTask(startOptions);
    const before = events.length;
    node.simulateDeath('lid closed');
    expect(node.dead).toBe(true);
    expect(node.infoSnapshot().status).toBe('offline');
    expect(events).toHaveLength(before);

    for (const call of [
      () => node.info(),
      () => node.startTask(startOptions),
      () => node.sendPrompt(handle, 'fix'),
      () => node.abort(handle),
      () => node.collect(handle, '/hub', 'main'),
      () => node.cleanup(handle),
    ]) {
      try {
        await call();
        throw new Error('expected NODE_OFFLINE');
      } catch (err) {
        expect(err).toBeInstanceOf(StarlingError);
        expect((err as StarlingError).code).toBe('NODE_OFFLINE');
      }
    }
  });

  test('unknown task handles fail loudly', async () => {
    const node = new MockNode();
    const handle = await node.startTask(startOptions);
    await node.cleanup(handle);
    await expect(node.sendPrompt(handle, 'again')).rejects.toThrow('no session');
  });
});
