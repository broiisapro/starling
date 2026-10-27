import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_DEFAULT_MODEL } from './profiles.ts';
import {
  chooseLocalModel,
  defaultMemGb,
  hostProfile,
  MBP_MIN_RAM_GB,
  parseRecommendation,
  RECOMMENDATION_RELATIVE_PATH,
  readRecommendation,
} from './profiles-recommend.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-recommend-'));
  dirs.push(dir);
  return dir;
}

function writeRecommendation(dir: string, value: unknown): string {
  const path = join(dir, 'recommendation.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  return path;
}

const RECOMMENDATION = {
  mbp: { auditor: 'qwen3.8:27b-mlx', summarizer: 'qwen3.8:4b-mlx' },
  air: { auditor: 'qwen3.8:4b-mlx', summarizer: 'qwen3.8:2b-mlx' },
};

describe('local model recommendation', () => {
  test('a real benchmark pick beats the built-in default', () => {
    const dir = tempDir();
    const path = writeRecommendation(dir, RECOMMENDATION);

    const mbp = chooseLocalModel({ recommendationPath: path, host: 'mbp', env: {} });
    expect(mbp).toMatchObject({
      model: 'qwen3.8:27b-mlx',
      smallModel: 'qwen3.8:4b-mlx',
      source: 'recommendation',
      host: 'mbp',
      warnings: [],
    });

    const air = chooseLocalModel({ recommendationPath: path, host: 'air', env: {} });
    expect(air.model).toBe('qwen3.8:4b-mlx');
    expect(air.smallModel).toBe('qwen3.8:2b-mlx');
  });

  test('a missing recommendation file falls back to the measured default with a note', () => {
    const choice = chooseLocalModel({
      recommendationPath: join(tempDir(), 'nope.json'),
      host: 'mbp',
      env: {},
    });
    expect(choice.source).toBe('default');
    expect(choice.model).toBe(LOCAL_DEFAULT_MODEL);
    expect(choice.smallModel).toBe(LOCAL_DEFAULT_MODEL);
    expect(choice.warnings[0]).toContain('no local benchmark recommendation');
  });

  test('malformed JSON and wrong shapes are warnings, never errors', () => {
    const broken = writeRecommendation(tempDir(), '{ not json');
    const fromBroken = chooseLocalModel({ recommendationPath: broken, env: {} });
    expect(fromBroken.model).toBe(LOCAL_DEFAULT_MODEL);
    expect(fromBroken.warnings[0]).toContain('not valid JSON');

    const wrong = writeRecommendation(tempDir(), { mbp: { auditor: 'x' } });
    const fromWrong = chooseLocalModel({ recommendationPath: wrong, env: {} });
    expect(fromWrong.model).toBe(LOCAL_DEFAULT_MODEL);
    expect(fromWrong.warnings[0]).toContain('no mbp/air picks');
  });

  test('STARLING_LOCAL_MODEL wins over the recommendation file', () => {
    const path = writeRecommendation(tempDir(), RECOMMENDATION);
    const choice = chooseLocalModel({
      recommendationPath: path,
      host: 'mbp',
      env: { STARLING_LOCAL_MODEL: '  qwen3.8:8b-mlx  ' },
    });
    expect(choice).toMatchObject({
      model: 'qwen3.8:8b-mlx',
      smallModel: 'qwen3.8:8b-mlx',
      source: 'env',
      warnings: [],
    });
  });

  test('skipRecommendation never touches the disk', () => {
    const choice = chooseLocalModel({
      recommendationPath: '/definitely/not/here.json',
      skipRecommendation: true,
    });
    expect(choice.source).toBe('default');
    expect(choice.model).toBe(LOCAL_DEFAULT_MODEL);
    expect(choice.warnings).toEqual([]);
  });

  test('a { profiles: … } wrapper is accepted for forward compatibility', () => {
    const path = writeRecommendation(tempDir(), { profiles: RECOMMENDATION });
    const choice = chooseLocalModel({ recommendationPath: path, host: 'air', env: {} });
    expect(choice.source).toBe('recommendation');
    expect(choice.model).toBe('qwen3.8:4b-mlx');
  });

  test('readRecommendation reports where it looked, and the default path is the bench output', () => {
    const read = readRecommendation({ cwd: tempDir() });
    expect(read.recommendation).toBeUndefined();
    expect(read.path.endsWith(RECOMMENDATION_RELATIVE_PATH)).toBe(true);
    expect(read.warning).toContain(RECOMMENDATION_RELATIVE_PATH);
  });

  test('parseRecommendation rejects junk without throwing', () => {
    expect(parseRecommendation(null)).toBeUndefined();
    expect(parseRecommendation({})).toBeUndefined();
    expect(parseRecommendation({ mbp: { auditor: '' } })).toBeUndefined();
    expect(parseRecommendation(RECOMMENDATION)).toEqual(RECOMMENDATION);
  });

  test('host profile: env wins, otherwise RAM decides', () => {
    expect(hostProfile({ env: { STARLING_LOCAL_PROFILE: 'air' }, memGb: 32 })).toBe('air');
    expect(hostProfile({ env: { STARLING_LOCAL_PROFILE: 'MBP' }, memGb: 16 })).toBe('mbp');
    expect(hostProfile({ env: { STARLING_LOCAL_PROFILE: 'nonsense' }, memGb: 32 })).toBe('mbp');
    expect(hostProfile({ env: {}, memGb: MBP_MIN_RAM_GB })).toBe('mbp');
    expect(hostProfile({ env: {}, memGb: MBP_MIN_RAM_GB - 1 })).toBe('air');
    expect(defaultMemGb()).toBeGreaterThan(0);
  });
});
