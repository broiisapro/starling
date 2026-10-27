/**
 * `@starling/auditor` — Starling's quality gate.
 *
 * Deterministic checks (lane, non-empty, tests, missing-tests, optional lint) plus a reviewer-model
 * verdict against the task's definition of done, merged into one `AuditVerdict` with actionable fix
 * instructions. `model-choice.ts` maps a routing profile to the model that reviews (Epic 44).
 */
export const PACKAGE = '@starling/auditor' as const;

export { createAuditor } from './auditor';
export type { CommandEvaluation, CommandMode, CommandPolicy } from './command-policy';
export {
  DEFAULT_ALLOWED_COMMANDS,
  DEFAULT_COMMAND_POLICY,
  evaluateCommand,
  isSecretEnvName,
  resolveCommandPolicy,
  scrubbedEnv,
} from './command-policy';
export type { CommandResult } from './commands';
export {
  COMMAND_OUTPUT_TAIL_CHARS,
  describeCommand,
  runShellCommand,
  tailText,
} from './commands';
export type {
  DiffBlock,
  DiffSignals,
  MissingTestsSignal,
  PrioritisedDiff,
} from './diff';
export {
  diffSignals,
  dodTestRequirements,
  isBehaviourPath,
  isTestPath,
  missingTestsSignal,
  prioritiseDiff,
  signalsFor,
  splitDiff,
  TEST_PATH_GLOBS,
} from './diff';
export type { ExplainedCheck, VerdictExplanation } from './explain';
export {
  CHECK_LABELS,
  DETAIL_TAIL_CHARS,
  explainVerdict,
  formatVerdictExplanation,
} from './explain';
export type { CanonicalLanePath, LaneCheckResult, LanePathProblem } from './lane';
export { canonicalLanePath, checkLane, isBookkeepingPath, STARLING_BOOKKEEPING_GLOBS } from './lane';
export type {
  AuditorLlmMode,
  AuditorModelChoice,
  AuditorModelOptions,
  AuditorProfile,
  EnvSource,
} from './model-choice';
export {
  AUDITOR_PROFILES,
  chooseAuditorModel,
  createLlmFor,
  DEFAULT_AUDITOR_PROFILE,
  defaultLlmMode,
  localAuditorModel,
  OPENCODE_AUDITOR_MODEL,
  parseAuditorProfile,
  probeOllamaModel,
  RECOMMENDATION_PATH,
  RECOMMENDED_LOCAL_AUDITOR_MODEL,
} from './model-choice';
export type { AuditPromptArgs } from './prompt';
export { AUDITOR_SYSTEM_PROMPT, buildAuditPrompt } from './prompt';
export type {
  AuditorLlmOption,
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
export {
  buildFixInstructions,
  buildSummary,
  makeCheck,
  missingTestsDetail,
} from './verdict';
