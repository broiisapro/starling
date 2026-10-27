/**
 * Policy telemetry.
 *
 * Every self-healing action the engine takes (stall, backoff, budget, cancellation, migration) emits
 * one `log` event with a **stable machine code**, so the dashboard and the CLI can group them without
 * parsing prose. Core's `log` payload is frozen (no `code` field yet), so the code rides along as an
 * additive property — see the FIX REQUEST in `docs/epic-49-robustness.md`.
 */

export type PolicyCode =
  | 'stall.detected'
  | 'stall.retry'
  | 'stall.redispatch'
  | 'stall.failed'
  | 'rate-limit.backoff'
  | 'parallelism.reduced'
  | 'parallelism.increased'
  | 'budget.warn'
  | 'budget.stop'
  | 'budget.skipped'
  | 'cancel.cleanup'
  | 'cancel.forced'
  | 'perch.loss'
  | 'perch.resume';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PolicyLogPayload {
  level: LogLevel;
  msg: string;
  taskKey?: string;
  /** Additive until core's log payload carries it. */
  code: PolicyCode;
}

/** Build the envelope payload for one policy action. Pure, so tests can assert on it directly. */
export function policyLogPayload(
  code: PolicyCode,
  level: LogLevel,
  msg: string,
  taskKey?: string,
): PolicyLogPayload {
  return taskKey === undefined ? { level, msg, code } : { level, msg, taskKey, code };
}

/** A human line that still reads well when a consumer only shows `msg`. */
export function policyMessage(code: PolicyCode, detail: string): string {
  return `[${code}] ${detail}`;
}
