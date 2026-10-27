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
 *   POST /api/session/{id}/generate         one synchronous answer (used by the LLM router)
 *   POST /api/experimental/generate         one stateless answer, no session (LLM router's first try)
 *   GET  /api/session/{id}                  session detail incl. token totals
 *   DELETE /api/session/{id}                remove a throwaway session
 *
 * Since Epic 49 this is the **single** V2 client in the repo: `@starling/llm`'s `opencode` provider
 * builds one of these instead of keeping its own copy of the REST calls. Epic 40 added
 * `generateStateless`, the bare-model route the LLM router prefers (a *session* is a coding agent
 * and may answer a completion prompt by exploring the repo instead of replying).
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
  /** Worktree/scope for the session. Omitted for a server-default location. */
  directory?: string;
  title?: string;
  model?: ModelRef;
  /** Optional agent id. A read-only agent keeps a throwaway completion off the filesystem. */
  agent?: string;
  signal?: AbortSignal;
}

export interface GenerateSessionInput {
  prompt: string;
  /** Needed for the per-directory header on servers that scope sessions by worktree. */
  directory?: string;
  signal?: AbortSignal;
}

/** One stateless model call: no session, no tools, no agent loop. */
export interface GenerateStatelessInput {
  /** The whole prompt. System instructions are composed by the caller. */
  prompt: string;
  providerID: string;
  modelID: string;
  directory?: string;
  signal?: AbortSignal;
}

/** Per-request controls for the plain read/delete routes. */
export interface RequestOptions {
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Status codes that mean "the provider asked us to slow down", not "this request is wrong". */
const RATE_LIMIT_STATUSES = new Set([429, 503]);

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
    const body: OpencodeCreateSessionBody = {};
    if (input.directory !== undefined) body.location = { directory: input.directory };
    if (input.title !== undefined) body.title = input.title;
    if (input.model !== undefined) {
      body.model = { providerID: input.model.provider, id: input.model.model };
    }
    if (input.agent !== undefined) body.agent = input.agent;
    const res = await this.#json<OpencodeDataResponse<OpencodeSessionInfo>>(
      'POST',
      '/api/session',
      body,
      input.directory,
      input.signal,
    );
    return res.data;
  }

  /** One synchronous answer for a session (no tools loop). Returns the generated text. */
  async generate(sessionId: string, input: GenerateSessionInput): Promise<string> {
    const res = await this.#json<OpencodeDataResponse<{ text?: unknown }>>(
      'POST',
      `/api/session/${encodeURIComponent(sessionId)}/generate`,
      { prompt: input.prompt },
      input.directory,
      input.signal,
    );
    const text = res.data?.text;
    if (typeof text !== 'string') {
      throw new StarlingError('RUNNER_ERROR', 'opencode generate returned no text', {
        details: { sessionId },
      });
    }
    return text;
  }

  /**
   * One stateless answer via `POST /api/experimental/generate` (opencode 2.1.2+).
   *
   * Named `generateStateless`, not `generate`, because the session-scoped route above already owns
   * that name; renaming it would churn every caller for no gain.
   *
   * Returns `undefined` — never throws — whenever the route is unavailable or refuses: a 404 on an
   * older server, any other non-2xx, an unreadable body, or a body without `data.text`. That is
   * deliberate: a refusal means "fall back to the session path", not "this completion failed". A
   * transport failure still throws, because retrying is the caller's decision and it is not a
   * capability signal.
   *
   * The route has no session, so it reports no token usage (its response schema is
   * `{ data: { text } }` only). Callers that must meter a call use `generate` + `sessionInfo`.
   */
  async generateStateless(input: GenerateStatelessInput): Promise<string | undefined> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.baseUrl}/api/experimental/generate`, {
        method: 'POST',
        headers: { ...this.headers(input.directory), 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: input.prompt,
          model: { providerID: input.providerID, id: input.modelID },
        }),
        signal: this.#signalFor(input.signal),
      });
    } catch (err) {
      throw toStarlingError(
        err,
        'RUNNER_ERROR',
        'opencode POST /api/experimental/generate could not be reached',
      );
    }
    if (!res.ok) return undefined;
    let body: OpencodeDataResponse<{ text?: unknown }>;
    try {
      body = (await res.json()) as OpencodeDataResponse<{ text?: unknown }>;
    } catch {
      return undefined;
    }
    return typeof body.data?.text === 'string' ? body.data.text : undefined;
  }

  async sessionInfo(sessionId: string, opts: RequestOptions = {}): Promise<OpencodeSessionInfo> {
    const res = await this.#json<OpencodeDataResponse<OpencodeSessionInfo>>(
      'GET',
      `/api/session/${encodeURIComponent(sessionId)}`,
      undefined,
      undefined,
      opts.signal,
    );
    return res.data ?? {};
  }

  async deleteSession(sessionId: string, opts: RequestOptions = {}): Promise<void> {
    await this.#json<void>(
      'DELETE',
      `/api/session/${encodeURIComponent(sessionId)}`,
      undefined,
      undefined,
      opts.signal,
    );
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

  async #json<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    directory?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers = this.headers(directory);
    const init: RequestInit = {
      method,
      headers,
      signal: this.#signalFor(signal),
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
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'), this.#nowMs());
      throw new StarlingError(
        'RUNNER_ERROR',
        `opencode ${method} ${path} failed with ${res.status}${detail === '' ? '' : `: ${detail.slice(0, 500)}`}`,
        {
          details: {
            status: res.status,
            rateLimited: RATE_LIMIT_STATUSES.has(res.status),
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          },
        },
      );
    }
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw toStarlingError(err, 'RUNNER_ERROR', `opencode ${method} ${path} returned invalid JSON`);
    }
  }

  /** Combine the per-request timeout with an optional caller signal. */
  #signalFor(external: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    if (external === undefined) return timeout;
    const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    return anySignal === undefined ? external : anySignal([external, timeout]);
  }

  #nowMs(): number {
    return Date.now();
  }
}

/** `Retry-After` is either delta-seconds or an HTTP date. Cap it so one header cannot park a run. */
export function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.min(date - nowMs, 120_000));
}
