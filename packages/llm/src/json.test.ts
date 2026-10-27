import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  extractJson,
  formatIssues,
  jsonInstruction,
  schemaName,
  stripFences,
  toJsonSchemaSafe,
} from './json.ts';

describe('json helpers', () => {
  test('strips a json code fence', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n[1,2]\n```')).toBe('[1,2]');
  });

  test('leaves plain text alone', () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}');
  });

  test('parses plain, fenced and prose-wrapped JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('Here you go:\n{"a":"b}"}\nthanks')).toEqual({ ok: true, value: { a: 'b}' } });
    expect(extractJson('prefix [1,{"b":2}] suffix')).toEqual({ ok: true, value: [1, { b: 2 }] });
  });

  test('reports a failure instead of throwing', () => {
    const result = extractJson('no json here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no JSON');
  });

  test('handles escapes inside strings when finding the outermost value', () => {
    expect(extractJson('x {"a":"quote \\" and brace }"} y')).toEqual({
      ok: true,
      value: { a: 'quote " and brace }' },
    });
  });

  test('turns a zod schema into a JSON schema', () => {
    const schema = toJsonSchemaSafe(z.object({ summary: z.string(), count: z.number() }));
    expect(schema?.type).toBe('object');
    expect(schema?.required).toEqual(['summary', 'count']);
  });

  test('formats zod issues with paths', () => {
    const parsed = z.object({ summary: z.string() }).safeParse({ summary: 3 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(formatIssues(parsed.error)).toContain('summary');
  });

  test('sanitises schema names and builds the JSON instruction', () => {
    expect(schemaName('writer')).toBe('starling_writer');
    expect(schemaName('a/b c')).toBe('starling_a_b_c');
    const instruction = jsonInstruction({ type: 'object' });
    expect(instruction).toContain('single JSON value');
    expect(instruction).toContain('"type":"object"');
  });
});
