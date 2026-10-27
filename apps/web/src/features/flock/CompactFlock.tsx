import type { TaskRun } from '@starling/core';
import { Plus } from 'lucide-react';
import { cx } from './cx';
import { formatLatency, isHub, modelLabel, relativeTime } from './format';
import type { JoinInfo } from './handshake';
import { STATUS_PALETTE } from './palette';
import { useCopy } from './use-copy';
import type { PresenceEntry } from './use-presence';

export interface CompactFlockProps {
  entries: PresenceEntry[];
  tasks: Record<string, TaskRun>;
  join?: JoinInfo;
  now: number;
  reducedMotion: boolean;
}

function tasksOn(tasks: Record<string, TaskRun>, nodeId: string): number {
  return Object.values(tasks).filter((task) => task.nodeId === nodeId).length;
}

/**
 * Narrow-dock mode: one row, one chip per roost, plus the "add a laptop" tile. Enough to answer
 * "who is in the flock and who has room?" without taking the width a card grid needs.
 */
export function CompactFlock({ entries, tasks, join, now, reducedMotion }: CompactFlockProps) {
  const { state, copy } = useCopy();
  const command = join?.command ?? '';

  return (
    <section
      data-testid="flock-panel"
      data-compact="true"
      aria-label="The flock"
      className="rounded-xl border border-white/10 bg-slate-950/40 p-1.5 text-slate-100"
    >
      <ul
        data-testid="compact-flock"
        className="flex items-stretch gap-1 overflow-x-auto"
        aria-label="Roosts"
      >
        {entries.map(({ node, leaving }) => {
          const tone = STATUS_PALETTE[node.status];
          const onRoost = tasksOn(tasks, node.id);
          return (
            <li
              key={node.id}
              data-testid="compact-roost"
              data-node-id={node.id}
              data-status={node.status}
              data-leaving={leaving}
              title={`${node.name} · ${tone.label} · ${node.activeSessions}/${node.maxSessions} sessions · ${formatLatency(node.latencyMs)}`}
              className={cx(
                'flex min-w-0 shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5',
                tone.card,
                node.status === 'offline' && 'opacity-50 saturate-50',
                !reducedMotion && 'transition-all duration-300',
                leaving && 'opacity-0',
              )}
            >
              <span
                data-testid="compact-status-dot"
                data-status={node.status}
                className="relative inline-flex h-1.5 w-1.5 items-center justify-center"
              >
                {node.status === 'busy' && !reducedMotion ? (
                  <span
                    className={cx('absolute h-1.5 w-1.5 animate-ping rounded-full opacity-60', tone.pulse)}
                  />
                ) : null}
                <span className={cx('relative h-1.5 w-1.5 rounded-full', tone.dot)} />
              </span>
              <span
                className={cx(
                  'max-w-[8rem] truncate text-[11px] font-medium',
                  isHub(node) ? 'text-sky-100' : 'text-slate-200',
                )}
              >
                {node.name}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-slate-400">
                {node.activeSessions}/{node.maxSessions}
              </span>
              {onRoost > 0 ? (
                <span
                  data-testid="compact-task-count"
                  className="rounded bg-white/10 px-1 text-[9px] tabular-nums text-slate-300"
                  title={`${onRoost} tasks on this roost`}
                >
                  {onRoost}
                </span>
              ) : null}
              {node.localModels.length > 0 ? (
                <span
                  className="hidden text-[9px] text-sky-300/70 sm:inline"
                  title={node.localModels.map(modelLabel).join(', ')}
                >
                  {node.localModels.length} model{node.localModels.length === 1 ? '' : 's'}
                </span>
              ) : null}
              {node.status === 'offline' ? (
                <span data-testid="compact-last-seen" className="text-[9px] text-slate-500">
                  {relativeTime(node.lastSeen, now)}
                </span>
              ) : null}
            </li>
          );
        })}

        <li className="flex items-center">
          {join ? (
            <button
              type="button"
              data-testid="compact-join"
              data-copy-state={state}
              onClick={() => void copy(command)}
              aria-label="Copy the perch join command"
              className={cx(
                'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1.5 text-[10px] font-medium',
                'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400',
                state === 'copied'
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                  : 'border-sky-400/30 bg-sky-400/5 text-sky-200 hover:bg-sky-400/10',
              )}
            >
              <Plus aria-hidden="true" className="h-3 w-3" />
              {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press ⌘C' : 'Add'}
            </button>
          ) : null}
        </li>
      </ul>
    </section>
  );
}
