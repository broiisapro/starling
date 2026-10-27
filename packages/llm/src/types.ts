/**
 * Local types for the LLM router. The public port (`LLM`) stays exactly as `@starling/core` defines
 * it; these types add the knobs the router needs without changing the locked contract.
 */
import type {
  Clock,
  EventBus,
  LLM,
  LLMRequest,
  LLMResponse,
  StarlingConfig,
  TokenUsage,
} from '@starling/core';
import type { ZodType } from 'zod';

/** Provider families the router knows how to speak. The provider *name* decides (see `router.ts`). */
export type LLMProviderKind = 'openai-compatible' | 'opencode';

export interface OpencodeCompletionRequest {
  system: string;
  prompt: string;
  providerID: string;
  modelID: string;
  signal?: AbortSignal;
}

export interface OpencodeCompletionResult {
  text: string;
  usage: TokenUsage;
}

/**
 * A completion on the user's opencode server (ARCHITECTURE §7 L25).
 *
 * Deliberately tiny: the router only needs one throwaway question and its token usage. The real
 * implementation is `createOpencodeCompletionClient`; tests inject a fake.
 */
export interface OpencodeCompletionClient {
  complete(req: OpencodeCompletionRequest): Promise<OpencodeCompletionResult>;
}

/** Per-call overrides. The `LLM` port has no room for these, so `LLMClient` adds an optional arg. */
export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RetryOptions {
  /** Total attempts, including the first one. */
  maxAttempts: number;
  /** First backoff step; doubles each attempt. */
  baseDelayMs: number;
  /** Upper bound for computed backoff (a server `Retry-After` may go higher up to `maxRetryAfterMs`). */
  maxDelayMs: number;
  /** Cap for a server-provided `Retry-After`, so a broken header cannot park a run for an hour. */
  maxRetryAfterMs: number;
}

export interface LLMOptions {
  /** Injectable for tests and for proxies; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  clock?: Clock;
  bus?: EventBus;
  /** Pre-built opencode client (the runner already owns a server). */
  opencode?: OpencodeCompletionClient;
  retry?: Partial<RetryOptions>;
  /** Per-call timeout; defaults to 120 s. */
  timeoutMs?: number;
  /** Env source for API keys; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * `LLM` plus optional per-call controls.
 *
 * `LLMClient` is assignable to `LLM`, so the engine can keep depending on the port while the CLI,
 * tests and the runner can pass an `AbortSignal` or a shorter timeout.
 */
export interface LLMClient extends LLM {
  complete(req: LLMRequest, opts?: CallOptions): Promise<LLMResponse>;
  completeJson<T>(req: LLMRequest, schema: ZodType<T>, opts?: CallOptions): Promise<LLMResponse<T>>;
}

export interface LLMFromEnvOptions extends LLMOptions {
  /** Skip `loadConfig` (tests, or a host that already parsed config). */
  config?: StarlingConfig;
  cwd?: string;
  configPath?: string;
}
