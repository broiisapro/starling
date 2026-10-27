/**
 * recommend.test.ts — the picking rules. The output of this file is what a `starling.config.yaml`
 * ends up containing, so each rule gets its own test: accuracy first, latency second, RAM a hard
 * gate, and no recommendation at all rather than a bad one.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelBenchResult } from './bench-core';
import {
  formatRecommendation,
  PROFILE_BUDGET_GB,
  pickForProfile,
  readBenchResults,
  recommendModels,
  writeRecommendation,
} from './recommend';
import { isToolError } from './tool-error';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function result(
  model: string,
  accuracy: number,
  latencyMs: number,
  residentGb: number | null,
  status: 'ok' | 'aborted' = 'ok',
): ModelBenchResult {
  const correct = Math.round(accuracy * 12);
  return {
    model,
    profile: 'mbp',
    status,
    ...(status === 'aborted' ? { abortReason: 'out of memory on case-3' } : {}),
    startedAt: 1,
    finishedAt: 2,
    correct,
    total: 12,
    accuracy,
    jsonValidRate: 1,
    ttftMsMean: latencyMs * 0.2,
    latencyMsMean: latencyMs,
    tokensPerSecMean: 20,
    transports: { v1: 12, native: 0, none: 0 },
    cases: [],
    attempts: [],
    residentGb,
    freeRamBeforeGb: 20,
    freeRamAfterGb: 12,
    alreadyResident: false,
    unloaded: true,
  };
}

// 12 cases, so accuracy steps by 1/12 ≈ 0.08.
const SMART = result('smart:27b', 1, 5200, 18);
const QUICK = result('quick:9b', 0.83, 900, 7.5);
const LAZY = result('lazy:4b', 0.5, 300, 3);

describe('pickForProfile', () => {
  test('takes the most accurate model that fits the RAM budget', () => {
    expect(pickForProfile([SMART, QUICK, LAZY], 24)).toEqual({
      auditor: 'smart:27b',
      summarizer: 'quick:9b',
    });
  });

  test('excludes a model over the budget even when it is the most accurate', () => {
    const huge = result('huge:35b', 1, 4000, 26);
    expect(pickForProfile([huge, QUICK], 24).auditor).toBe('quick:9b');
  });

  test('excludes an unmeasured (null resident) or aborted model: the budget must be a measurement', () => {
    const unmeasured = result('unknown:20b', 1, 4000, null);
    const aborted = result('oom:20b', 1, 4000, 14, 'aborted');
    expect(pickForProfile([unmeasured, aborted, QUICK], 24).auditor).toBe('quick:9b');
  });

  test('breaks a tie on accuracy with the lower mean latency', () => {
    const slow = result('slow:9b', 0.83, 2500, 7);
    const fast = result('fast:9b', 0.83, 1100, 7.5);
    expect(pickForProfile([slow, fast], 24).auditor).toBe('fast:9b');
  });

  test('picks the fastest summariser that still clears the accuracy floor', () => {
    expect(pickForProfile([SMART, QUICK, LAZY], 24, 0.8).summarizer).toBe('quick:9b');
  });

  test('falls back to the auditor when nothing else clears the floor', () => {
    expect(pickForProfile([SMART, LAZY], 24).summarizer).toBe('smart:27b');
  });

  test('refuses to invent a pick when no model fits', () => {
    try {
      pickForProfile([SMART], 4);
      throw new Error('should have thrown');
    } catch (err) {
      expect(isToolError(err, 'NO_ELIGIBLE_MODEL')).toBe(true);
    }
  });
});

describe('recommendModels', () => {
  test('returns both profiles with the exact documented shape', () => {
    const rec = recommendModels([SMART, QUICK, LAZY]);
    expect(rec).toEqual({
      mbp: { auditor: 'smart:27b', summarizer: 'quick:9b' },
      air: { auditor: 'quick:9b', summarizer: 'quick:9b' },
    });
    expect(Object.keys(rec.mbp).sort()).toEqual(['auditor', 'summarizer']);
  });

  test('the air budget really is stricter than the mbp one', () => {
    expect(PROFILE_BUDGET_GB.air).toBeLessThan(PROFILE_BUDGET_GB.mbp);
    const mbpOnly = result('big:27b', 1, 1000, 18);
    expect(recommendModels([mbpOnly, QUICK]).air.auditor).toBe('quick:9b');
  });

  test('formatRecommendation shows the numbers behind each pick', () => {
    const lines = formatRecommendation(recommendModels([SMART, QUICK, LAZY]), [SMART, QUICK, LAZY]);
    expect(lines[0]).toContain('| profile | role | model |');
    expect(lines.join('\n')).toContain('| mbp | auditor | smart:27b | 100% | 5200 ms | 18 GB |');
  });
});

describe('result files', () => {
  function benchFile(models: ModelBenchResult[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'starling-bench-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'bench-host-2026-10-27.json'), JSON.stringify({ kind: 'x', models }));
    return dir;
  }

  test('readBenchResults returns the newest result per model across files', () => {
    const dir = benchFile([result('old:9b', 0.5, 900, 7)]);
    writeFileSync(
      join(dir, 'bench-host-2026-10-28.json'),
      JSON.stringify({ models: [result('old:9b', 0.9, 800, 7), QUICK] }),
    );

    const merged = readBenchResults(dir);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.model === 'old:9b')?.accuracy).toBe(0.9);
  });

  test('readBenchResults complains instead of recommending from nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starling-empty-'));
    dirs.push(dir);
    expect(() => readBenchResults(dir)).toThrow(/no bench results/);
    expect(() => readBenchResults('/definitely/not/here')).toThrow(/cannot read/);
  });

  test('writeRecommendation writes only {auditor, summarizer} per profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starling-rec-'));
    dirs.push(dir);
    const out = join(dir, 'recommendation.json');
    writeRecommendation(out, recommendModels([SMART, QUICK, LAZY]));

    const written = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(written).toEqual({
      mbp: { auditor: 'smart:27b', summarizer: 'quick:9b' },
      air: { auditor: 'quick:9b', summarizer: 'quick:9b' },
    });
  });
});
