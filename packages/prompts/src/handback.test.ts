import { describe, expect, test } from 'bun:test';
import { HANDBACK_END, HANDBACK_START, handbackInstructions, parseHandback } from './index.ts';

const JSON_COMPLETE =
  '{"status":"complete","summary":"Added CSV export","filesChanged":["src/features/export/index.ts"],"testsAdded":["src/features/export/index.test.ts"]}';

function block(json: string): string {
  return `${HANDBACK_START}\n${json}\n${HANDBACK_END}`;
}

describe('parseHandback', () => {
  test('parses a plain block', () => {
    const parsed = parseHandback(`Work done.\n\n${block(JSON_COMPLETE)}`);
    expect(parsed).toEqual({
      status: 'complete',
      summary: 'Added CSV export',
      filesChanged: ['src/features/export/index.ts'],
      testsAdded: ['src/features/export/index.test.ts'],
    });
  });

  test('tolerates a fenced JSON body inside the markers', () => {
    const fenced = `${HANDBACK_START}\n\`\`\`json\n${JSON_COMPLETE}\n\`\`\`\n${HANDBACK_END}`;
    expect(parseHandback(fenced)?.summary).toBe('Added CSV export');
  });

  test('tolerates the whole block wrapped in a fence', () => {
    expect(parseHandback(`\`\`\`\n${block(JSON_COMPLETE)}\n\`\`\``)?.status).toBe('complete');
  });

  test('ignores prose before and after the block', () => {
    const text = `Here is my summary of the work.\n\n${block(JSON_COMPLETE)}\n\nLet me know if you want anything else.`;
    expect(parseHandback(text)?.summary).toBe('Added CSV export');
  });

  test('uses the last block when the agent prints more than one', () => {
    const first = block('{"status":"partial","summary":"first","filesChanged":[],"testsAdded":[]}');
    const second = block('{"status":"complete","summary":"second","filesChanged":["a.ts"],"testsAdded":[]}');
    const parsed = parseHandback(`${first}\n\nSome more work later.\n\n${second}`);
    expect(parsed?.summary).toBe('second');
    expect(parsed?.status).toBe('complete');
  });

  test('returns undefined for malformed JSON', () => {
    expect(parseHandback(block('{"status":"complete", summary: nope}'))).toBeUndefined();
  });

  test('returns undefined when the block never opens', () => {
    expect(parseHandback('All done, no handback here.')).toBeUndefined();
  });

  test('returns undefined when the closing marker is missing', () => {
    expect(parseHandback(`${HANDBACK_START}\n${JSON_COMPLETE}`)).toBeUndefined();
  });

  test('returns undefined for an empty string', () => {
    expect(parseHandback('')).toBeUndefined();
  });

  test('returns undefined for an unknown status', () => {
    expect(
      parseHandback(block('{"status":"done","summary":"x","filesChanged":[],"testsAdded":[]}')),
    ).toBeUndefined();
  });

  test('returns undefined when a required field is missing', () => {
    expect(parseHandback(block('{"status":"complete","summary":"x"}'))).toBeUndefined();
  });

  test('returns undefined when a field has the wrong type', () => {
    expect(
      parseHandback(block('{"status":"complete","summary":"x","filesChanged":"a.ts","testsAdded":[]}')),
    ).toBeUndefined();
  });

  test('ignores extra fields instead of rejecting the handback', () => {
    const parsed = parseHandback(
      block(
        '{"status":"complete","summary":"x","filesChanged":[],"testsAdded":[],"durationMin":12,"model":"deepseek"}',
      ),
    );
    expect(parsed).toEqual({
      status: 'complete',
      summary: 'x',
      filesChanged: [],
      testsAdded: [],
    });
  });

  test('accepts a partial handback with notes', () => {
    const parsed = parseHandback(
      block(
        '{"status":"partial","summary":"export works","filesChanged":["a.ts"],"testsAdded":[],"notes":"empty-state test missing"}',
      ),
    );
    expect(parsed?.status).toBe('partial');
    expect(parsed?.notes).toBe('empty-state test missing');
  });
});

describe('handbackInstructions', () => {
  const text = handbackInstructions();

  test('shows both markers and the container fields', () => {
    expect(text).toContain(HANDBACK_START);
    expect(text).toContain(HANDBACK_END);
    expect(text).toContain('"status"');
    expect(text).toContain('"filesChanged"');
    expect(text).toContain('"testsAdded"');
  });

  test('explains complete versus partial and the no-fence rule', () => {
    expect(text).toContain('`"complete"` only when every definition-of-done item is met');
    expect(text).toContain('No fence is needed.');
  });
});
