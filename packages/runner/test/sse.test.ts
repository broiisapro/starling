import { describe, expect, test } from 'bun:test';
import { createSseParser, readSse } from '../src/sse';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('SSE parser', () => {
  test('parses a single data frame', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"session.idle"}\n\n')).toEqual([{ data: '{"type":"session.idle"}' }]);
  });

  test('parses several frames arriving in one chunk', () => {
    const parser = createSseParser();
    const messages = parser.push('data: one\n\ndata: two\n\n: heartbeat\n\ndata: three\n\n');
    expect(messages.map((message) => message.data)).toEqual(['one', 'two', 'three']);
  });

  test('buffers a frame split across chunks', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"ty')).toEqual([]);
    expect(parser.push('pe":"x"}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ data: '{"type":"x"}' }]);
  });

  test('joins multi-line data and keeps event/id fields', () => {
    const parser = createSseParser();
    const [message] = parser.push('event: update\nid: 7\ndata: line one\ndata: line two\n\n');
    expect(message).toEqual({ event: 'update', id: '7', data: 'line one\nline two' });
  });

  test('accepts CRLF separators and flushes a trailing frame on end()', () => {
    const parser = createSseParser();
    expect(parser.push('data: a\r\n\r\ndata: b')).toEqual([{ data: 'a' }]);
    expect(parser.end()).toEqual([{ data: 'b' }]);
  });

  test('readSse yields parsed frames from a stream and stops at the end', async () => {
    const seen: string[] = [];
    for await (const message of readSse(streamOf('data: one\n\ndata: ', 'two\n\n'))) {
      seen.push(message.data);
    }
    expect(seen).toEqual(['one', 'two']);
  });
});
