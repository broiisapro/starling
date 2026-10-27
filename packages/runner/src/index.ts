/**
 * @starling/runner — `AgentRunner` implementations.
 *
 * - `createOpencodeRunner`: real agents on one opencode server (v2.1.2).
 * - `createReplayRunner`: recorded `AgentEvent`s with original timing, no model needed.
 *
 * Both implement the `AgentRunner` port from `@starling/core`; nothing here imports a sibling
 * Wave 1 package.
 */
export const PACKAGE = '@starling/runner' as const;

export type { CreateSessionInput, OpencodeClientOptions } from './opencode/client';
export { OpencodeClient, parseRetryAfterMs } from './opencode/client';
export type {
  EventNormalizerOptions,
  NormalizerEmit,
  NormalizerSessionMeta,
} from './opencode/normalize';
export { EventNormalizer } from './opencode/normalize';
export type {
  BucketSnapshot,
  ProviderRateLimiterOptions,
  RateLimitSignal,
} from './opencode/rate-limit';
export {
  annotateRateLimit,
  detectRateLimit,
  looksRateLimited,
  ProviderRateLimiter,
  rateLimitFromError,
} from './opencode/rate-limit';
export type { OpencodeRunner, OpencodeRunnerOptions } from './opencode/runner';
export { createOpencodeRunner } from './opencode/runner';
export type {
  OpencodeActiveSession,
  OpencodeCreateSessionBody,
  OpencodeDataResponse,
  OpencodeEventEnvelope,
  OpencodeServerInfo,
  OpencodeSessionInfo,
  OpencodeTokenUsage,
} from './opencode/types';
export type { ReplayRunner, ReplayRunnerOptions } from './replay';
export { createReplayRunner } from './replay';
export type { ScheduledTask, Scheduler } from './schedule';
export { sleep, timerScheduler } from './schedule';
export { Semaphore } from './semaphore';
export type { SseMessage, SseParser } from './sse';
export { createSseParser, readSse } from './sse';
