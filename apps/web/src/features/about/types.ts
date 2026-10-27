/**
 * The About page's data contract.
 *
 * `SwarmStats` is produced by `tools/stats/collect.ts` and read here (and by the landing site,
 * Epic 59, from `site/data/stats.json`). The types are re-exported from the collector so the page
 * and the JSON can never drift; only `type` exports cross the tools/apps boundary, so nothing from
 * `tools/` ends up in the web bundle.
 */
export type {
  EpicStats,
  HandbackStatus,
  StatsSources,
  SwarmStats,
  SwarmTotals,
  WaveKey,
  WaveStats,
} from '../../../../../tools/stats/types.ts';

import type { SwarmStats } from '../../../../../tools/stats/types.ts';

/** The JSON version this page knows how to render. */
export const SUPPORTED_STATS_VERSION = 1;

/** `AboutPage` takes plain data only (no store, no fetching): the shell decides where it comes from. */
export interface AboutPageProps {
  stats: SwarmStats;
}
