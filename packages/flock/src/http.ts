import { isStarlingError, StarlingError } from '@starling/core';

/** Header every hub↔perch call carries (ARCHITECTURE L18). */
export const FLOCK_TOKEN_HEADER = 'x-flock-token';

export interface HttpOptions {
  fetch?: typeof fetch;
  /** Per-request deadline. SSE connections opt out (they are long-lived by design). */
  timeoutMs?: number;
  token?: string;
}

export interface MinimalSchema<T> {
  parse(input: unknown): T;
}

export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

function tokenHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { [FLOCK_TOKEN_HEADER]: token };
}

/** Map a non-2xx response onto the three codes that matter to the flock. */
function statusError(status: number, what: string, body: string): StarlingError {
  const detail = body.trim().slice(0, 300);
  if (status === 401 || status === 403) {
    return new StarlingError('NODE_AUTH', `${what}: the perch rejected the join code (${status})`, {
      details: { status, body: detail },
    });
  }
  return new StarlingError('NODE_OFFLINE', `${what}: perch answered ${status}`, {
    details: { status, body: detail },
  });
}

function networkError(err: unknown, what: string): StarlingError {
  if (isStarlingError(err)) return err;
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new StarlingError('NODE_OFFLINE', `${what}: timed out`, { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new StarlingError('NODE_OFFLINE', `${what}: ${message}`, { cause: err });
}

/**
 * One HTTP request with a deadline and uniform error mapping.
 *
 * Every network failure becomes `NODE_OFFLINE` so the engine can reschedule; a 401/403 is
 * `NODE_AUTH` because the join code is wrong and retrying forever would never help.
 */
export async function request(url: string, init: RequestInit, opts: HttpOptions = {}): Promise<Response> {
  const fetchFn = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const headers = new Headers(init.headers);
  if (opts.token !== undefined) headers.set(FLOCK_TOKEN_HEADER, opts.token);
  let res: Response;
  try {
    res = await fetchFn(url, {
      ...init,
      headers,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (err) {
    throw networkError(err, init.method === undefined ? 'GET' : init.method);
  }
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // A body we cannot read does not change the status code; report the status alone.
    }
    throw statusError(res.status, `${init.method ?? 'GET'} ${url}`, body);
  }
  return res;
}

/** `request` plus JSON decoding and schema validation. */
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  parse: MinimalSchema<T>,
  opts: HttpOptions = {},
): Promise<T> {
  const res = await request(url, init, opts);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new StarlingError('NODE_OFFLINE', `perch returned invalid JSON for ${url}`, { cause: err });
  }
  return parseResponse(parse, raw, url);
}

/** `request` plus the raw body as bytes (git bundles). */
export async function requestBytes(
  url: string,
  init: RequestInit,
  opts: HttpOptions = {},
): Promise<Uint8Array> {
  const res = await request(url, init, opts);
  return new Uint8Array(await res.arrayBuffer());
}

/** Schema-validate an HTTP body, mapping a zodiac (zod) failure onto a readable offline error. */
export function parseResponse<T>(parse: MinimalSchema<T>, raw: unknown, what: string): T {
  try {
    return parse.parse(raw);
  } catch (err) {
    throw new StarlingError('NODE_OFFLINE', `${what}: perch sent an unexpected payload`, { cause: err });
  }
}

export interface SseOptions {
  url: string;
  token?: string;
  fetch?: typeof fetch;
  onData: (data: string) => void;
  onError?: (err: StarlingError) => void;
  /** Delay before reconnecting after the stream ends or fails. */
  reconnectMs?: number;
  signal?: AbortSignal;
}

export interface SseSubscription {
  /** Stop reconnecting and tear down the in-flight stream. Idempotent. */
  close(): void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

/** Feed a `text/event-stream` body into an SSE data-line dispatcher. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
  isClosed: () => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const flushEvent = (): void => {
    if (dataLines.length > 0) {
      onData(dataLines.join('\n'));
      dataLines = [];
    }
  };

  try {
    while (!isClosed()) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          flushEvent();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        // `event:`, `id:`, `retry:` and keep-alive comments are intentionally ignored: the payload
        // is always a whole AgentEvent.
        newline = buffer.indexOf('\n');
      }
    }
    flushEvent();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Hold one SSE connection open with automatic reconnect.
 *
 * The loop never rejects: a broken stream must not take the process down, so failures are reported to
 * `onError` and the client retries after `reconnectMs` (250 ms by default — LAN reconnects are cheap,
 * and the perch's `/perch/events` stream carries no backlog, so reconnecting is how we learn about the
 * next event). `close()` aborts immediately and prevents further attempts.
 */
export function subscribeSse(opts: SseOptions): SseSubscription {
  const fetchFn = opts.fetch ?? fetch;
  const controller = new AbortController();
  const reconnectMs = opts.reconnectMs ?? 250;
  const onClose = (): void => controller.abort();
  opts.signal?.addEventListener('abort', onClose, { once: true });
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    controller.abort();
    opts.signal?.removeEventListener('abort', onClose);
  };

  const loop = async (): Promise<void> => {
    while (!closed) {
      try {
        const res = await fetchFn(opts.url, {
          headers: tokenHeaders(opts.token),
          signal: controller.signal,
        });
        if (!res.ok) throw statusError(res.status, `GET ${opts.url}`, '');
        if (res.body === null)
          throw new StarlingError('NODE_OFFLINE', `${opts.url} has no event stream body`);
        await readSse(res.body, opts.onData, () => closed);
      } catch (err) {
        if (closed) break;
        const mapped = networkError(err, 'perch event stream');
        opts.onError?.(mapped);
        // A rejected join code never starts working on its own: stop instead of hammering the perch
        // every reconnectMs forever. Network failures do retry.
        if (mapped.code === 'NODE_AUTH') break;
      }
      if (closed) break;
      await sleep(reconnectMs, controller.signal);
    }
  };

  // Self-healing background loop: errors are surfaced through `onError`, so nothing is swallowed.
  void loop();

  return { close };
}
