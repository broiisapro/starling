/**
 * `@starling/auditor` — Starling's quality gate.
 *
 * Deterministic checks (lane, non-empty, tests, optional lint) plus a reviewer-model verdict against
 * the task's definition of done, merged into one `AuditVerdict` with actionable fix instructions.
 */
export const PACKAGE = '@starling/auditor' as const;

export { createAuditor } from './auditor';
export type { CommandResult } from './commands';
export {
  COMMAND_OUTPUT_TAIL_CHARS,
  describeCommand,
  runShellCommand,
  tailText,
} from './commands';
export type { DiffBlock, DiffSignals, PrioritisedDiff } from './diff';
export {
  diffSignals,
  isBehaviourPath,
  isTestPath,
  prioritiseDiff,
  signalsFor,
  splitDiff,
  TEST_PATH_GLOBS,
} from './diff';
export type { LaneCheckResult } from './lane';
export { checkLane, isBookkeepingPath, STARLING_BOOKKEEPING_GLOBS } from './lane';
export type { AuditPromptArgs } from './prompt';
export { AUDITOR_SYSTEM_PROMPT, buildAuditPrompt } from './prompt';
export type {
  AuditorLlmVerdict,
  CreateAuditorOptions,
  DodVerdict,
  ExecFn,
  ResolvedAuditorOptions,
} from './types';
export {
  AuditorLlmVerdictSchema,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_DIFF_CHARS,
  DETERMINISTIC_MODEL,
  DodVerdictSchema,
} from './types';
export type { FixInstructionInput, SummaryInput } from './verdict';
export { buildFixInstructions, buildSummary, makeCheck } from './verdict';
