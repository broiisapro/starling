/**
 * Minimal server-sent-events parser.
 *
 * opencode 2.1.2 emits plain `data: {json}` frames plus `: heartbeat` comments, so a full
 * EventSource implementation is unnecessary. Keeping the parser separate makes it testable
 * without a socket and lets the runner reuse it across reconnects.
 */

export interface SseMessage {
  /** `event:` field when the server sends one. */
  event?: string;
  /** Joined `data:` lines (newline-separated, per the SSE spec). */
  data: string;
  /** `id:` field when present. */
  id?: string;
}

export interface SseParser {
  /** Feed a chunk of text; returns every complete message it completes. */
  push(chunk: string): SseMessage[];
  /** Flush a trailing message that was not terminated by a blank line. */
  end(): SseMessage[];
}

function parseBlock(block: string): SseMessage | undefined {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine === '' || rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
  }

  if (data.length === 0) return undefined;
  const message: SseMessage = { data: data.join('\n') };
  if (event !== undefined) message.event = event;
  if (id !== undefined) message.id = id;
  return message;
}

export function createSseParser(): SseParser {
  let buffer = '';

  return {
    push(chunk) {
      buffer += chunk;
      const out: SseMessage[] = [];
      // Frames are separated by a blank line; accept LF and CRLF.
      const boundary = /\r?\n\r?\n/g;
      let consumed = 0;
      for (let match = boundary.exec(buffer); match !== null; match = boundary.exec(buffer)) {
        const message = parseBlock(buffer.slice(consumed, match.index));
        consumed = match.index + match[0].length;
        if (message !== undefined) out.push(message);
      }
      buffer = buffer.slice(consumed);
      return out;
    },

    end() {
      const rest = buffer;
      buffer = '';
      const message = rest.trim() === '' ? undefined : parseBlock(rest);
      return message === undefined ? [] : [message];
    },
  };
}

/** Read an SSE body until it ends, the signal aborts, or the stream errors. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();

  try {
    while (true) {
      if (signal?.aborted === true) return;
      const { done, value } = await reader.read();
      if (done) break;
      for (const message of parser.push(decoder.decode(value, { stream: true }))) {
        yield message;
      }
    }
    for (const message of parser.push(decoder.decode())) yield message;
    for (const message of parser.end()) yield message;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed; nothing to release.
    }
  }
}
