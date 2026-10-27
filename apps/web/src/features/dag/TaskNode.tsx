import type { TaskRun, TaskSpec } from '@starling/core';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
  Flame,
  GitMerge,
  Loader,
  type LucideIcon,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { elapsedFor, formatElapsed, nodeLabel, shortTitle } from './format';
import { type StatusMeta, statusMeta } from './status';
import { useStatusFlash } from './use-status-flash';

// A type alias (not an interface) so it satisfies React Flow's `Record<string, unknown>` data bound.
export type TaskNodeData = {
  spec: TaskSpec;
  run?: TaskRun;
  /** Shared clock from DagView so all cards agree on "now" and one interval drives them all. */
  now: number;
  /** True when the task sits on the plan's longest dependency chain (see `critical-path.ts`). */
  critical: boolean;
};

export type TaskNodeType = Node<TaskNodeData, 'task'>;

const STATUS_ICON: Record<string, LucideIcon> = {
  pending: Circle,
  ready: CircleDot,
  running: Loader,
  auditing: ShieldCheck,
  fixing: Wrench,
  merging: GitMerge,
  merged: CheckCircle2,
  failed: XCircle,
  conflict: AlertTriangle,
  cancelled: Ban,
};

const SPINNING = new Set(['running', 'fixing']);

function StatusIcon({ meta, status }: { meta: StatusMeta; status: string }) {
  const Icon = STATUS_ICON[status] ?? Circle;
  return (
    <Icon
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 ${meta.text} ${SPINNING.has(status) ? 'animate-spin' : ''}`}
      data-testid={`status-icon-${status}`}
    />
  );
}

export function TaskNode({ data, selected }: NodeProps<TaskNodeType>) {
  const { spec, run, now, critical } = data;
  const status = run?.status ?? 'pending';
  const meta = statusMeta(status);
  const elapsed = elapsedFor(run, now);
  const [hovered, setHovered] = useState(false);
  const flashing = useStatusFlash(status);
  const label = nodeLabel(run);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals a tooltip; React Flow's node wrapper owns click and keyboard
    <div
      className={`relative w-[232px] rounded-lg border px-3 py-2 text-left shadow-lg shadow-slate-950/40 transition-colors ${meta.card} ${
        selected ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950' : ''
      } ${critical ? 'border-amber-300/50' : ''}`}
      data-testid={`task-node-${spec.key}`}
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
      data-critical={critical ? 'true' : 'false'}
      data-flash={flashing ? 'true' : 'false'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-slate-950 !bg-slate-500" />

      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide ${meta.text}`}
        >
          <StatusIcon meta={meta} status={status} />
          {meta.label}
        </span>
        <code className="rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[12px] text-slate-300">
          {spec.key}
        </code>
      </div>

      <p className="mt-1.5 truncate text-sm font-medium leading-tight text-slate-100" title={spec.title}>
        {shortTitle(spec.title)}
      </p>

      <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-400">
        <span
          className="inline-flex max-w-[92px] items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono"
          title={`node: ${label}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        <span className="tabular-nums" title={`${run?.attempts ?? 0} attempt(s)`}>
          ↻ {run?.attempts ?? 0}
        </span>
        <span className="tabular-nums" title="elapsed">
          <span aria-hidden="true">⏱</span> {formatElapsed(elapsed)}
        </span>
        {critical ? (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded border border-amber-300/40 bg-amber-400/15 px-1 py-px text-[12px] font-medium text-amber-200"
            data-testid={`critical-badge-${spec.key}`}
            title={`On the critical path — ${spec.estimateMin} min estimate, the longest chain in the plan`}
          >
            <Flame aria-hidden="true" className="h-3 w-3" />
            critical
          </span>
        ) : null}
      </div>

      {hovered ? (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[300px] rounded-md border border-slate-700 bg-slate-950/95 p-2.5 text-left shadow-xl"
          role="tooltip"
          data-testid={`lane-tooltip-${spec.key}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-300">Lane</p>
            <p className="text-[12px] tabular-nums text-slate-400">est {spec.estimateMin} min</p>
          </div>
          <p className="mt-1.5 text-[12px] font-medium text-emerald-300">owns</p>
          <ul className="mt-0.5 space-y-0.5">
            {spec.lane.owns.map((glob) => (
              <li key={glob} className="break-all font-mono text-[12px] leading-snug text-emerald-200">
                {glob}
              </li>
            ))}
          </ul>
          {spec.lane.reads.length > 0 ? (
            <>
              <p className="mt-1.5 text-[12px] font-medium text-slate-400">reads</p>
              <ul className="mt-0.5 space-y-0.5">
                {spec.lane.reads.map((glob) => (
                  <li key={glob} className="break-all font-mono text-[12px] leading-snug text-slate-300">
                    {glob}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {spec.dependsOn.length > 0 ? (
            <p className="mt-1.5 truncate text-[12px] text-slate-400" title={spec.dependsOn.join(', ')}>
              after {spec.dependsOn.join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-slate-950 !bg-sky-500" />
    </div>
  );
}
