import type { StarlingEvent } from '@starling/core/browser';
import type { SkyState } from '../../data/reducer';
import type { DemoSpeed } from '../../lib/speed';

/**
 * The Wave 3 feature manifest prop contract (ARCHITECTURE §8 + L39). The shell owns the store; a
 * feature reads it only through this shape and the pure selectors in `data/selectors.ts`.
 */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

/**
 * Additive scrubber props. Every one is optional so the `ComponentType<FeatureProps>` cast in the
 * manifest stays honest: C3 can mount the scrubber with just `{ state }`, and the playground can take
 * full control of the head, the player and the speed.
 */
export interface ScrubberExtras {
  /** Defaults to `state.events` (the active run's log, capped by the reducer). */
  events?: readonly StarlingEvent[];
  /** Current head. Defaults to the end of the log. */
  index?: number;
  playing?: boolean;
  /** 1× / 4× / 16× from `lib/speed`. */
  speed?: DemoSpeed;
  /**
   * Supplying this makes the scrubber **controlled**: it never moves its own head, it asks the parent
   * to. Without it the scrubber is a preview that keeps a local head.
   */
  onSeek?(index: number): void;
  onPlayPause?(playing: boolean): void;
  onSpeedChange?(speed: DemoSpeed): void;
}

export type ScrubberProps = FeatureProps & ScrubberExtras;
