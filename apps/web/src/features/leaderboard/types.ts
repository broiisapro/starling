import type { SkyState } from '../../data/reducer';

/**
 * Wave 3 feature manifest props (ARCHITECTURE L39). The shell builds these from the store; the
 * feature never reads the store itself.
 */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

/**
 * Additive props beyond the manifest contract. All optional, so `ComponentType<FeatureProps>` stays
 * honest and C3 can cast the component without a wrapper.
 *
 * - `reducedMotion` lets the shell own the preference; absent, the component follows the system query
 *   (same helper the metrics panel uses).
 * - `badgeMs` shortens the ▲/▼ badge window in tests and the playground; production uses
 *   `RANK_BADGE_MS` (2 s).
 */
export interface LeaderboardExtras {
  reducedMotion?: boolean;
  badgeMs?: number;
}

export type LeaderboardAllProps = FeatureProps & LeaderboardExtras;
