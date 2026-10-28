/**
 * The command-palette feature lane.
 *
 * `feature` is the L39 manifest the shell's registry collects at checkpoint C3: id, title, kind,
 * icon, hotkey and the component. Everything else here is a pure, exported building block — the
 * fuzzy matcher, the item builders and the recent-pick store — so the palette can be tested and
 * reused without mounting React.
 */
import type { ComponentType } from 'react';
import { CommandPalette } from './CommandPalette';
import type { FeatureProps } from './types';

/** Feature lane id — kept for the Wave 0 feature-folder smoke test. */
export const FEATURE = 'palette' as const;

/**
 * L39 manifest. `kind: 'overlay'` means the shell mounts it above the dashboard; `hotkey: 'mod+k'`
 * is bound by Epic 112's registry, never by this folder (a second document-level listener would
 * double-toggle the palette).
 */
export const feature = {
  id: 'palette',
  title: 'Command palette',
  description: 'Jump to a task, a run or a view — press ⌘K and type a few letters.',
  kind: 'overlay',
  icon: 'Command',
  hotkey: 'mod+k',
  Component: CommandPalette as ComponentType<FeatureProps>,
} as const;

export { CommandPalette, type CommandPaletteProps, RESULT_LIMIT } from './CommandPalette';
export {
  collectItems,
  flattenGroups,
  GROUP_LABELS,
  groupResults,
  type PaletteGroupResult,
  type PaletteSource,
  RESULT_GROUPS,
  rangesFor,
} from './derive';
export {
  type FuzzyMatch,
  fuzzyScore,
  type MatchRange,
  type Rankable,
  type Ranked,
  rankItems,
} from './fuzzy';
export { detectPlatform, formatHotkey, type HotkeyPlatform } from './hotkey';
export { PaletteIcon, type PaletteIconProps } from './icons';
export {
  commandItems,
  featureItems,
  PALETTE_GROUPS,
  type PaletteCommand,
  type PaletteFeature,
  type PaletteFeatureKind,
  type PaletteGroup,
  type PaletteItem,
  recentItems,
  runItems,
  taskItems,
} from './items';
export {
  parseRecent,
  pruneRecent,
  RECENT_KEY,
  RECENT_LIMIT,
  type RecentStorage,
  readRecent,
  recordRecent,
  writeRecent,
} from './recent';
export type { FeatureProps } from './types';
