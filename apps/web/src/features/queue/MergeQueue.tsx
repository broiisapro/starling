import type { TaskStatus } from '@starling/core';
import { useEffect, useMemo, useRef } from 'react';

import { useNow, usePrefersReducedMotion } from '../metrics/hooks';
import { MOTION_CSS } from '../metrics/motion';
import type { QueueCard, QueueColumnId } from './columns';
import { buildQueueBoard, QUEUE_COLUMN_META, QUEUE_COLUMNS } from './columns';
import type { MergeQueueProps } from './handshake';
import { TaskCard } from './TaskCard';

/** Any of these means an elapsed clock is worth ticking once a second. */
const ACTIVE_STATUSES: readonly TaskStatus[] = ['running', 'auditing', 'fixing', 'merging'];

/**
 * Cards arriving from another column slide a short distance in the direction they travelled. The
 * custom property carries the offset; the duration lives on `--starling-motion-duration`, which
 * `MOTION_CSS` collapses to 0 ms when the OS asks for reduced motion. No layout is measured, so
 * this costs nothing on a 252-event replay.
 */
const QUEUE_STYLES = `
${MOTION_CSS}
[data-starling-queue] [data-starling-card] {
  transition:
    transform var(--starling-motion-duration) ease-out,
    opacity var(--starling-motion-duration) ease-out,
    background-color 140ms ease-out,
    border-color 140ms ease-out;
}
[data-starling-queue] [data-starling-card][data-arrived='true'] {
  animation: starling-card-arrive var(--starling-motion-duration) cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes starling-card-arrive {
  from { transform: translateX(var(--starling-from-x, 0px)); opacity: 0.35; }
  to { transform: translateX(0px); opacity: 1; }
}
`;

/**
 * The merge queue board: every task in the run, left to right, on its way to the wire.
 *
 * Props-only (ARCHITECTURE §8). The board is derived from `plan` + `tasks` + `merges`, so tasks the
 * engine has not touched yet still appear (from the plan) and tasks that failed to merge keep their
 * `merge.result` detail.
 */
export function MergeQueue({ plan, tasks, merges, onSelectTask }: MergeQueueProps) {
  const board = useMemo(() => buildQueueBoard(plan, tasks, merges), [plan, tasks, merges]);
  const reducedMotion = usePrefersReducedMotion();
  const ticking = useMemo(
    () => Object.values(tasks).some((run) => ACTIVE_STATUSES.includes(run.status)),
    [tasks],
  );
  const now = useNow(ticking);

  // Remember where each card was, so a column change can slide it in from the correct direction.
  const previousColumns = useRef<Record<string, QueueColumnId | undefined>>({});
  const fromColumns: Record<string, QueueColumnId | undefined> = {};
  for (const id of QUEUE_COLUMNS) {
    for (const card of board.columns[id]) fromColumns[card.taskKey] = previousColumns.current[card.taskKey];
  }

  useEffect(() => {
    const next: Record<string, QueueColumnId> = {};
    for (const id of QUEUE_COLUMNS) {
      for (const card of board.columns[id]) next[card.taskKey] = id;
    }
    previousColumns.current = next;
  }, [board]);

  return (
    <section
      aria-labelledby="starling-queue-title"
      data-starling-motion=""
      data-starling-queue=""
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="rounded-xl border border-white/10 bg-slate-950/60 text-slate-200 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
    >
      <style>{QUEUE_STYLES}</style>

      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-2">
        <h2
          id="starling-queue-title"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300"
        >
          Merge queue
        </h2>
        <p className="text-[10px] tabular-nums text-slate-500">
          <span data-testid="queue-landed">
            {board.landed} of {board.total}
          </span>{' '}
          on the wire
          {board.grounded > 0 ? <span className="text-rose-300/80"> · {board.grounded} grounded</span> : null}
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto px-3 pb-3 pt-2">
        {QUEUE_COLUMNS.map((id) => (
          <QueueColumn
            key={id}
            id={id}
            cards={board.columns[id]}
            fromColumns={fromColumns}
            now={now}
            onSelect={onSelectTask}
          />
        ))}
      </div>
    </section>
  );
}

interface QueueColumnProps {
  id: QueueColumnId;
  cards: QueueCard[];
  fromColumns: Record<string, QueueColumnId | undefined>;
  now: number;
  onSelect(key: string): void;
}

function QueueColumn({ id, cards, fromColumns, now, onSelect }: QueueColumnProps) {
  const meta = QUEUE_COLUMN_META[id];
  const headingId = `starling-queue-col-${id}`;

  return (
    <section
      aria-labelledby={headingId}
      data-column-section={id}
      className="flex min-w-[9rem] flex-1 shrink-0 flex-col gap-1.5"
    >
      <div aria-hidden="true" className={`h-0.5 rounded-full opacity-60 ${meta.dot}`} />
      <div className="flex items-baseline justify-between gap-1">
        <h3
          id={headingId}
          className={`flex items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.text}`}
          title={meta.hint}
        >
          {meta.title}
        </h3>
        <span className="text-[10px] tabular-nums text-slate-500">{cards.length}</span>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/5 px-2 py-2 text-[10px] leading-4 text-slate-600">
          {meta.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {cards.map((card) => (
            <li key={card.taskKey}>
              <TaskCard card={card} from={fromColumns[card.taskKey] ?? null} now={now} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
