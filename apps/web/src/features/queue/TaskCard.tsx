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
 * One compact row: status dot, task key, and whatever the column needs (attempts, node, elapsed,
 * merge ordinal, short sha, or the terminal status).
 *
 * Deliberately **one line** rather than a two-line card: the strip is a fixed 12 rem tall in the
 * shell, and at 14 px type a two-line card only left room for a single visible card per column.
 * Everything the truncation hides — the title, the node, a failed-merge detail — is in the native
 * tooltip, and the whole row is a button with an accessible name that spells it all out.
 */
export function TaskCard({ card, from, now, selected = false, onSelect }: TaskCardProps) {
  const status = STATUS_STYLE[card.run.status];
  const offset = from === null ? 0 : transitionOffset(from, card.column);
  const elapsed = taskElapsedMs(card.run, now);
  const detail = card.problem?.detail;
  const detailId = `starling-queue-detail-${card.taskKey}`;
  const node = taskNodeLabel(card.run);
  const attempts = card.run.attempts;
  const hasStarted = card.run.startedAt !== undefined;
  // Order of importance inside one row: key, attempt count (or wire number), node/elapsed, merge
  // sha / terminal status / blocked reason.
  const tooltipParts = [card.title === card.taskKey ? undefined : card.title, detail];
  if (node !== undefined) tooltipParts.push(`on ${node}`);
  if (hasStarted) tooltipParts.push(`${formatDuration(elapsed)} elapsed`);
  if (card.commit !== undefined) tooltipParts.push(`merged as ${card.commit}`);
  const tooltip = tooltipParts.filter((part): part is string => part !== undefined).join(' — ');

  const nameParts = [card.taskKey, status.label];
  if (card.column === 'wire' && card.wireIndex !== undefined)
    nameParts.push(`number ${card.wireIndex} on the wire`);
  if (card.commit !== undefined) nameParts.push(`merged as ${card.commit}`);
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
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] transition-colors hover:border-sky-300/40 hover:bg-white/[0.08] focus-visible:border-sky-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/40 ${
        selected
          ? 'border-sky-400/80 bg-sky-400/10 ring-1 ring-sky-400/50'
          : 'border-white/[0.08] bg-white/[0.035]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${status.dot}${card.commit !== undefined ? ' land-flash' : ''}`}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-slate-100">
        {card.taskKey}
      </span>

      {attempts > 0 && card.column !== 'wire' ? (
        <span
          className={`shrink-0 rounded border px-1 text-[12px] tabular-nums leading-4 ${status.chip}`}
          title={`attempt ${attempts}`}
        >
          ×{attempts}
        </span>
      ) : null}

      {card.column === 'wire' && card.wireIndex !== undefined ? (
        <span className="shrink-0 text-[12px] tabular-nums leading-4 text-emerald-300">
          #{card.wireIndex}
        </span>
      ) : null}

      {card.column !== 'wire' && node !== undefined ? (
        <span
          className={`hidden max-w-[5.5rem] truncate rounded border px-1 text-[12px] uppercase leading-4 tracking-wide xl:inline-block ${NEUTRAL_CHIP}`}
          title={node}
        >
          {node}
        </span>
      ) : null}

      {card.column !== 'wire' && hasStarted && card.column !== 'grounded' ? (
        <span
          className="hidden shrink-0 text-[12px] tabular-nums leading-4 text-slate-400 sm:inline"
          title="elapsed"
        >
          {formatDuration(elapsed)}
        </span>
      ) : null}

      {card.column === 'wire' && card.commit !== undefined ? (
        // The sha is proof, not identity: in a six-column board the task key must win the width. It
        // stays in the accessible name, the tooltip and the DOM (hidden) so nothing is lost.
        <span className="sr-only">merged as {card.commit}</span>
      ) : null}

      {card.column === 'grounded' ? (
        <span className={`shrink-0 text-[12px] font-medium leading-4 ${status.text}`}>{status.label}</span>
      ) : null}

      {card.waitingReason === 'blocked' ? (
        <span
          className="max-w-[4.5rem] shrink-0 truncate text-[12px] leading-4 text-slate-400"
          title={waitingLabel(card)}
        >
          blocked
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
