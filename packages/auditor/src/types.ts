import type { Clock, EventBus, ExecOptions, ExecResult, LLM } from '@starling/core';
import { z } from 'zod';

/**
 * `typeof exec` from `@starling/core`, restated structurally so tests can inject a fake without
 * importing Bun-spawning production code (`createAuditor({ exec })`).
 */
export type ExecFn = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

/**
 * Reviewer model selection (Epic 44):
 * - an `LLM` instance — used as given;
 * - `'auto'` — resolve it from the routing profile (see `model-choice.ts`) on the first audit;
 * - `'off'` — never call a model, so the verdict is fully deterministic;
 * - omitted — `'auto'` only when `STARLING_LLM_PROFILE`/`STARLING_AUDITOR_PROFILE` is set, else `'off'`.
 */
export type AuditorLlmOption = LLM | 'auto' | 'off';

export interface CreateAuditorOptions {
  /** Reviewer model (role `auditor`), or a routing mode. See `AuditorLlmOption`. */
  llm?: AuditorLlmOption;
  /** Injected command runner; defaults to the core `exec` (ARCHITECTURE L13/L14). */
  exec?: ExecFn;
  /** Injected clock for `AuditVerdict.ts`. */
  clock?: Clock;
  /** Kill the test/lint command after this long. Default 10 minutes. */
  commandTimeoutMs?: number;
  /** When true a failing lint command fails the audit. Default false (advisory). */
  lintBlocking?: boolean;
  /** Diff budget sent to the reviewer. Default 60 000 characters. */
  maxDiffChars?: number;
  /** Where `'auto'` model selection logs its choice and its fallbacks (`log` events). */
  bus?: EventBus;
  /** Override the auditor routing profile (`opencode` | `local` | `mixed`); env wins by default. */
  profile?: string;
  /** Env source for profile/model selection; defaults to `process.env`. Injected by tests. */
  env?: Record<string, string | undefined>;
}

export interface ResolvedAuditorOptions {
  /** Lazy so `createAuditor()` stays synchronous and offline tests never construct a provider. */
  llmFor: () => Promise<LLM | undefined>;
  exec: ExecFn;
  clock: Clock;
  commandTimeoutMs: number;
  lintBlocking: boolean;
  maxDiffChars: number;
}

export const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_DIFF_CHARS = 60_000;

/** Model attached to a verdict that did not consult an LLM. */
export const DETERMINISTIC_MODEL = { provider: 'starling', model: 'deterministic' } as const;

/**
 * The reviewer's JSON verdict. Kept permissive at the schema level (a small local model should not
 * fail the whole audit because it returned an empty `evidence` string); the prompt carries the
 * strict rules and the auditor enforces the pass rule.
 */
export const DodVerdictSchema = z.object({
  item: z.string(),
  met: z.boolean(),
  evidence: z.string(),
});
export type DodVerdict = z.infer<typeof DodVerdictSchema>;

export const AuditorLlmVerdictSchema = z.object({
  pass: z.boolean(),
  summary: z.string(),
  dod: z.array(DodVerdictSchema),
  fixInstructions: z.string().optional(),
});
export type AuditorLlmVerdict = z.infer<typeof AuditorLlmVerdictSchema>;
