/**
 * `@starling/llm` — the `LLM` port: role routing, structured output, retries and honest cost.
 *
 * ```ts
 * import { createLLMFromEnv } from '@starling/llm';
 *
 * const llm = createLLMFromEnv();
 * const res = await llm.complete({
 *   role: 'planner',
 *   system: 'You plan lane-safe task DAGs.',
 *   messages: [{ role: 'user', content: 'Goal: add CSV export' }],
 * });
 * console.log(res.text, res.usage, res.model, res.costUsd, res.local);
 * ```
 */
export const PACKAGE = '@starling/llm' as const;

export { costOf, isLocalBaseUrl, pricingKeys } from './cost';
export { createLLMFromEnv } from './env';
export { badJsonError, isBadJsonError, LLM_BAD_JSON, llmError } from './errors';
export type { JsonParseResult } from './json';
export {
  extractJson,
  formatIssues,
  jsonInstruction,
  schemaName,
  stripFences,
  toJsonSchemaSafe,
} from './json';
export type { LLMProfileName } from './profiles';
export {
  applyProfile,
  DEEPSEEK_DEFAULT_MODEL,
  DEFAULT_LLM_PROFILE,
  LLM_PROFILES,
  LOCAL_DEFAULT_MODEL,
  OPENCODE_DEFAULT_MODEL,
  parseProfile,
} from './profiles';
export type { ResponseFormat } from './providers/openai-compatible';
export { supportsJsonSchema } from './providers/openai-compatible';
export type { OpencodeClientOptions } from './providers/opencode';
export { createOpencodeCompletionClient } from './providers/opencode';
export {
  backoffMs,
  DEFAULT_RETRY,
  isRetryableError,
  retryAfterMs,
  sleep,
  statusOf,
  withRetries,
  withTimeout,
} from './retry';
export { createLLM, providerKind, renderConversation, resolveModel, splitOpencodeModel } from './router';
export type {
  CallOptions,
  LLMClient,
  LLMFromEnvOptions,
  LLMOptions,
  LLMProviderKind,
  OpencodeCompletionClient,
  OpencodeCompletionRequest,
  OpencodeCompletionResult,
  RetryOptions,
} from './types';
