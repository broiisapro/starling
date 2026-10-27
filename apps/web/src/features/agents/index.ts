/** Feature lane id — kept for the Wave 0 feature-folder smoke test. */
export const FEATURE = 'agents' as const;

/**
 * The agent drawer feature lane.
 *
 * Props-only per ARCHITECTURE §8: the shell (Epic 23) passes the selected task's events, verdicts and
 * diff. Nothing here fetches, edits or writes.
 */
export { ActivityTab, type ActivityTabProps } from './ActivityTab';
export { AgentDrawer } from './AgentDrawer';
export { AuditTab } from './AuditTab';
export { buildTimeline, groupToolCalls, type TimelineEntry, type TimelineTool } from './activity';
export {
  checkDuration,
  type DodEvidence,
  dodTally,
  sortVerdicts,
  splitFixInstructions,
  verdictDod,
} from './audit';
export { DiffTab } from './DiffTab';
export {
  annotateWordDiffs,
  classifyPatchLine,
  type DiffFileView,
  type DiffSegment,
  diffFiles,
  type PatchFile,
  type PatchLine,
  type PatchLineKind,
  type PatchLineView,
  parsePatch,
  wordDiff,
} from './diff';
export { formatClock, formatCost, formatDuration, formatTokens } from './format';
export type { AgentDrawerProps } from './handshake';
export { MarkdownLite } from './MarkdownLite';
export { SpecTab } from './SpecTab';
