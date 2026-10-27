/**
 * opencode completions for the LLM router — the **runner's** V2 client, not a second one.
 *
 * Wave 1 wrote two REST clients (one here, one in `@starling/runner`). Epic 49 kept the runner's
 * and this adapter is now just the LLM-shaped recipe on top of it. Epic 40 added the first step:
 *
 *   stateless generate → (refusal) → create session → generate → read token totals → delete session
 *
 * Why the stateless route first: on opencode 2.1.2 a *session* is a coding agent, and given a
 * planner prompt it starts exploring the workspace and answers `text: ''` — a completion prompt is
 * not a coding task. `POST /api/experimental/generate` is a bare model call (no session, no tools),
 * which is exactly what a structured completion needs. The session path stays as the fallback for
 * servers without the experimental route.
 *
 * `createOpencodeCompletionClient` keeps its public signature, so the router and its tests did not
 * change. See `docs/epic-49-robustness.md` for the unification and
 * `docs/epic-40-integration-captain.md` for the stateless route and the usage gap.
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

/**
 * A completion is a *model call*, not a control-plane request: on opencode 2.1.2 a planner turn took
 * well over the shared client's 10 s default, and the first C2 run died on exactly that
 * ("POST /api/experimental/generate could not be reached" after ~10 s). The router's own timeout is
 * 120 s, so the client must not be the tighter of the two.
 */
const DEFAULT_COMPLETION_TIMEOUT_MS = 120_000;

export { DEFAULT_COMPLETION_TIMEOUT_MS };

/**
 * The stateless route reports no token totals at all (its response schema carries `data.text` and
 * nothing else), so a call on that path has no usage to report. The `LLM` port's `TokenUsage` is
 * three numbers, which leaves two honest options: invent nothing and say so, or invent zeros and
 * stay quiet. This result does the first — `usageKnown: false` marks the totals as *unreported*
 * rather than *zero* — and `router.ts` surfaces it in the per-call log.
 */
const UNREPORTED_USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };

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
    timeoutMs: opts.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS,
  });

  /**
   * One bare model call. `undefined` means "this server will not do it" (older route-less server,
   * refusal, empty envelope) and the caller falls through to the session path; a thrown error means
   * the server could not be reached at all, which is worth a retry rather than a fallback.
   */
  async function stateless(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult | undefined> {
    let text: string | undefined;
    try {
      text = await client.generateStateless({
        prompt: composePrompt(req.system, req.prompt),
        providerID: req.providerID,
        modelID: req.modelID,
        ...(opts.directory === undefined ? {} : { directory: opts.directory }),
        ...(req.signal === undefined ? {} : { signal: req.signal }),
      });
    } catch (err) {
      throw asLlmError(err);
    }
    if (text === undefined) return undefined;
    return { text, usage: UNREPORTED_USAGE, usageKnown: false };
  }

  async function sessionCompletion(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult> {
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
      return { text, usage: toUsage(info.tokens), usageKnown: true };
    } catch (err) {
      throw asLlmError(err, sessionID);
    } finally {
      try {
        await client.deleteSession(sessionID);
      } catch (err) {
        opts.onCleanupError?.(err);
      }
    }
  }

  return {
    async complete(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult> {
      const statelessResult = await stateless(req);
      if (statelessResult !== undefined) return statelessResult;
      return sessionCompletion(req);
    },
  };
}
