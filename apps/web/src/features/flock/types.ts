import type { FlockPanelProps } from './handshake';

/**
 * Additive props beyond ARCHITECTURE §8. They are all optional so `FlockPanel` still satisfies the
 * frozen `FlockPanelProps` contract; C1 can fold them into core without changing call sites.
 *
 * - `compact` puts every roost on one row for narrow dock panels (an explicit deliverable of E32).
 * - `reducedMotion` mirrors `SkyViewProps.reducedMotion`: the shell owns the user preference.
 * - `now` pins the clock used for "last seen" labels. Replay and the fixture playground need this;
 *   without it a recorded run from last week reads "last seen 9d ago" instead of "12s ago".
 * - `onSelectTask` is the click path for task chips. §8's FlockPanelProps omits it; see the
 *   CONTRACT REQUEST in the E32 handback.
 */
export interface FlockPanelExtras {
  compact?: boolean;
  reducedMotion?: boolean;
  now?: number;
  onSelectTask?(taskKey: string): void;
}

export type FlockPanelAllProps = FlockPanelProps & FlockPanelExtras;
