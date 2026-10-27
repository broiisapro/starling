/**
 * The §8 handshake lives in `@starling/core` (moved there at checkpoint C1). Epic 47 widens the
 * local view of it with two **optional, feature-detected** props:
 *
 * - `paused` — Epic 40 adds it to core; until that lands the shell may already pass it, so the Sky
 *   reads it here. When paused the rAF loop stops and the last frame stays on screen.
 * - `onFps` — dev/reporting hook so the Playground can print the measured frame rate.
 *
 * Both stay local to this lane, so the feature never needs a coordinated core change.
 */
import type { SkyViewProps as CoreSkyViewProps } from '@starling/core';
import type { SkyAudio } from './sound';

export type SkyViewProps = CoreSkyViewProps & {
  /** Stop the animation loop (the shell hides the Sky behind the DAG, or the tab is inactive). */
  paused?: boolean;
  /** Called about twice a second with the measured frame rate. */
  onFps?(fps: number): void;
  /**
   * Test / embedding seam for the sound engine. The dashboard uses the default WebAudio one; the
   * unit tests pass a stub so they can assert the toggle's persistence without an audio device.
   */
  createAudio?(): SkyAudio;
};
