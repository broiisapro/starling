import type { ComponentType } from 'react';
import { Leaderboard } from './Leaderboard';
import type { FeatureProps } from './types';

/** Feature lane id — the folder smoke-test and the manifest registry both read this. */
export const FEATURE = 'leaderboard' as const;

/**
 * Wave 3 feature manifest (ARCHITECTURE L39). C3 registers it once; the shell binds `⇧L`.
 *
 * `L` is capital on purpose: `l` already opens the lanes map, so this one is Shift+L and the shell's
 * registry owns the binding. The component deliberately installs no document-level keydown listener.
 */
export const feature = {
  id: 'leaderboard',
  title: 'Flock leaderboard',
  description: 'Fastest, hungriest, cleanest and most stubborn birds — plus the busiest perch.',
  kind: 'panel',
  icon: 'Trophy',
  hotkey: 'L',
  Component: Leaderboard as ComponentType<FeatureProps>,
} as const;

export {
  AVATAR_EYES,
  AVATAR_PATTERNS,
  AVATAR_WINGS,
  type AvatarEye,
  type AvatarPattern,
  type AvatarSpec,
  type AvatarSpeckle,
  type AvatarWing,
  birdAvatar,
  hashSeed,
  plumageColor,
} from './avatar';
export { BirdAvatar, type BirdAvatarProps } from './BirdAvatar';
export {
  auditDurationMs,
  BOARD_SIZE,
  type Board,
  type BoardEntry,
  type BoardId,
  type BoardUnit,
  buildBoards,
  formatBoardSeconds,
} from './derive';
export { Leaderboard } from './Leaderboard';
export {
  describeChange,
  FLIP_DURATION_MS,
  FLIP_EASING,
  flipTranslate,
  flockEasing,
  RANK_BADGE_MS,
  type RankChange,
  rankChangeList,
  rankChanges,
  rankKey,
} from './rank-diff';
export type { FeatureProps, LeaderboardAllProps, LeaderboardExtras } from './types';
