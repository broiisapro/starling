/**
 * Thin typed HTTP client for the installed opencode server (v2.1.2).
 *
 * Every call goes through the injected `fetch`, so unit tests run against an in-process
 * `Bun.serve({ port: 0 })` fake and never touch a real server (AGENTS.md §4 / L23).
 *
 * Endpoints used (see `test/fixtures/openapi.json`):
 *   POST /api/session                       create a session at a directory
 *   POST /api/session/{id}/prompt           admit one user prompt (agent loop runs async)
 *   POST /api/session/{id}/interrupt        abort the active turn
 *   GET  /api/session/active                foreground turns owned by this process
 *   GET  /api/info                          health / identity
 *   GET  /api/event                         server-wide SSE stream
 */

import type { ModelRef } from '@starling/core';
import { StarlingError, toStarlingError } from '@starling/core';
import type {
  OpencodeActiveSession,
  OpencodeCreateSessionBody,
  OpencodeDataResponse,
  OpencodeEventEnvelope,
  OpencodeServerInfo,
  OpencodeSessionInfo,
} from './types';

export interface OpencodeClientOptions {
  baseUrl: string;
  /** Shared server password. Omit for a server started without auth. */
  password?: string;
  fetch?: typeof fetch;
  /** Per-request timeout for JSON calls. SSE is governed by its own AbortSignal. */
  timeoutMs?: number;
  /** Called when an SSE frame is not valid JSON, so the caller can log it. */
  onMalformedFrame?: (raw: string) => void;
}

export interface CreateSessionInput {
  directory: string;
  title?: string;
  model?: ModelRef;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function encodeBasic(password: string): string {
  return `Basic ${btoa(`opencode:${password}`)}`;
}

export class OpencodeClient {
  readonly baseUrl: string;
  readonly #password: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #onMalformedFrame: ((raw: string) => void) | undefined;

  constructor(options: OpencodeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#password = options.password;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#onMalformedFrame = options.onMalformedFrame;
  }

  /** Headers for one request. `directory` mirrors the SDK's per-client directory header. */
  headers(directory?: string): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.#password !== undefined && this.#password !== '') {
      headers.authorization = encodeBasic(this.#password);
    }
    if (directory !== undefined) headers['x-opencode-directory'] = directory;
    return headers;
  }

  async createSession(input: CreateSessionInput): Promise<OpencodeSessionInfo> {
    const body: OpencodeCreateSessionBody = { location: { directory: input.directory } };
    if (input.title !== undefined) body.title = input.title;
    if (input.model !== undefined) {
      body.model = { providerID: input.model.provider, id: input.model.model };
    }
    const res = await this.#json<OpencodeDataResponse<OpencodeSessionInfo>>(
      'POST',
      '/api/session',
      body,
      input.directory,
    );
    return res.data;
  }

  async prompt(sessionId: string, text: string, directory?: string): Promise<void> {
    await this.#json('POST', `/api/session/${encodeURIComponent(sessionId)}/prompt`, { text }, directory);
  }

  /** Returns true when an active execution was interrupted, false for the idle no-op. */
  async interrupt(sessionId: string, directory?: string): Promise<boolean> {
    const res = await this.#json<{ interrupted?: boolean }>(
      'POST',
      `/api/session/${encodeURIComponent(sessionId)}/interrupt`,
      {},
      directory,
    );
    return res.interrupted === true;
  }

  async serverInfo(): Promise<OpencodeServerInfo> {
    return this.#json<OpencodeServerInfo>('GET', '/api/info');
  }

  async activeSessions(): Promise<Record<string, OpencodeActiveSession>> {
    const res = await this.#json<OpencodeDataResponse<Record<string, OpencodeActiveSession>>>(
      'GET',
      '/api/session/active',
    );
    return res.data;
  }

  /** Open the server-wide event stream. The caller owns the signal and the body. */
  async openEventStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const res = await this.#fetch(`${this.baseUrl}/api/event`, {
      method: 'GET',
      headers: { ...this.headers(), accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok) {
      throw new StarlingError(
        'RUNNER_ERROR',
        `opencode GET /api/event failed with ${res.status} ${res.statusText}`,
      );
    }
    if (res.body === null) {
      throw new StarlingError('RUNNER_ERROR', 'opencode GET /api/event returned an empty body');
    }
    return res.body;
  }

  /** Parse one SSE `data:` payload into an envelope, reporting malformed frames. */
  parseEvent(raw: string): OpencodeEventEnvelope | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#onMalformedFrame?.(raw);
      return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.#onMalformedFrame?.(raw);
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.type !== 'string') {
      this.#onMalformedFrame?.(raw);
      return undefined;
    }
    return parsed as OpencodeEventEnvelope;
  }

  async #json<T>(method: 'GET' | 'POST', path: string, body?: unknown, directory?: string): Promise<T> {
    const headers = this.headers(directory);
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.#fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw toStarlingError(err, 'RUNNER_ERROR', `opencode ${method} ${path} could not be reached`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new StarlingError(
        'RUNNER_ERROR',
        `opencode ${method} ${path} failed with ${res.status}${detail === '' ? '' : `: ${detail.slice(0, 500)}`}`,
        { details: { status: res.status } },
      );
    }
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw toStarlingError(err, 'RUNNER_ERROR', `opencode ${method} ${path} returned invalid JSON`);
    }
  }
}
