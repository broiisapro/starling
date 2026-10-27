/**
 * Feature lane: "built by the flock" — the About page (Epic 68).
 *
 * Props-only: `AboutPage` takes a `SwarmStats` and never reads a store or fetches. The JSON is
 * produced by `bun tools/stats/collect.ts` (`tools/stats/out/stats.json`) and the same shape is what
 * the landing site (Epic 59) reads from `site/data/stats.json`. Shell routing (`?page=about`) is
 * Epic 41's; this module deliberately only exports the page.
 */
export const FEATURE = 'about' as const;

export { AboutPage } from './AboutPage';
export { BigNumbers } from './BigNumbers';
export { EpicTable } from './EpicTable';
export { FIXTURE_STATS } from './fixture';
// Formatters and the story are exported for tests and for Epic 59's landing page.
export {
  EMPTY,
  formatClock,
  formatCount,
  formatDuration,
  formatHours,
  formatSigned,
  formatTimestamp,
  handbackLabel,
} from './format';
export { SourceNotes } from './SourceNotes';
export { swarmStory } from './story';
export {
  BAR_HEIGHT,
  ROW_HEIGHT,
  shortTitle,
  TIMELINE_GUTTER,
  TIMELINE_WIDTH,
  type TimelineBar,
  type TimelineLayout,
  type TimelineRow,
  type TimelineTick,
  timelineLayout,
  WAVE_COLORS,
  waveLabel,
} from './timeline';
export type {
  AboutPageProps,
  EpicStats,
  HandbackStatus,
  StatsSources,
  SwarmStats,
  SwarmTotals,
  WaveStats,
} from './types';
export { SUPPORTED_STATS_VERSION } from './types';
