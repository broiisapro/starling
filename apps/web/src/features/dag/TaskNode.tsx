import type { TaskRun, TaskSpec } from '@starling/core';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
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

// A type alias (not an interface) so it satisfies React Flow's `Record<string, unknown>` data bound.
export type TaskNodeData = {
  spec: TaskSpec;
  run?: TaskRun;
  /** Shared clock from DagView so all cards agree on "now" and one interval drives them all. */
  now: number;
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
  const { spec, run, now } = data;
  const status = run?.status ?? 'pending';
  const meta = statusMeta(status);
  const elapsed = elapsedFor(run, now);
  const [hovered, setHovered] = useState(false);
  const label = nodeLabel(run);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals a tooltip; React Flow's node wrapper owns click and keyboard
    <div
      className={`relative w-[232px] rounded-lg border px-3 py-2 text-left shadow-lg shadow-slate-950/40 transition-colors ${meta.card} ${
        selected ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950' : ''
      }`}
      data-testid={`task-node-${spec.key}`}
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-slate-950 !bg-slate-500" />

      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${meta.text}`}
        >
          <StatusIcon meta={meta} status={status} />
          {meta.label}
        </span>
        <code className="rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
          {spec.key}
        </code>
      </div>

      <p className="mt-1.5 truncate text-[13px] font-medium leading-tight text-slate-100" title={spec.title}>
        {shortTitle(spec.title)}
      </p>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
        <span
          className="inline-flex max-w-[88px] items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono"
          title={`node: ${label}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        <span title={`${run?.attempts ?? 0} attempt(s)`}>↻ {run?.attempts ?? 0}</span>
        <span title="elapsed">
          <span aria-hidden="true">⏱</span> {formatElapsed(elapsed)}
        </span>
      </div>

      {hovered ? (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[280px] rounded-md border border-slate-700 bg-slate-950/95 p-2.5 text-left shadow-xl"
          role="tooltip"
          data-testid={`lane-tooltip-${spec.key}`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lane · owns</p>
          <ul className="mt-1 space-y-0.5">
            {spec.lane.owns.map((glob) => (
              <li key={glob} className="font-mono text-[11px] leading-snug text-sky-300">
                {glob}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-slate-950 !bg-sky-500" />
    </div>
  );
}
