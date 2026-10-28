/** Props shared by every L39 feature manifest, plus the palette's own structural types. */
import type { SkyState } from '../../data/reducer';

export type { PaletteCommand, PaletteFeature } from './items';

/**
 * The shell-facing prop contract (ARCHITECTURE §8 / L39). Deliberately identical to the other Wave 3
 * manifests so `ComponentType<FeatureProps>` is an honest cast.
 */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}
