import type { TokenUsage } from '@starling/core';
import { StarlingError } from '@starling/core';
import type { OpencodeCompletionClient, OpencodeCompletionRequest, OpencodeCompletionResult } from '../types';

export interface OpencodeClientOptions {
  /** Base URL of a running `opencode serve`, e.g. `http://127.0.0.1:4096`. */
  baseUrl: string;
  /** Server password (opencode prints `server password …` on boot). Sent as HTTP Basic. */
  password?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Optional working directory for the throwaway session. */
  directory?: string;
  /** Optional agent id; a read-only agent keeps a completion from touching files. */
  agent?: string;
  title?: string;
  /** Cleanup failures must not mask a successful completion, but they should not vanish either. */
  onCleanupError?: (err: unknown) => void;
}

interface SessionEnvelope {
  data?: { id?: string };
}
interface GenerateEnvelope {
  data?: { text?: string };
}
interface SessionInfoEnvelope {
  data?: {
    tokens?: {
      input?: number;
      output?: number;
      cache?: { read?: number; write?: number };
    };
  };
}

function toUsage(tokens: NonNullable<SessionInfoEnvelope['data']>['tokens']): TokenUsage {
  const input = tokens?.input ?? 0;
  return {
    input,
    output: tokens?.output ?? 0,
    cached: Math.min(tokens?.cache?.read ?? 0, input),
  };
}

/** `opencode serve` authenticates with HTTP Basic, username `opencode`, password printed at boot. */
function authHeaders(password: string | undefined): Record<string, string> {
  if (password === undefined || password === '') return {};
  return { Authorization: `Basic ${btoa(`opencode:${password}`)}` };
}

function composePrompt(system: string, prompt: string): string {
  const trimmed = system.trim();
  return trimmed === '' ? prompt : `${trimmed}\n\n${prompt}`;
}

/**
 * Default opencode completion client, over the live **V2 REST API** (`opencode serve` ≥ 2.x).
 *
 * One completion = create a throwaway session → `/api/session/{id}/generate` → read session token
 * totals → delete the session. Shapes were read from `GET /openapi.json` on opencode 2.1.2; see
 * `docs/epic-10-llm.md` for the paths and payloads.
 *
 * Why not `@opencode-ai/sdk` here? Version 1.19.4's V2 client is generated from an older spec: it
 * has no synchronous `/generate` route and no session delete, and its prompt semantics differ from
 * a 2.1.x server. Speaking the documented REST API keeps the adapter honest across server patch
 * versions. (Recorded as a deviation in the epic doc.)
 */
export function createOpencodeCompletionClient(opts: OpencodeClientOptions): OpencodeCompletionClient {
  const fetcher = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const headers = authHeaders(opts.password);

  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetcher(`${base}${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new StarlingError('LLM_ERROR', `opencode ${method} ${path} failed (${res.status})`, {
        details: { reason: 'opencode', status: res.status, path, detail: detail.slice(0, 500) },
      });
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async complete(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult> {
      const created = await request<SessionEnvelope>(
        'POST',
        '/api/session',
        {
          title: opts.title ?? 'starling llm completion',
          model: { id: req.modelID, providerID: req.providerID },
          ...(opts.directory === undefined ? {} : { location: { directory: opts.directory } }),
          ...(opts.agent === undefined ? {} : { agent: opts.agent }),
        },
        req.signal,
      );
      const sessionID = created.data?.id;
      if (typeof sessionID !== 'string' || sessionID === '') {
        throw new StarlingError('LLM_ERROR', 'opencode did not return a session id', {
          details: { reason: 'opencode', response: created },
        });
      }

      try {
        const generated = await request<GenerateEnvelope>(
          'POST',
          `/api/session/${sessionID}/generate`,
          { prompt: composePrompt(req.system, req.prompt) },
          req.signal,
        );
        const text = generated.data?.text;
        if (typeof text !== 'string') {
          throw new StarlingError('LLM_ERROR', 'opencode generate returned no text', {
            details: { reason: 'opencode', sessionID },
          });
        }

        const info = await request<SessionInfoEnvelope>(
          'GET',
          `/api/session/${sessionID}`,
          undefined,
          req.signal,
        );
        if (info.data?.tokens === undefined) {
          throw new StarlingError('LLM_ERROR', 'opencode session is missing token usage', {
            details: { reason: 'opencode', sessionID },
          });
        }
        return { text, usage: toUsage(info.data.tokens) };
      } finally {
        try {
          await request<void>('DELETE', `/api/session/${sessionID}`);
        } catch (err) {
          opts.onCleanupError?.(err);
        }
      }
    },
  };
}
