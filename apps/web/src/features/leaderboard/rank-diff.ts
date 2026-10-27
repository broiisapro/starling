import type { Board } from './derive';

/**
 * Rank deltas drive two things in the UI: a FLIP slide (rows animate from their old vertical
 * position to the new one) and a short ▲/▼ badge next to the entry that moved.
 *
 * Everything here is pure; the DOM measurement and the animation live in `Leaderboard.tsx`.
 * Motion is disabled entirely when the user prefers reduced motion — the badge is information, so
 * it still appears, just without the slide.
 */

/** How long a moved entry keeps its ▲/▼ badge. */
export const RANK_BADGE_MS = 2_000;

/** FLIP slide duration and easing (`--ease-flock`, declared in `lib/tokens.pcss`). */
export const FLIP_DURATION_MS = 260;
export const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Composite key: `theme` is a task key in six boards, so the board id is part of the identity. */
export function rankKey(boardId: string, entryKey: string): string {
  return `${boardId}:${entryKey}`;
}

export interface RankChange {
  /** `rankKey(boardId, entryKey)` — the DOM row's `data-rank-key`. */
  key: string;
  boardId: string;
  entryKey: string;
  /** 1-based ranks before and after. */
  from: number;
  to: number;
  /** Positive = moved up (a smaller rank number). */
  delta: number;
}

function indexBoard(boards: Board[]): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const board of boards) {
    const entries = new Map<string, number>();
    board.entries.forEach((entry, position) => {
      entries.set(entry.key, position + 1);
    });
    index.set(board.id, entries);
  }
  return index;
}

/**
 * Which entries moved between two board snapshots, as `rankKey → delta`.
 *
 * Entries that are new (no previous rank) or gone (no next rank) are omitted: a debut has no honest
 * "from" position, and a row that is no longer rendered has nothing to animate.
 */
export function rankChanges(previous: Board[], next: Board[]): Map<string, number> {
  const changes = new Map<string, number>();
  const before = indexBoard(previous);
  const after = indexBoard(next);

  for (const [boardId, entries] of after) {
    const previousEntries = before.get(boardId);
    if (previousEntries === undefined) continue;
    for (const [entryKey, to] of entries) {
      const from = previousEntries.get(entryKey);
      if (from === undefined || from === to) continue;
      changes.set(rankKey(boardId, entryKey), from - to);
    }
  }
  return changes;
}

/** The same information as a list, in board/rank order — handy for aria-live summaries and tests. */
export function rankChangeList(previous: Board[], next: Board[]): RankChange[] {
  const changes: RankChange[] = [];
  const before = indexBoard(previous);
  for (const board of next) {
    const previousEntries = before.get(board.id);
    if (previousEntries === undefined) continue;
    board.entries.forEach((entry, position) => {
      const from = previousEntries.get(entry.key);
      const to = position + 1;
      if (from === undefined || from === to) return;
      changes.push({
        key: rankKey(board.id, entry.key),
        boardId: board.id,
        entryKey: entry.key,
        from,
        to,
        delta: from - to,
      });
    });
  }
  return changes;
}

/** Screen-reader copy for a badge: "up 2 places", "down 1 place". */
export function describeChange(delta: number): string {
  if (delta === 0) return 'holding position';
  const magnitude = Math.abs(delta);
  const places = magnitude === 1 ? '1 place' : `${magnitude} places`;
  return delta > 0 ? `up ${places}` : `down ${places}`;
}

/** The FLIP easing token, read from CSS so the panel follows the design system rather than a copy. */
export function flockEasing(element?: Element | null): string {
  if (typeof globalThis.getComputedStyle !== 'function') return FLIP_EASING;
  const root = element ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (root === undefined || root === null) return FLIP_EASING;
  const value = globalThis.getComputedStyle(root).getPropertyValue('--ease-flock').trim();
  return value === '' ? FLIP_EASING : value;
}

/**
 * FLIP transform for one row: render it at its new spot, then paint it from the old offset.
 * A positive result means the row must start *below* its new position.
 */
export function flipTranslate(previousTop: number, nextTop: number): number {
  if (!Number.isFinite(previousTop) || !Number.isFinite(nextTop)) return 0;
  return previousTop - nextTop;
}
