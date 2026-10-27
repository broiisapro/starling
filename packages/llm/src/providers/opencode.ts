/**
 * opencode completions for the LLM router — the **runner's** V2 client, not a second one.
 *
 * Wave 1 wrote two REST clients (one here, one in `@starling/runner`). Epic 49 keeps the runner's
 * and this adapter is now just the LLM-shaped recipe on top of it:
 *
 *   create session → generate one answer → read token totals → delete the session
 *
 * `createOpencodeCompletionClient` keeps its public signature, so the router and its tests did not
 * change. See `docs/epic-49-robustness.md` for the unification decision.
 */

import type { TokenUsage } from '@starling/core';
import { StarlingError } from '@starling/core';
import { OpencodeClient } from '@starling/runner';
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
  /** Per-call timeout for the create/generate/read/delete sequence. Default 120 s. */
  timeoutMs?: number;
}

function toUsage(tokens: {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}): TokenUsage {
  const input = tokens.input ?? 0;
  return {
    input,
    output: tokens.output ?? 0,
    cached: Math.min(tokens.cache?.read ?? 0, input),
  };
}

function composePrompt(system: string, prompt: string): string {
  const trimmed = system.trim();
  return trimmed === '' ? prompt : `${trimmed}\n\n${prompt}`;
}

/**
 * Re-shape a client error into the LLM vocabulary.
 *
 * The shared client speaks `RUNNER_ERROR` with `details.status`; the router and its callers expect
 * `LLM_ERROR` with the same structured status, so the provider wraps once instead of leaking a
 * transport code into planning code.
 */
function asLlmError(err: unknown, sessionId?: string): StarlingError {
  if (err instanceof StarlingError && err.code === 'LLM_ERROR') return err;
  if (err instanceof StarlingError) {
    return new StarlingError('LLM_ERROR', err.message, {
      cause: err,
      details: {
        reason: 'opencode',
        ...(err.details ?? {}),
        ...(sessionId === undefined ? {} : { sessionID: sessionId }),
      },
    });
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new StarlingError('LLM_ERROR', `opencode completion failed: ${detail}`, {
    cause: err,
    details: { reason: 'opencode', ...(sessionId === undefined ? {} : { sessionID: sessionId }) },
  });
}

export function createOpencodeCompletionClient(opts: OpencodeClientOptions): OpencodeCompletionClient {
  const client = new OpencodeClient({
    baseUrl: opts.baseUrl,
    ...(opts.password === undefined ? {} : { password: opts.password }),
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  });

  return {
    async complete(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult> {
      let sessionID: string;
      try {
        const session = await client.createSession({
          ...(opts.directory === undefined ? {} : { directory: opts.directory }),
          title: opts.title ?? 'starling llm completion',
          model: { provider: req.providerID, model: req.modelID },
          ...(opts.agent === undefined ? {} : { agent: opts.agent }),
          ...(req.signal === undefined ? {} : { signal: req.signal }),
        });
        sessionID = session.id;
      } catch (err) {
        throw asLlmError(err);
      }
      if (typeof sessionID !== 'string' || sessionID === '') {
        throw new StarlingError('LLM_ERROR', 'opencode did not return a session id', {
          details: { reason: 'opencode' },
        });
      }

      try {
        const text = await client.generate(sessionID, {
          prompt: composePrompt(req.system, req.prompt),
          ...(opts.directory === undefined ? {} : { directory: opts.directory }),
          ...(req.signal === undefined ? {} : { signal: req.signal }),
        });

        const info = await client.sessionInfo(
          sessionID,
          req.signal === undefined ? {} : { signal: req.signal },
        );
        if (info.tokens === undefined) {
          throw new StarlingError('LLM_ERROR', 'opencode session is missing token usage', {
            details: { reason: 'opencode', sessionID },
          });
        }
        return { text, usage: toUsage(info.tokens) };
      } catch (err) {
        throw asLlmError(err, sessionID);
      } finally {
        try {
          await client.deleteSession(sessionID);
        } catch (err) {
          opts.onCleanupError?.(err);
        }
      }
    },
  };
}
