import type { SkyState } from '../../data/reducer';

/**
 * Where a step's card sits relative to its anchor. `center` means "no anchor needed": the card is
 * centred in the viewport and the spotlight (if any) is only decoration.
 */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** One page of the guided tour. Copy is short on purpose: a judge reads it over your shoulder. */
export interface TourStep {
  /** Stable id, used by tests and the progress indicator. */
  id: string;
  title: string;
  body: string;
  /**
   * CSS selector for the region this step talks about. Only hooks that already exist in the shell:
   * `[data-region=...]`, the centre-view tablist, and Epic 112's optional `[data-shell="views-menu"]`.
   * A missing anchor always degrades to a centred card, so a selector never has to be invented.
   */
  anchor?: string;
  placement: TourPlacement;
  /** The one side effect a step may have before the spotlight arrives. */
  action?: 'select-first-running-task';
}

/**
 * The manifest contract from the Wave 3 brief (L39). `Tour` reads only these props; the shell maps
 * store → props at checkpoint C3, exactly like the six original panels.
 */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

/**
 * `open` is additive and optional so the `ComponentType<FeatureProps>` cast in the manifest stays
 * honest. The shell decides whether the overlay renders (see `shouldAutoStartTour`); the Playground
 * renders it always.
 */
export interface TourProps extends FeatureProps {
  open?: boolean;
}
