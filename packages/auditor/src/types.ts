import type { Clock, ExecOptions, ExecResult, LLM } from '@starling/core';
import { z } from 'zod';

/**
 * `typeof exec` from `@starling/core`, restated structurally so tests can inject a fake without
 * importing Bun-spawning production code (`createAuditor({ exec })`).
 */
export type ExecFn = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

export interface CreateAuditorOptions {
  /** Reviewer model (role `auditor`). Without one the verdict is fully deterministic. */
  llm?: LLM;
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
}

export interface ResolvedAuditorOptions {
  llm: LLM | undefined;
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
