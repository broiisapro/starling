import type { SkyState } from '../../data/reducer';

/** The manifest shape from Wave 3 L39. One component signature for every new feature folder. */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

export type LaneViewMode = 'map' | 'list';
