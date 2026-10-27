import { Badge, EmptyState } from '../../components';
import { formatDuration, formatUsd } from '../../lib/format';
import { barWidth } from './format';
import { maxFlightMs } from './nodes';
import type { NodeContribution } from './types';

export interface NodeBarsProps {
  nodes: NodeContribution[];
  reducedMotion?: boolean;
}

/** Which laptop did what: tasks finished, task time, spend and the migrations in between. */
export function NodeBars({ nodes, reducedMotion = false }: NodeBarsProps) {
  const max = maxFlightMs(nodes);
  const motion = reducedMotion ? '' : 'transition-[width] duration-700 ease-out';

  return (
    <section
      data-testid="report-nodes"
      aria-labelledby="report-nodes-title"
      className="rounded-[var(--radius-panel)] border border-hairline bg-panel px-4 py-4 print:break-inside-avoid print:border-slate-300 print:bg-white print:text-slate-900"
    >
      <h2 id="report-nodes-title" className="text-heading font-semibold text-ink-1 print:text-slate-900">
        Who flew what
      </h2>
      <p className="mt-0.5 text-caption text-ink-3 print:text-slate-600">
        Task time is the sum of each landed task&apos;s flight, so it overlaps across roosts.
      </p>

      {nodes.length === 0 ? (
        <EmptyState compact title="No roosts recorded" description="Flocks appear once a node joins." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {nodes.map((node) => (
            <li key={node.nodeId} data-testid={`report-node-${node.nodeId}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-body text-ink-1 print:text-slate-900">
                  <span className="truncate font-medium">{node.name}</span>
                  <Badge tone={node.nodeId === 'hub' ? 'info' : 'violet'}>
                    {node.nodeId === 'hub' ? 'hub' : 'perch'}
                  </Badge>
                </p>
                <p className="font-mono text-caption tabular-nums text-ink-3 print:text-slate-600">
                  {node.merged}/{node.tasks} landed · {formatDuration(node.flightMs)} ·{' '}
                  {formatUsd(node.costUsd)}
                </p>
              </div>
              <div
                role="img"
                aria-label={`${node.name}: ${node.tasks} tasks, ${formatDuration(node.flightMs)} of task time`}
                className="mt-1 h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-3/70 print:bg-slate-200"
              >
                <div
                  className={`h-full rounded-[var(--radius-pill)] ${node.nodeId === 'hub' ? 'bg-sky-400/80 print:bg-sky-600' : 'bg-violet-400/80 print:bg-violet-600'} ${motion}`}
                  style={{ width: barWidth(node.flightMs, max, 1) }}
                />
              </div>
              {(() => {
                const notes: string[] = [];
                if (node.migratedIn > 0) notes.push(`${node.migratedIn} migrated in`);
                if (node.migratedOut > 0) notes.push(`${node.migratedOut} migrated out`);
                if (node.tasks > node.merged) notes.push(`${node.tasks - node.merged} unfinished`);
                return notes.length === 0 ? null : (
                  <p className="mt-0.5 text-micro text-ink-4 print:text-slate-500">{notes.join(' · ')}</p>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
