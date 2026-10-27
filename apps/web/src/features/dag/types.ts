import type { DagViewProps } from './handshake';

/**
 * Additive props beyond ARCHITECTURE §8, following the same intersection trick as the flock and
 * metrics panels: `DagView` still satisfies the frozen `DagViewProps`, and the shell can pass the
 * preference it already owns without a contract change.
 *
 * - `reducedMotion` mirrors `SkyViewProps.reducedMotion`: status flashes are removed, not shortened.
 */
export interface DagViewExtras {
  reducedMotion?: boolean;
}

export type DagViewAllProps = DagViewProps & DagViewExtras;
