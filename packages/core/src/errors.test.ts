import { describe, expect, test } from 'bun:test';
import { isStarlingError, StarlingError, type StarlingErrorCode } from './errors';
import type { LLM, LLMCallOptions, LLMRequest } from './ports';
import { MockLLM } from './testing/mock-llm';

/**
 * The codes Wave 1 packages had to smuggle through `details.reason` because the frozen union lacked
 * them. They are now first-class, so a caller can branch on `err.code` alone.
 */
const C1_CODES: StarlingErrorCode[] = [
  'LLM_BAD_JSON',
  'GIT_TOO_OLD',
  'GH_AUTH',
  'GH_REPO',
  'GH_COMMAND',
  'GH_MISSING',
  'NOT_WIRED',
  'NODE_AUTH',
];

describe('StarlingErrorCode (C1 additions)', () => {
  test('every new code constructs a StarlingError that matches itself', () => {
    for (const code of C1_CODES) {
      const err = new StarlingError(code, `${code} happened`);
      expect(err.code).toBe(code);
      expect(isStarlingError(err, code)).toBe(true);
      expect(isStarlingError(err, 'LLM_ERROR')).toBe(false);
    }
  });

  test('the new codes are distinct from the old catch-alls', () => {
    expect(new Set(C1_CODES).size).toBe(C1_CODES.length);
    expect(C1_CODES).not.toContain('LLM_ERROR' as StarlingErrorCode);
    expect(C1_CODES).not.toContain('EXEC_FAILED' as StarlingErrorCode);
  });
});

describe('LLM port cancellation (C1 addition)', () => {
  const request: LLMRequest = { role: 'worker', system: 'sys', messages: [{ role: 'user', content: 'hi' }] };

  test('any LLM taking no opts is still assignable to the port', () => {
    const plain: LLM = {
      complete: async () => ({
        text: '',
        usage: { input: 0, output: 0, cached: 0 },
        model: { provider: 'x', model: 'y' },
        costUsd: 0,
        local: true,
      }),
      completeJson: async () => ({
        text: '',
        parsed: undefined,
        usage: { input: 0, output: 0, cached: 0 },
        model: { provider: 'x', model: 'y' },
        costUsd: 0,
        local: true,
      }),
    };
    expect(typeof plain.complete).toBe('function');
  });

  test('MockLLM accepts and ignores per-call controls', async () => {
    const llm = new MockLLM({ responses: [{ text: 'one' }, { text: 'two' }] });
    const opts: LLMCallOptions = { signal: new AbortController().signal, timeoutMs: 50 };
    expect((await llm.complete(request, opts)).text).toBe('one');
    expect((await llm.complete(request)).text).toBe('two');
    expect(llm.calls).toHaveLength(2);
  });

  test('MockLLM.completeJson forwards the controls without breaking validation', async () => {
    const llm = new MockLLM({ responses: [{ parsed: { ok: true } }] });
    const { z } = await import('zod');
    const res = await llm.completeJson(request, z.object({ ok: z.boolean() }), { timeoutMs: 5 });
    expect(res.parsed).toEqual({ ok: true });
  });
});
