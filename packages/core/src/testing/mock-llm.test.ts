import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { StarlingError } from '../errors';
import type { LLMRequest } from '../ports';
import { MockLLM } from './mock-llm';

const req: LLMRequest = { role: 'auditor', system: 'judge', messages: [{ role: 'user', content: 'diff?' }] };

describe('MockLLM', () => {
  test('returns scripted responses in order and records calls', async () => {
    const llm = new MockLLM({ responses: [{ text: 'first' }, { text: 'second' }] });
    expect((await llm.complete(req)).text).toBe('first');
    expect((await llm.complete(req)).text).toBe('second');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]?.role).toBe('auditor');
  });

  test('completeJson validates the scripted JSON with the supplied schema', async () => {
    const schema = z.object({ pass: z.boolean(), reason: z.string() });
    const llm = new MockLLM({ responses: [{ text: '{"pass":true,"reason":"ok"}' }] });
    const res = await llm.completeJson(req, schema);
    expect(res.parsed?.pass).toBe(true);
  });

  test('completeJson rejects invalid JSON with LLM_ERROR', async () => {
    const llm = new MockLLM({ responses: [{ text: 'not json' }] });
    try {
      await llm.completeJson(req, z.object({ ok: z.boolean() }));
      throw new Error('expected a failure');
    } catch (err) {
      expect(err).toBeInstanceOf(StarlingError);
      expect((err as StarlingError).code).toBe('LLM_ERROR');
    }
  });

  test('completeJson rejects schema violations with LLM_ERROR', async () => {
    const llm = new MockLLM({ responses: [{ text: '{"pass":"maybe"}' }] });
    await expect(llm.completeJson(req, z.object({ pass: z.boolean() }))).rejects.toThrow(StarlingError);
  });

  test('a responder function can answer without a queue', async () => {
    const llm = new MockLLM({
      responder: (r) => ({ text: `role=${r.role}`, usage: { input: 7, output: 1, cached: 0 } }),
    });
    const res = await llm.complete(req);
    expect(res.text).toBe('role=auditor');
    expect(res.usage.input).toBe(7);
  });

  test('running out of scripted responses is a clear LLM_ERROR', async () => {
    const llm = new MockLLM();
    await expect(llm.complete(req)).rejects.toThrow('no scripted response');
  });
});
