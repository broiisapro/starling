import type { CSSProperties } from 'react';

import { formatDuration } from '../metrics/format';
import type { QueueCard, QueueColumnId } from './columns';
import { taskElapsedMs, transitionOffset, waitingLabel } from './columns';
import { taskNodeLabel } from './node-name';
import { NEUTRAL_CHIP, STATUS_STYLE } from './palette';

export interface TaskCardProps {
  card: QueueCard;
  /** Column the card occupied on the previous render, or null when it is new. */
  from: QueueColumnId | null;
  now: number;
  /** Highlighted because another panel (or this card) selected the task. */
  selected?: boolean;
  onSelect(key: string): void;
}

/**
 * One card: status dot, task key, node badge, elapsed, and — on the wire — the merge ordinal and
 * short sha. The whole card is a button so it is keyboard reachable; its accessible name spells out
 * the status, node, attempt count and any unmet dependency, and `aria-describedby` carries the merge
 * failure detail for screen readers (the `title` attribute provides the same text as a native hover
 * tooltip without fighting the columns' scroll container).
 */
export function TaskCard({ card, from, now, selected = false, onSelect }: TaskCardProps) {
  const status = STATUS_STYLE[card.run.status];
  const offset = from === null ? 0 : transitionOffset(from, card.column);
  const elapsed = taskElapsedMs(card.run, now);
  const detail = card.problem?.detail;
  const detailId = `starling-queue-detail-${card.taskKey}`;
  const node = taskNodeLabel(card.run);
  // Cards are deliberately compact, so hover spells out what the truncation hides: the task title,
  // then any failed-merge detail.
  const tooltip = [card.title === card.taskKey ? undefined : card.title, detail]
    .filter((part): part is string => part !== undefined)
    .join(' — ');
  const attempts = card.run.attempts;
  const hasStarted = card.run.startedAt !== undefined;
  const hasFooter =
    node !== undefined ||
    hasStarted ||
    card.commit !== undefined ||
    card.column === 'grounded' ||
    card.waitingReason === 'blocked';

  const nameParts = [card.taskKey, status.label];
  if (card.column === 'wire' && card.wireIndex !== undefined)
    nameParts.push(`number ${card.wireIndex} on the wire`);
  if (attempts > 0 && card.column !== 'wire') nameParts.push(`attempt ${attempts}`);
  if (node !== undefined) nameParts.push(`on ${node}`);
  if (card.waitingReason === 'blocked') nameParts.push(waitingLabel(card));
  const ariaLabel = nameParts.join(', ');

  return (
    <button
      type="button"
      data-starling-card=""
      data-starling-animated=""
      data-arrived={offset === 0 ? 'false' : 'true'}
      data-task-key={card.taskKey}
      data-column={card.column}
      data-selected={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
      style={{ '--starling-from-x': `${offset}px` } as CSSProperties}
      onClick={() => onSelect(card.taskKey)}
      title={tooltip === '' ? undefined : tooltip}
      aria-describedby={detail === undefined ? undefined : detailId}
      aria-label={ariaLabel}
      className={`w-full rounded-lg border bg-white/[0.04] px-2 py-1.5 text-left transition-colors hover:border-sky-300/40 hover:bg-white/[0.08] focus-visible:border-sky-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/40 ${
        selected ? 'border-sky-400/80 bg-sky-400/10 ring-1 ring-sky-400/50' : 'border-white/10'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} />
        <span className="truncate text-sm font-medium leading-5 text-slate-100">{card.taskKey}</span>
        {attempts > 0 && card.column !== 'wire' ? (
          <span
            className={`ml-auto shrink-0 rounded border px-1 py-px text-[12px] tabular-nums leading-4 ${status.chip}`}
            title={`attempt ${attempts}`}
          >
            ×{attempts}
          </span>
        ) : null}
        {card.column === 'wire' && card.wireIndex !== undefined ? (
          <span className="ml-auto shrink-0 text-[12px] tabular-nums leading-4 text-emerald-300">
            #{card.wireIndex}
          </span>
        ) : null}
      </span>

      {hasFooter ? (
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4">
          {node !== undefined ? (
            <span
              className={`max-w-[8rem] truncate rounded border px-1 py-px uppercase tracking-wide ${NEUTRAL_CHIP}`}
              title={node}
            >
              {node}
            </span>
          ) : null}
          {hasStarted ? (
            <span className="tabular-nums text-slate-400" title="elapsed">
              {formatDuration(elapsed)}
            </span>
          ) : null}
          {card.column === 'wire' && card.commit !== undefined ? (
            <span className="ml-auto shrink-0 font-mono text-[12px] text-emerald-300">{card.commit}</span>
          ) : null}
          {card.column === 'grounded' ? (
            <span className={`ml-auto ${status.text}`}>{status.label}</span>
          ) : null}
          {card.waitingReason === 'blocked' ? (
            <span className="ml-auto max-w-[7rem] truncate text-slate-400" title={waitingLabel(card)}>
              blocked
            </span>
          ) : null}
        </span>
      ) : null}

      {detail === undefined ? null : (
        <span id={detailId} className="sr-only">
          {detail}
        </span>
      )}
    </button>
  );
}
