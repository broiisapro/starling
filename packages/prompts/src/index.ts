/**
 * `@starling/prompts` — the `PromptCompiler` port: worker, fixer and resolver prompts, plus the
 * worker handback parser (ARCHITECTURE §8).
 *
 * Everything here is pure and deterministic: no clock, no randomness, no network. The engine
 * compiles a prompt, hands it to an `ExecutionNode`, and later parses the handback block.
 */
export const PACKAGE = '@starling/prompts' as const;

export {
  applySectionBudgets,
  capSections,
  DEFAULT_SECTION_BUDGETS,
  type FitSectionsResult,
  fitSections,
  type SectionId,
  type SectionInput,
  type SectionReport,
  trimMarker,
} from './budget';
export { createPromptCompiler, type ResolverPromptCompiler } from './compiler';
export {
  buildExplainPrompt,
  type ExplainFacts,
  type ExplainFailureFact,
  type ExplainOutcomeFacts,
  type ExplainPrompt,
  type ExplainTaskFact,
  explainFacts,
  renderExplainFacts,
} from './explain';
export { buildFixerPrompt, fixerSections } from './fixer-prompt';
export { handbackInstructions, parseHandback } from './handback';
export type { WorkerHandback } from './handshake';
export { HANDBACK_END, HANDBACK_START, WorkerHandbackSchema } from './handshake';
export type { PromptCompilerOptions, PromptStyle, ResolvedPromptOptions } from './options';
export { DEFAULT_MAX_CHARS, DEFAULT_MAX_REPO_MAP_CHARS, resolveOptions } from './options';
export type { RankedRepoFiles, RenderedRepoMap, RenderRepoMapOptions } from './repo-map';
export { rankRepoFiles, renderRepoMap } from './repo-map';
export {
  buildResolverPrompt,
  conflictingTasks,
  DEFAULT_MAX_HUNK_CHARS,
  type ResolverPromptExtras,
  resolverSections,
} from './resolver-prompt';
export {
  buildRunSummaryPrompt,
  type RunSummaryInput,
  type RunSummaryPrompt,
  renderRunSummaryFacts,
} from './summary';
export { estimateTokens } from './tokens';
export {
  detectInjectionMarkers,
  fenceUntrusted,
  isUntrustedSource,
  neutraliseFenceTags,
  UNTRUSTED_NOTICE,
  UNTRUSTED_SOURCES,
  UNTRUSTED_TAG,
  type UntrustedSource,
} from './untrusted';
export { buildWorkerPrompt, workerSections } from './worker-prompt';
