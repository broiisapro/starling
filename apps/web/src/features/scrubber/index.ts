import type { ComponentType } from 'react';
import { Scrubber } from './Scrubber';
import type { FeatureProps } from './types';

/**
 * `features/scrubber` — the replay timeline (Epic 124).
 *
 * A self-contained Wave 3 feature module: pure marker/geometry maths (`markers.ts`), the reducer-based
 * preview (`derive.ts`), the panel (`Scrubber.tsx`), a controlled playground and the manifest below.
 * C3 mounts it as a `panel`; see `docs/epic-124-web-scrubber.md` for the exact wiring.
 */
export const FEATURE = 'scrubber' as const;

export { createPreviewCache, describeEvent, previewAt, type ScrubPreview } from './derive';
export {
  buildMarkers,
  clampIndex,
  clusterMarkers,
  eventSpan,
  filterMarkers,
  formatScrubTime,
  indexAtOffset,
  indexAtPosition,
  indexAtTime,
  isMarkerVisible,
  lastIndex,
  MARKER_FILTERS,
  MARKER_KINDS,
  type Marker,
  type MarkerCluster,
  type MarkerFilter,
  type MarkerKind,
  markerCategories,
  markerCounts,
  markerOf,
  markerPositions,
  nextFailure,
  nextMarker,
  type PlacedMarker,
  positionOfTime,
  scrubClockLabel,
  scrubValueText,
  timeAtIndex,
  timeAtPosition,
} from './markers';
export { PreviewCard, type PreviewCardProps } from './PreviewCard';
export { MARKER_ICON, MARKER_STYLE, type MarkerStyle } from './palette';
export { Scrubber } from './Scrubber';
export { ScrubberTrack, type ScrubberTrackProps } from './ScrubberTrack';
export type { FeatureProps, ScrubberExtras, ScrubberProps } from './types';

/**
 * Wave 3 manifest (L39). `Component` takes only `FeatureProps`; the scrubber's extras are optional,
 * so the cast is honest and the shell needs no knowledge of them.
 */
export const feature = {
  id: 'scrubber',
  title: 'Replay scrubber',
  description: 'Scrub the recorded run, jump to merges and failures, and preview the story at any moment.',
  kind: 'panel',
  icon: 'Rewind',
  hotkey: '.',
  Component: Scrubber as ComponentType<FeatureProps>,
} as const;
