import type { TaskRun } from '@starling/core';
import { LayoutGrid, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from './cx';
import { formatLatency, isHub, modelLabel, relativeTime } from './format';
import type { JoinInfo } from './handshake';
import { STATUS_PALETTE } from './palette';
import { RoostCard } from './RoostCard';
import { useCopy } from './use-copy';
import type { PresenceEntry } from './use-presence';

export interface CompactFlockProps {
  entries: PresenceEntry[];
  tasks: Record<string, TaskRun>;
  join?: JoinInfo;
  now: number;
  reducedMotion: boolean;
  onSelectTask?(taskKey: string): void;
}

function tasksOn(tasks: Record<string, TaskRun>, nodeId: string): number {
  return Object.values(tasks).filter((task) => task.nodeId === nodeId).length;
}

/**
 * Narrow-dock mode: one row, one chip per roost, plus the "add a laptop" tile. Enough to answer
 * "who is in the flock and who has room?" without taking the width a card grid needs.
 *
 * On a 720p laptop the rail is ~15rem wide, so the row cannot show hardware, session meters, lent
 * models or task chips. Rather than widen the rail, "All roosts" opens a drawer with the real roost
 * cards — the same components as the projector layout, including clickable task chips.
 */
export function CompactFlock({ entries, tasks, join, now, reducedMotion, onSelectTask }: CompactFlockProps) {
  const { state, copy } = useCopy();
  const command = join?.command ?? '';
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

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
                  'max-w-[8rem] truncate text-[12px] font-medium',
                  isHub(node) ? 'text-sky-100' : 'text-slate-100',
                )}
              >
                {node.name}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-slate-300">
                {node.activeSessions}/{node.maxSessions}
              </span>
              {onRoost > 0 ? (
                <span
                  data-testid="compact-task-count"
                  className="rounded bg-white/10 px-1 text-[12px] tabular-nums text-slate-200"
                  title={`${onRoost} tasks on this roost`}
                >
                  {onRoost}
                </span>
              ) : null}
              {node.localModels.length > 0 ? (
                <span
                  className="hidden text-[12px] text-sky-200 sm:inline"
                  title={node.localModels.map(modelLabel).join(', ')}
                >
                  {node.localModels.length} model{node.localModels.length === 1 ? '' : 's'}
                </span>
              ) : null}
              {node.status === 'offline' ? (
                <span data-testid="compact-last-seen" className="text-[12px] text-slate-400">
                  {relativeTime(node.lastSeen, now)}
                </span>
              ) : null}
            </li>
          );
        })}

        <li className="flex items-center gap-1">
          <button
            type="button"
            data-testid="compact-expand"
            aria-expanded={drawerOpen}
            aria-controls="starling-flock-drawer"
            onClick={() => setDrawerOpen((open) => !open)}
            title="Show every roost as a full card"
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[12px] font-medium text-slate-100 transition-colors hover:border-white/30 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <LayoutGrid aria-hidden="true" className="h-3.5 w-3.5" />
            All roosts
            <span className="tabular-nums text-slate-300">{entries.length}</span>
          </button>

          {join ? (
            <button
              type="button"
              data-testid="compact-join"
              data-copy-state={state}
              onClick={() => void copy(command)}
              aria-label="Copy the perch join command"
              className={cx(
                'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1.5 text-[12px] font-medium',
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

      {drawerOpen ? (
        <div
          id="starling-flock-drawer"
          role="dialog"
          aria-label="All roosts"
          data-testid="flock-drawer"
          className="fixed inset-x-2 bottom-14 z-50 max-h-[72vh] overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-slate-950/98 p-3 shadow-[0_32px_96px_-32px_rgba(0,0,0,0.9)] backdrop-blur"
        >
          <header className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sky-300/80">
                the flock
              </p>
              <h3 className="text-sm font-semibold text-slate-50">
                {entries.length} {entries.length === 1 ? 'roost' : 'roosts'} in this run
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close all roosts"
              className="rounded-md border border-slate-700 p-1 text-slate-300 hover:border-slate-500 hover:text-slate-100"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </header>

          <div className="grid gap-2 sm:grid-cols-2">
            {entries.map(({ node, leaving }) => (
              <RoostCard
                key={node.id}
                node={node}
                tasks={tasks}
                now={now}
                reducedMotion={reducedMotion}
                leaving={leaving}
                onSelectTask={onSelectTask}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
