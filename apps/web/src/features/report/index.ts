import type { ComponentType } from 'react';
import type { SkyState } from '../../data/reducer';
import { ReportPage } from './ReportPage';

/**
 * Feature lane: the post-run flight report (Epic 113).
 *
 * `?page=report`. Props-only: the shell (Epic 112's registry, wired at C3) hands in `SkyState` and
 * the two callbacks; everything on the page is derived in `derive.ts` from that state, so it works
 * live, in demo mode and from a replayed JSONL file. Nothing here reads the store.
 */
export const FEATURE = 'report' as const;

/** The Wave 3 feature-manifest props (L39). Extra page props stay optional below. */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

export const feature = {
  id: FEATURE,
  title: 'Flight report',
  description: 'What the flock did — outcome, time saved, cost and the story in plain English',
  kind: 'page',
  icon: 'FileText',
  hotkey: 'r',
  Component: ReportPage as ComponentType<FeatureProps>,
} as const;

export { ComparisonBars, type ComparisonBarsProps } from './ComparisonBars';
export {
  buildFlightReport,
  isRunOver,
  moneyFor,
  outcomeOf,
  plannerEstimateMs,
  runSummary,
  taskCounts,
  taskTimings,
} from './derive';
export {
  barWidth,
  beatClock,
  comparisonCaption,
  costLabel,
  OUTCOME_COPY,
  savedLabel,
  speedupLabel,
  tasksLabel,
  tokenTotal,
} from './format';
export { Hero, type HeroProps } from './Hero';
export {
  fetchServerReport,
  mergeServerReport,
  REPORT_TIMEOUT_MS,
  reportEndpoint,
} from './live';
export { NodeBars, type NodeBarsProps } from './NodeBars';
export { nodeContributions } from './nodes';
export { printPage } from './print';
export { ReportPage, type ReportPageProps } from './ReportPage';
export { StoryTimeline, type StoryTimelineProps } from './StoryTimeline';
export { MAX_STORY_BEATS, storyBeats } from './story';
export { TaskChips, type TaskChipsProps } from './TaskChips';
export type {
  FlightOutcome,
  FlightReport,
  FlightTaskCounts,
  NodeContribution,
  NotableVerdict,
  StoryBeat,
  StoryKind,
} from './types';
export type { ServerReportOptions } from './use-server-report';
export { useServerReport } from './use-server-report';
export { VerdictCards, type VerdictCardsProps } from './VerdictCards';
export {
  failedChecks,
  isNotableVerdict,
  notableVerdicts,
  verdictHeadline,
  verdictModel,
} from './verdicts';
