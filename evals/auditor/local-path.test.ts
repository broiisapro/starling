import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  chooseAuditorModel,
  localAuditorModel,
  RECOMMENDATION_PATH,
} from '../../packages/auditor/src/model-choice.ts';
import type { ModelBenchResult } from '../../tools/local-models/bench-core.ts';
import {
  readBenchResults,
  recommendModels,
  writeRecommendation,
} from '../../tools/local-models/recommend.ts';
import { defaultConfig } from '../lib/core';

/**
 * Epic 72 will run the real local-model bench, write `bench-*.json`, then `recommend.ts` writes
 * `recommendation.json`, and `model-choice.ts` reads it. Epic 44 may not load a model (L31), so this
 * test proves that whole chain offline against bench-shaped fixtures: pick → decision file → the
 * model the auditor would actually use on each laptop.
 *
 * The numbers mirror what Epic 28's dry run and smoke test produced; they are fixtures, not
 * measurements.
 */

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-local-path-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function benchResult(overrides: Partial<ModelBenchResult>): ModelBenchResult {
  return {
    model: 'qwen3.8:27b-mlx',
    profile: 'mbp',
    status: 'ok',
    startedAt: 0,
    finishedAt: 1,
    correct: 12,
    total: 12,
    accuracy: 1,
    jsonValidRate: 1,
    ttftMsMean: 460,
    latencyMsMean: 5_828,
    tokensPerSecMean: 18.29,
    transports: { v1: 12, native: 0, none: 0 },
    cases: [],
    attempts: [],
    residentGb: 18,
    freeRamBeforeGb: 12,
    freeRamAfterGb: 9,
    alreadyResident: false,
    unloaded: true,
    ...overrides,
  };
}

function writeBenchFile(dir: string, name: string, models: ModelBenchResult[]): void {
  writeFileSync(join(dir, name), `${JSON.stringify({ kind: 'starling.local-model.bench', models })}\n`);
}

describe('local-model path: bench results → recommendation → auditor model choice', () => {
  test('the most accurate model inside each RAM budget becomes that laptop auditor', () => {
    const resultsDir = tempDir();
    writeBenchFile(resultsDir, 'bench-mbp-2026-10-27.json', [
      benchResult({ model: 'qwen3.8:27b-mlx', accuracy: 1, latencyMsMean: 5_828, residentGb: 18 }),
      benchResult({ model: 'qwen3.6:35b-a3b', accuracy: 0.92, latencyMsMean: 2_100, residentGb: 23 }),
    ]);
    writeBenchFile(resultsDir, 'bench-air-2026-10-27.json', [
      benchResult({ model: 'qwen3.5:9b', profile: 'air', accuracy: 0.92, residentGb: 6.6 }),
      benchResult({ model: 'gemma4:12b-it-qat', profile: 'air', accuracy: 0.9, residentGb: 7.2 }),
    ]);

    const results = readBenchResults(resultsDir);
    const rec = recommendModels(results);
    expect(rec.mbp.auditor).toBe('qwen3.8:27b-mlx');
    expect(rec.air.auditor).toBe('qwen3.5:9b');

    writeRecommendation(join(resultsDir, 'recommendation.json'), rec);
    expect(readBenchResults(resultsDir)).toHaveLength(4);
  });

  test('a model too big for the profile is never recommended, however accurate', () => {
    const resultsDir = tempDir();
    writeBenchFile(resultsDir, 'bench-mbp-2026-10-27.json', [
      benchResult({ model: 'qwen3.6:35b-a3b', accuracy: 1, residentGb: 30 }),
      benchResult({ model: 'qwen3.8:27b-mlx', accuracy: 0.92, residentGb: 18 }),
      benchResult({ model: 'qwen3.5:9b', accuracy: 0.9, residentGb: 6.6 }),
    ]);
    // `recommendModels` always answers for both laptops, so the Air needs an eligible model too.
    expect(recommendModels(readBenchResults(resultsDir)).mbp.auditor).toBe('qwen3.8:27b-mlx');
  });

  test('model-choice reads the committed recommendation.json for this laptop profile', async () => {
    const repo = tempDir();
    const recPath = join(repo, RECOMMENDATION_PATH);
    mkdirSync(dirname(recPath), { recursive: true });
    writeFileSync(
      recPath,
      `${JSON.stringify({
        mbp: { auditor: 'qwen3.8:27b-mlx', summarizer: 'qwen3.5:9b' },
        air: { auditor: 'qwen3.5:9b', summarizer: 'qwen3.5:4b' },
      })}\n`,
    );

    expect(localAuditorModel({ env: {}, cwd: repo, ramGb: 32 })).toBe('qwen3.8:27b-mlx');

    const choice = await chooseAuditorModel({ profile: 'local', env: {}, cwd: repo, ramGb: 32 });
    expect(choice.model).toEqual({ provider: 'ollama', model: 'qwen3.8:27b-mlx' });
    expect(choice.config.models.auditor).toEqual({ provider: 'ollama', model: 'qwen3.8:27b-mlx' });
    expect(choice.local).toBe(true);
  });

  test('the demo default (mixed) uses the recommendation when Ollama has it, else falls back', async () => {
    const repo = tempDir();
    const recPath = join(repo, RECOMMENDATION_PATH);
    mkdirSync(dirname(recPath), { recursive: true });
    writeFileSync(
      recPath,
      `${JSON.stringify({ mbp: { auditor: 'qwen3.8:27b-mlx' }, air: { auditor: 'qwen3.5:9b' } })}\n`,
    );

    const local = await chooseAuditorModel({ env: {}, cwd: repo, ramGb: 32, probe: async () => true });
    expect(local.model.model).toBe('qwen3.8:27b-mlx');
    expect(local.config.models.worker.provider).toBe('deepseek');

    const fallback = await chooseAuditorModel({ env: {}, cwd: repo, ramGb: 32, probe: async () => false });
    expect(fallback.model.provider).toBe('opencode');
    expect(fallback.warning).toContain('not reachable or not pulled');
  });

  test('an unreadable recommendation.json is a fallback, not a crash', async () => {
    const repo = tempDir();
    const recPath = join(repo, RECOMMENDATION_PATH);
    mkdirSync(dirname(recPath), { recursive: true });
    writeFileSync(recPath, '{ not json');
    const choice = await chooseAuditorModel({
      profile: 'local',
      env: {},
      cwd: repo,
      ramGb: 32,
      config: defaultConfig,
    });
    expect(choice.model.provider).toBe('ollama');
    expect(choice.model.model).toBe('qwen3.8:27b-mlx');
    expect(choice.local).toBe(true);
  });
});
