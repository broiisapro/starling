import { Crown, Trophy } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Kbd } from '../../components';
import { cn } from '../../lib/cn';
import { usePrefersReducedMotion } from '../metrics';
import { BirdAvatar } from './BirdAvatar';
import { type Board, type BoardEntry, buildBoards } from './derive';
import {
  describeChange,
  FLIP_DURATION_MS,
  flipTranslate,
  flockEasing,
  RANK_BADGE_MS,
  rankChanges,
  rankKey,
} from './rank-diff';
import type { LeaderboardAllProps } from './types';

const NO_CHANGES: ReadonlyMap<string, number> = new Map();

/**
 * The flock leaderboard: six playful boards over the active run's snapshots.
 *
 * Props-only (the shell passes `SkyState`), no fetching, no store access. Ranks reorder live; a row
 * that moved gets a 2 s ▲/▼ badge and — unless the user prefers reduced motion — a FLIP slide from
 * its old position. The panel never scrolls the page: the board strip scrolls horizontally inside
 * itself, which keeps a 720p projector layout intact.
 */
export function Leaderboard({ state, onSelectTask, reducedMotion, badgeMs }: LeaderboardAllProps) {
  const prefersReduced = usePrefersReducedMotion();
  const motionOff = reducedMotion ?? prefersReduced;
  const boards = useMemo(() => buildBoards(state), [state]);
  const [badges, setBadges] = useState<ReadonlyMap<string, number>>(NO_CHANGES);
  const previousBoards = useRef<Board[] | undefined>(undefined);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rootRef = useRef<HTMLElement | null>(null);
  const previousTops = useRef<Map<string, number>>(new Map());
  const badgeWindow = Math.max(0, badgeMs ?? RANK_BADGE_MS);

  useEffect(() => {
    const previous = previousBoards.current;
    previousBoards.current = boards;
    // First paint has no "before": a debut is not a move.
    if (previous === undefined) return;
    const changes = rankChanges(previous, boards);
    if (changes.size === 0) return;
    setBadges(new Map(changes));
    if (badgeTimer.current !== undefined) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(() => {
      badgeTimer.current = undefined;
      setBadges(NO_CHANGES);
    }, badgeWindow);
  }, [boards, badgeWindow]);

  useEffect(
    () => () => {
      if (badgeTimer.current !== undefined) clearTimeout(badgeTimer.current);
    },
    [],
  );

  // FLIP: the DOM is already at the new order when a layout effect runs, so measuring there gives the
  // new top and the saved map gives the old one. Happy-dom reports zero rects, so tests see no moves.
  // `rowKeys` is a real dependency, not a stand-in for `boards`: pruning keys that left the strip keeps
  // the map from growing across a long run (and makes the effect re-run when the order changes).
  const rowKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const board of boards) {
      for (const entry of board.entries) keys.add(rankKey(board.id, entry.key));
    }
    return keys;
  }, [boards]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const previous = previousTops.current;
    const nextTops = new Map<string, number>();
    for (const row of root.querySelectorAll<HTMLElement>('[data-rank-key]')) {
      const key = row.dataset.rankKey;
      if (key === undefined) continue;
      const top = row.getBoundingClientRect().top;
      const previousTop = previous.get(key);
      if (!motionOff && previousTop !== undefined && typeof row.animate === 'function') {
        const shift = flipTranslate(previousTop, top);
        if (Math.abs(shift) > 0.5) {
          row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], {
            duration: FLIP_DURATION_MS,
            easing: flockEasing(root),
          });
        }
      }
      nextTops.set(key, top);
    }
    for (const key of [...previous.keys()]) {
      if (!rowKeys.has(key)) previous.delete(key);
    }
    for (const [key, top] of nextTops) previous.set(key, top);
  }, [rowKeys, motionOff]);

  const birdCount = useMemo(() => {
    const keys = new Set<string>();
    for (const board of boards) {
      for (const entry of board.entries) if (entry.nodeId === undefined) keys.add(entry.key);
    }
    return keys.size;
  }, [boards]);

  return (
    <section
      ref={rootRef}
      data-testid="leaderboard"
      data-board-count={boards.length}
      data-rank-motion={motionOff ? 'off' : 'on'}
      aria-label="Flock leaderboard"
      className="flex h-full min-h-0 flex-col text-ink-2"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-[var(--spacing-panel)] pb-1 pt-2">
        <p data-testid="leaderboard-summary" className="min-w-0 truncate text-[12px] text-ink-3">
          {boards.length === 0
            ? 'No landings yet'
            : `${boards.length} boards · ${birdCount} birds · honest numbers, no handicaps`}
        </p>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-4">
          <Kbd size="sm">⇧L</Kbd>
          leaderboard
        </span>
      </header>

      {boards.length === 0 ? (
        <EmptyState
          compact
          className="flex-1"
          icon={<Trophy aria-hidden="true" />}
          title="No birds on the board yet"
          description="Ranks appear as tasks land. Launch a run and watch the flock sort itself out."
        />
      ) : (
        <div
          data-testid="leaderboard-scroll"
          className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-[var(--spacing-panel)] pb-[var(--spacing-panel)]"
        >
          <ol
            data-testid="leaderboard-grid"
            className="grid h-full grid-flow-col auto-cols-[minmax(11.5rem,1fr)] gap-2"
          >
            {boards.map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                changes={badges}
                motionOff={motionOff}
                selectedTask={state.selectedTask}
                onSelectTask={onSelectTask}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

interface BoardCardProps {
  board: Board;
  changes: ReadonlyMap<string, number>;
  motionOff: boolean;
  selectedTask?: string;
  onSelectTask?(key: string): void;
}

function BoardCard({ board, changes, motionOff, selectedTask, onSelectTask }: BoardCardProps) {
  return (
    <li
      data-testid={`board-card-${board.id}`}
      data-board={board.id}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel-strong/55"
    >
      <header className="shrink-0 border-b border-hairline px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <h3 className="truncate text-caption font-semibold text-ink-1">{board.title}</h3>
          <Trophy aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-amber-horizon" />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-3" title={board.blurb}>
          {board.blurb}
        </p>
      </header>
      <ol data-testid={`board-${board.id}`} className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {board.entries.map((entry, index) => (
          <EntryRow
            key={entry.key}
            boardId={board.id}
            entry={entry}
            rank={index + 1}
            delta={changes.get(rankKey(board.id, entry.key))}
            motionOff={motionOff}
            selected={entry.nodeId === undefined && selectedTask === entry.key}
            onSelectTask={onSelectTask}
          />
        ))}
      </ol>
    </li>
  );
}

interface EntryRowProps {
  boardId: string;
  entry: BoardEntry;
  rank: number;
  delta?: number;
  motionOff: boolean;
  selected: boolean;
  onSelectTask?(key: string): void;
}

function EntryRow({ boardId, entry, rank, delta, motionOff, selected, onSelectTask }: EntryRowProps) {
  const selectable = entry.nodeId === undefined && onSelectTask !== undefined;
  const rowClass = cn(
    'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
    selectable && 'hover:bg-surface-3/60 focus-visible:bg-surface-3/60',
    selected && 'bg-teal-400/10 ring-1 ring-teal-400/40',
  );

  const content = (
    <>
      <span className="flex w-6 shrink-0 items-center justify-end gap-0.5">
        {rank === 1 ? (
          <Crown data-testid={`crown-${boardId}`} aria-hidden="true" className="h-3 w-3 text-amber-horizon" />
        ) : null}
        <span className="text-micro font-semibold tabular-nums text-ink-3">{rank}</span>
      </span>
      <BirdAvatar seed={entry.nodeId ?? entry.key} size={18} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{entry.label}</span>
      {delta === undefined ? null : <RankBadge boardId={boardId} entryKey={entry.key} delta={delta} />}
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-1">{entry.display}</span>
    </>
  );

  return (
    <li
      data-testid={`entry-${boardId}-${entry.key}`}
      data-rank-key={rankKey(boardId, entry.key)}
      data-rank={rank}
      data-motion={motionOff ? 'off' : 'on'}
      data-selected={selected ? 'true' : undefined}
      className="min-w-0"
    >
      {selectable ? (
        <button
          type="button"
          className={rowClass}
          aria-current={selected ? 'true' : undefined}
          aria-label={`${entry.label}, ${entry.display}, rank ${rank}`}
          onClick={() => onSelectTask?.(entry.key)}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function RankBadge({ boardId, entryKey, delta }: { boardId: string; entryKey: string; delta: number }) {
  const up = delta > 0;
  return (
    <span
      data-testid={`rank-badge-${boardId}-${entryKey}`}
      title={describeChange(delta)}
      className={cn(
        'shrink-0 font-mono text-[10px] leading-none font-bold',
        up ? 'text-emerald-300' : 'text-rose-300',
      )}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{describeChange(delta)}</span>
    </span>
  );
}
