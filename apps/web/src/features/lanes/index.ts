import type { ComponentType } from 'react';
import type { SkyState } from '../../data/reducer';
import { LanesView } from './LanesView';
import type { FeatureProps } from './types';

/**
 * Feature lane: the lanes map (Epic 115) — who owns which files.
 *
 * `LanesView` takes plain props (`SkyState` + `onSelectTask`) and never reads the global store. At
 * C3 the shell renders `feature.Component` from this manifest; until then the Playground below and
 * `?playground=lanes` are how it is seen.
 */
export const FEATURE = 'lanes' as const;

export {
  buildLaneModel,
  buildLaneTree,
  formatLaneSummary,
  globTarget,
  type LaneModel,
  type LaneNode,
  type LaneNodeKind,
  type LaneOverlap,
  type LaneSummary,
  laneOverlapIssues,
  laneOverlaps,
  laneRows,
  primaryLaneOwner,
} from './derive';
export { LanesView, type LanesViewProps } from './LanesView';
export { LaneTable, type LaneTableProps, laneFlags } from './LaneTable';
export {
  type ArrowDirection,
  FRAME_HEADER,
  FRAME_PADDING,
  LANE_VIEW_HEIGHT,
  LANE_VIEW_WIDTH,
  type LaneBox,
  type LaneLayout,
  layoutLanes,
  layoutLaneTree,
  MIN_FRAME_HEIGHT,
  MIN_FRAME_WIDTH,
  nearestTile,
} from './layout';
export {
  CONFLICT_COLOUR,
  colourFor,
  LANE_PALETTE,
  type LaneColours,
  laneColours,
  laneTitles,
  SELECTED_STROKE,
  UNOWNED_COLOUR,
  VIOLATION_COLOUR,
} from './palette';
export { type Rect, squarify, type Tile, tileArea } from './squarify';
export type { FeatureProps, LaneViewMode } from './types';

/**
 * The C3 manifest. `SkyState` is imported as a type only; the cast is the one line that keeps every
 * feature folder interchangeable (`ComponentType<FeatureProps>`), while `LanesView` may still accept
 * its optional `initialMode`.
 */
export const feature = {
  id: 'lanes',
  title: 'Lanes',
  description: 'Who owns which files — lanes, read-only areas, overlaps and conflicts.',
  kind: 'view',
  icon: 'LayoutGrid',
  hotkey: 'l',
  Component: LanesView as ComponentType<FeatureProps>,
} as const;

/** Type-only re-export so the shell can hold `FeatureProps` without importing `./types`. */
export type { SkyState };
