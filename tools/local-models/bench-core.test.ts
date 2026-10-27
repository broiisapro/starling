/**
 * bench-core.test.ts — the maths that turns answers into a score, and the rails that decide whether
 * a run may start at all. Pure functions, no server, no model.
 */

import { describe, expect, test } from 'bun:test';
import {
  type AttemptRecord,
  caseOutcomes,
  checkRails,
  isMemoryFailure,
  isUnreachable,
  judgeAnswer,
  MAX_OPENCODE_PROCESSES,
  mean,
  summariseModel,
} from './bench-core';
import type { CallResult } from './ollama';

const PASS_EXPECT = { pass: true, mustMention: [] };
const FAIL_EXPECT = { pass: false, mustMention: ['test'] };

const verdict = (o: Record<string, unknown>): string => JSON.stringify(o);

const attempt = (caseKey: string, correct: boolean, repeat = 0): AttemptRecord => ({
  caseKey,
  repeat,
  transport: 'v1',
  expectedPass: correct,
  ttftMs: 100,
  latencyMs: 1000,
  completionTokens: 20,
  tokensPerSec: 20,
  judgement: {
    correct,
    passMatches: correct,
    jsonValid: true,
    missingMentions: [],
    verdict: { pass: correct, summary: 's' },
  },
  rawResponse: '{}',
});

const emptyTiming = {
  ttftMs: null,
  totalMs: 1,
  completionTokens: null,
  tokensPerSec: null,
  tokensPerSecSource: null,
  loadDurationMs: null,
};

describe('judgeAnswer', () => {
  test('accepts the expected verdict when the summary names the missing thing', () => {
    const j = judgeAnswer(
      verdict({ pass: false, summary: 'No test was added for the export.' }),
      FAIL_EXPECT,
    );
    expect(j.correct).toBe(true);
    expect(j.passMatches).toBe(true);
    expect(j.jsonValid).toBe(true);
    expect(j.missingMentions).toEqual([]);
  });

  test('marks a lazy pass on a diff that should fail as incorrect', () => {
    const j = judgeAnswer(verdict({ pass: true, summary: 'Looks good, and a test exists.' }), FAIL_EXPECT);
    expect(j.correct).toBe(false);
    expect(j.passMatches).toBe(false);
    expect(j.jsonValid).toBe(true);
  });

  test('marks a right verdict with the wrong evidence as incorrect', () => {
    const j = judgeAnswer(
      verdict({ pass: false, summary: 'The button is in the wrong place.' }),
      FAIL_EXPECT,
    );
    expect(j.passMatches).toBe(true);
    expect(j.correct).toBe(false);
    expect(j.missingMentions).toEqual(['test']);
  });

  test('finds mentions in fixInstructions too, not only in the summary', () => {
    const j = judgeAnswer(
      verdict({ pass: false, summary: 'Incomplete.', fixInstructions: 'Add a unit test for the escaping.' }),
      FAIL_EXPECT,
    );
    expect(j.correct).toBe(true);
  });

  test('reports invalid JSON instead of throwing', () => {
    const j = judgeAnswer('This looks fine to me.', PASS_EXPECT);
    expect(j.correct).toBe(false);
    expect(j.jsonValid).toBe(false);
    expect(j.verdict).toBeNull();
    expect(j.parseError).toBeDefined();
  });

  test('tolerates a fenced JSON answer from a chatty model', () => {
    const j = judgeAnswer('```json\n{"pass":true,"summary":"All good"}\n```', PASS_EXPECT);
    expect(j.jsonValid).toBe(true);
    expect(j.correct).toBe(true);
  });
});

describe('scoring', () => {
  test('mean returns null for no samples and rounds to two decimals', () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([1, 2, 2])).toBe(1.67);
  });

  test('a case is correct only when every repeat of it was correct', () => {
    const outcomes = caseOutcomes(
      [attempt('a', true, 0), attempt('a', false, 1), attempt('b', true, 0), attempt('b', true, 1)],
      ['a', 'b', 'c'],
    );
    expect(outcomes).toEqual([
      { key: 'a', correct: false, attempts: 2 },
      { key: 'b', correct: true, attempts: 2 },
      { key: 'c', correct: false, attempts: 0 },
    ]);
  });

  test('summariseModel averages latency over attempts but scores accuracy over the corpus', () => {
    const result = summariseModel({
      model: 'm',
      profile: 'mbp',
      startedAt: 1,
      finishedAt: 2,
      attempts: [attempt('a', true), attempt('b', false)],
      caseKeys: ['a', 'b', 'c'],
      residentGb: 7.5,
      freeRamBeforeGb: 20,
      freeRamAfterGb: 12,
      alreadyResident: false,
      unloaded: true,
    });
    expect(result.status).toBe('ok');
    expect(result.correct).toBe(1);
    expect(result.total).toBe(3);
    expect(result.accuracy).toBe(0.33);
    expect(result.latencyMsMean).toBe(1000);
    expect(result.ttftMsMean).toBe(100);
    expect(result.transports).toEqual({ v1: 2, native: 0, none: 0 });
    expect(result.unloaded).toBe(true);
  });

  test('an aborted model keeps the abort reason and is scored against the whole corpus', () => {
    const result = summariseModel({
      model: 'm',
      profile: 'air',
      startedAt: 1,
      finishedAt: 2,
      attempts: [attempt('a', true)],
      caseKeys: ['a', 'b'],
      abortReason: 'out of memory on b',
      residentGb: null,
      freeRamBeforeGb: null,
      freeRamAfterGb: null,
      alreadyResident: true,
      unloaded: true,
    });
    expect(result.status).toBe('aborted');
    expect(result.abortReason).toBe('out of memory on b');
    expect(result.accuracy).toBe(0.5);
    expect(result.residentGb).toBeNull();
  });
});

describe('failure classification', () => {
  const failure = (status: number, error: string): CallResult => ({
    text: '',
    timing: emptyTiming,
    status,
    error,
  });

  test('recognises the ways Ollama reports that a model does not fit', () => {
    expect(
      isMemoryFailure(
        failure(500, '500 Internal Server Error: model requires more system memory (out of memory)'),
      ),
    ).toBe(true);
    expect(isMemoryFailure(failure(500, 'failed to allocate 24.0 GiB'))).toBe(true);
    expect(
      isMemoryFailure(failure(500, 'ggml_backend_metal_buffer_type_alloc_buffer: not enough memory')),
    ).toBe(true);
  });

  test('does not call a plain 500 or a 404 a memory failure', () => {
    expect(isMemoryFailure(failure(500, 'context length exceeded'))).toBe(false);
    expect(isMemoryFailure(failure(404, 'model not found'))).toBe(false);
    expect(isMemoryFailure(failure(0, 'request failed: connection refused'))).toBe(false);
  });

  test('status 0 with a transport error is unreachable, a stream error is not', () => {
    expect(isUnreachable(failure(0, 'request failed: Error: connection refused'))).toBe(true);
    expect(isUnreachable(failure(200, 'stream ended early: ECONNRESET'))).toBe(false);
  });
});

describe('safety rails', () => {
  test('passes on a quiet machine', () => {
    const rails = checkRails({ openCodeProcesses: 2, freeRamGb: 20, maxRamGb: 6 });
    expect(rails).toEqual({ ok: true, blocking: [], warnings: [] });
  });

  test('refuses when too many opencode processes would be starved', () => {
    const rails = checkRails({ openCodeProcesses: MAX_OPENCODE_PROCESSES + 1, freeRamGb: 20, maxRamGb: 6 });
    expect(rails.ok).toBe(false);
    expect(rails.blocking[0]).toContain('opencode processes');
    expect(rails.blocking[0]).toContain('--force');
  });

  test('refuses when free RAM is below the requested headroom', () => {
    const rails = checkRails({ openCodeProcesses: 0, freeRamGb: 2.5, maxRamGb: 6 });
    expect(rails.ok).toBe(false);
    expect(rails.blocking[0]).toContain('2.5 GB');
    expect(rails.blocking[0]).toContain('6 GB');
  });

  test('warns instead of guessing when free RAM cannot be measured', () => {
    const rails = checkRails({ openCodeProcesses: 0, freeRamGb: null, maxRamGb: 6 });
    expect(rails.ok).toBe(true);
    expect(rails.warnings[0]).toContain('blind');
  });
});
