import { describe, expect, test } from 'bun:test';
import { parseWorkerHandback, stripWorkerHandback } from './handshake';
import { HANDBACK_BLOCK } from './testing/fixtures';

describe('parseWorkerHandback', () => {
  test('parses the block a worker prints last', () => {
    const handback = parseWorkerHandback(`Done, all green.\n\n${HANDBACK_BLOCK}`);
    expect(handback).toEqual({
      status: 'complete',
      summary: 'Theme toggles and persists across reloads.',
      filesChanged: ['src/features/theme/index.ts'],
      testsAdded: ['src/features/theme/index.test.ts'],
      notes: 'Used a data-theme attribute.',
    });
  });

  test('tolerates CRLF line endings', () => {
    const crlf = HANDBACK_BLOCK.replace(/\n/g, '\r\n');
    expect(parseWorkerHandback(crlf)?.status).toBe('complete');
  });

  test('returns undefined when there is no block', () => {
    expect(parseWorkerHandback('just prose')).toBeUndefined();
  });

  test('returns undefined for malformed JSON', () => {
    expect(parseWorkerHandback('<<<STARLING_HANDBACK\n{nope}\nSTARLING_HANDBACK>>>')).toBeUndefined();
  });

  test('returns undefined when required fields are missing', () => {
    expect(
      parseWorkerHandback('<<<STARLING_HANDBACK\n{"status":"complete"}\nSTARLING_HANDBACK>>>'),
    ).toBeUndefined();
  });
});

describe('stripWorkerHandback', () => {
  test('removes the block but keeps the prose', () => {
    expect(stripWorkerHandback(`Done, all green.\n\n${HANDBACK_BLOCK}`)).toBe('Done, all green.');
  });

  test('leaves text without a block untouched', () => {
    expect(stripWorkerHandback('  just prose  ')).toBe('just prose');
  });
});
