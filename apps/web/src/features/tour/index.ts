import type { ComponentType } from 'react';
import { Tour } from './Tour';
import type { FeatureProps } from './types';

/** Feature lane id — the Wave 0 smoke test asserts every feature folder exports one. */
export const FEATURE = 'tour' as const;

export type { CardSize, PlacedCard, Rect, RectLike, Viewport } from './geometry';
export { CARD_GAP, placeCard, spotlightRect, VIEWPORT_MARGIN } from './geometry';
export type { MockView, ShellMockProps } from './ShellMock';
export { ShellMock } from './ShellMock';
export {
  drawerTaskKey,
  drawerTaskKeyOf,
  OPTIONAL_ANCHORS,
  orderedTaskKeys,
  requiredAnchors,
  stepById,
  TOUR_STEPS,
} from './steps';
export type { TourSeenRecord, TourStorage, TourStorageInput } from './storage';
export {
  browserStorage,
  hasSeenTour,
  readTourSeen,
  recordTourSeen,
  shouldAutoStartTour,
  TOUR_STORAGE_KEY,
} from './storage';
/**
 * The guided tour (Epic 119).
 *
 * `Tour` is props-only: it reads `SkyState` through `FeatureProps` and never touches the store, the
 * router or the shell's hotkey registry. The shell (C3) wires it and decides whether it opens; the
 * auto-start rule lives here so the URL contract is testable without a browser.
 */
export { TOUR_TOTAL, Tour } from './Tour';
export type { FeatureProps, TourPlacement, TourProps, TourStep } from './types';

/**
 * Wave 3 manifest (L39). C3 imports `feature` and renders `<feature.Component {...props} />` inside
 * the overlay layer. `hotkey: undefined` on purpose: the shell's key map is full, and the tour is
 * reachable from the command palette and the views menu instead.
 */
export const feature = {
  id: 'tour',
  title: 'Guided tour',
  description: 'A sixty-second spotlight tour of the dashboard, anchored to the real UI.',
  kind: 'overlay',
  icon: 'Compass',
  hotkey: undefined,
  Component: Tour as ComponentType<FeatureProps>,
} as const;
