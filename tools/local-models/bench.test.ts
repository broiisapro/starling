/**
 * bench.test.ts — end to end through the real HTTP client and a fake Ollama, which is exactly what
 * `--dry-run` does. Proves the loop measures, scores, aborts on OOM and unloads between models.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { runBench } from './bench-run';
import { loadCases } from './cases';
import { type FakeOllama, fakeModelSpec, startFakeOllama } from './fake-ollama';
import { fakeProbes } from './probes';

const HERE = dirname(new URL(import.meta.url).pathname);
const CASES = loadCases(join(HERE, 'cases'));

let servers: FakeOllama[] = [];

afterEach(() => {
  for (const s of servers) s.stop();
  servers = [];
});

interface Harness {
  results: Awaited<ReturnType<typeof runBench>>;
  fake: FakeOllama;
}

async function bench(models: string[], repeat = 1, freeRamGb = 12): Promise<Harness> {
  const fake = startFakeOllama({ cases: CASES, models: models.map(fakeModelSpec) });
  servers.push(fake);
  const results = await runBench(
    {
      host: fake.url,
      profile: 'mbp',
      models,
      cases: CASES,
      repeat,
      maxTokens: 400,
      keepAlive: '5m',
      think: false,
    },
    { probes: fakeProbes({ freeRamGb, openCodeProcesses: 0 }), now: () => Date.now() },
  );
  return { results, fake };
}

describe('runBench against the fake daemon', () => {
  test('the smart model gets all twelve cases right and is measured honestly', async () => {
    const { results } = await bench(['fake-smart']);
    const smart = results[0];

    expect(smart?.status).toBe('ok');
    expect(smart?.correct).toBe(12);
    expect(smart?.total).toBe(12);
    expect(smart?.accuracy).toBe(1);
    expect(smart?.jsonValidRate).toBe(1);
    expect(smart?.transports.v1).toBe(12);
    expect(smart?.residentGb).toBe(7.5);
    expect(smart?.freeRamBeforeGb).toBe(12);
    expect(smart?.freeRamAfterGb).toBe(12);
    expect(smart?.unloaded).toBe(true);
    expect(smart?.alreadyResident).toBe(false);
    expect(smart?.ttftMsMean).not.toBeNull();
    expect(smart?.tokensPerSecMean).toBeGreaterThan(0);
  });

  test('the lazy model passes everything, so it is wrong on exactly the six must-fail cases', async () => {
    const { results } = await bench(['fake-lazy']);
    const lazy = results[0];

    expect(lazy?.correct).toBe(6);
    expect(lazy?.accuracy).toBe(0.5);
    expect(lazy?.jsonValidRate).toBe(1);
    const missed = lazy?.cases.filter((c) => !c.correct).map((c) => c.key) ?? [];
    expect(missed).toHaveLength(6);
    expect(missed).toContain('csv-export-no-tests');
    expect(missed).not.toContain('csv-export-with-tests');
  });

  test('--repeat asks every case again and averages, without changing the score', async () => {
    const { results } = await bench(['fake-smart'], 2);
    const smart = results[0];

    expect(smart?.attempts).toHaveLength(24);
    expect(smart?.correct).toBe(12);
    expect(smart?.accuracy).toBe(1);
    for (const outcome of smart?.cases ?? []) expect(outcome.attempts).toBe(2);
  });

  test('a model that only emits prose scores zero and flags invalid JSON', async () => {
    const { results } = await bench(['fake-garbage']);
    const garbage = results[0];

    expect(garbage?.accuracy).toBe(0);
    expect(garbage?.jsonValidRate).toBe(0);
    expect(garbage?.attempts[0]?.judgement.jsonValid).toBe(false);
  });

  test('an OOM aborts the model on the first failure instead of grinding through the corpus', async () => {
    const { results } = await bench(['fake-oom']);
    const oom = results[0];

    expect(oom?.status).toBe('aborted');
    expect(oom?.abortReason).toContain('out of memory');
    expect(oom?.attempts).toHaveLength(1);
    expect(oom?.correct).toBe(0);
    expect(oom?.total).toBe(12);
    expect(oom?.cases.filter((c) => c.attempts === 0)).toHaveLength(11);
    expect(oom?.unloaded).toBe(true);
  });

  test('an unreachable daemon aborts immediately with a clear reason', async () => {
    const results = await runBench(
      {
        host: 'http://127.0.0.1:1',
        profile: 'air',
        models: ['none:1b'],
        cases: CASES,
        repeat: 1,
        maxTokens: 100,
        keepAlive: '5m',
        think: false,
        callV1: async () => ({
          text: '',
          status: 0,
          error: 'request failed: Error: connection refused',
          timing: {
            ttftMs: null,
            totalMs: 1,
            completionTokens: null,
            tokensPerSec: null,
            tokensPerSecSource: null,
            loadDurationMs: null,
          },
        }),
      },
      { probes: fakeProbes(), now: () => Date.now() },
    );

    expect(results[0]?.status).toBe('aborted');
    expect(results[0]?.abortReason).toContain('not answering');
    expect(results[0]?.attempts).toHaveLength(0);
  });

  test('each model is unloaded before the next one loads', async () => {
    const { results, fake } = await bench(['fake-smart', 'fake-lazy']);

    expect(results.map((r) => r.model)).toEqual(['fake-smart', 'fake-lazy']);
    const unloads = fake.requests.filter((r) => r.path === '/api/generate' && r.body.keep_alive === 0);
    expect(unloads).toHaveLength(2);
    expect(fake.resident()).toEqual([]);
  });
});
