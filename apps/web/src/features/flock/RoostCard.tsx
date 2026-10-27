import type { NodeInfo, TaskRun } from '@starling/core';
import { Laptop, Radio } from 'lucide-react';
import { cx } from './cx';
import { formatHardware, formatLatency, isHub, relativeTime } from './format';
import { ModelChips } from './ModelChips';
import { HUB_BADGE, PERCH_BADGE, STATUS_PALETTE } from './palette';
import { SessionMeter } from './SessionMeter';
import { TaskChips } from './TaskChips';
import { useEntered } from './use-entered';

export interface RoostCardProps {
  node: NodeInfo;
  tasks: Record<string, TaskRun>;
  now: number;
  reducedMotion: boolean;
  /** Rendered only to play the exit transition after the node disappeared. */
  leaving?: boolean;
  onSelectTask?(taskKey: string): void;
}

export function tasksForNode(tasks: Record<string, TaskRun>, nodeId: string): TaskRun[] {
  return Object.values(tasks)
    .filter((task) => task.nodeId === nodeId)
    .sort((a, b) => a.taskKey.localeCompare(b.taskKey));
}

/** One roost: a machine in the flock, its capacity, its models, and the birds it is carrying. */
export function RoostCard({
  node,
  tasks,
  now,
  reducedMotion,
  leaving = false,
  onSelectTask,
}: RoostCardProps) {
  const tone = STATUS_PALETTE[node.status];
  const hub = isHub(node);
  const entered = useEntered(reducedMotion);
  const onRoost = tasksForNode(tasks, node.id);
  const offline = node.status === 'offline';

  return (
    <article
      data-testid="roost-card"
      data-node-id={node.id}
      data-status={node.status}
      data-leaving={leaving}
      data-dimmed={offline}
      data-animated={!reducedMotion}
      aria-label={`${node.name}, ${hub ? 'hub' : 'perch'}, ${tone.label}`}
      className={cx(
        'relative overflow-hidden rounded-xl border bg-gradient-to-b from-white/[0.055] to-white/[0.015] p-3.5',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]',
        tone.card,
        hub && 'ring-1 ring-sky-400/20',
        offline && 'opacity-50 saturate-50',
        reducedMotion ? undefined : 'transition-all duration-300 ease-out motion-reduce:transition-none',
        !reducedMotion && !entered && !leaving ? 'translate-y-2 opacity-0' : undefined,
        leaving ? 'pointer-events-none scale-[0.98] opacity-0' : undefined,
      )}
    >
      <span aria-hidden="true" className={cx('absolute inset-x-0 top-0 h-px', tone.accent)} />

      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid="status-dot"
            data-status={node.status}
            className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
          >
            {node.status === 'busy' && !reducedMotion ? (
              <span
                data-testid="status-pulse"
                className={cx('absolute h-2.5 w-2.5 animate-ping rounded-full opacity-70', tone.pulse)}
              />
            ) : null}
            <span className={cx('relative h-2.5 w-2.5 rounded-full', tone.dot)} />
          </span>
          <h3 className="truncate text-sm font-semibold text-slate-100" title={node.name}>
            {node.name}
          </h3>
          <span
            data-testid="kind-badge"
            className={cx(
              'inline-flex shrink-0 items-center gap-1 rounded border px-1 py-px text-[12px] font-semibold uppercase tracking-[0.12em]',
              hub ? HUB_BADGE : PERCH_BADGE,
            )}
          >
            {hub ? (
              <Laptop aria-hidden="true" className="h-2.5 w-2.5" />
            ) : (
              <Radio aria-hidden="true" className="h-2.5 w-2.5" />
            )}
            {hub ? 'hub' : 'perch'}
          </span>
        </div>
        <span
          data-testid="latency"
          title="Round-trip latency to the hub"
          className="shrink-0 font-mono text-[12px] tabular-nums text-slate-300"
        >
          {formatLatency(node.latencyMs)}
        </span>
      </header>

      <p data-testid="hardware" className="mt-1 truncate text-[12px] text-slate-300">
        {formatHardware(node)}
        <span className={cx('ml-2 font-medium uppercase tracking-wide', tone.text)}>{tone.label}</span>
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[12px] uppercase tracking-[0.12em] text-slate-400">sessions</span>
        <SessionMeter active={node.activeSessions} max={node.maxSessions} status={node.status} />
      </div>

      <div className="mt-2 border-t border-white/5 pt-2">
        <ModelChips models={node.localModels} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] uppercase tracking-[0.12em] text-slate-400">on roost</span>
        <TaskChips tasks={onRoost} onSelectTask={onSelectTask} />
      </div>

      {offline ? (
        <p
          data-testid="last-seen"
          className="mt-2 flex items-center gap-1 text-[12px] text-slate-300"
          title={new Date(node.lastSeen).toISOString()}
        >
          last seen {relativeTime(node.lastSeen, now)}
          {node.url ? <span className="truncate text-slate-400">· {node.url}</span> : null}
        </p>
      ) : null}
    </article>
  );
}
