import type { NodeCount } from './derive';

/**
 * How the work was split across the flock. The hub is the roost and sorts first; a serial baseline
 * is shown as one agent even though its synthetic tasks kept their original node ids.
 */

export interface NodeCountsProps {
  a: readonly NodeCount[];
  b: readonly NodeCount[];
  aLabel: string;
  bLabel: string;
  baseline: boolean;
}

export function NodeCounts({ a, b, aLabel, bLabel, baseline }: NodeCountsProps) {
  const ids = [...new Set([...a, ...b].map((row) => row.nodeId))];
  const rows = ids.map((nodeId) => {
    const left = a.find((row) => row.nodeId === nodeId);
    const right = b.find((row) => row.nodeId === nodeId);
    return {
      nodeId,
      name: left?.name ?? right?.name ?? nodeId,
      a: left?.count ?? 0,
      b: right?.count ?? 0,
    };
  });

  if (rows.length === 0) {
    return <p className="px-[var(--spacing-panel)] py-3 text-caption text-ink-4">No tasks assigned yet.</p>;
  }

  return (
    <table
      data-testid="node-counts"
      data-serial={baseline ? 'true' : undefined}
      className="w-full border-collapse text-body"
    >
      <caption className="sr-only">
        Tasks per node for {aLabel} and {bLabel}
      </caption>
      <thead>
        <tr className="text-left text-micro uppercase tracking-[0.08em] text-ink-4">
          <th scope="col" className="px-[var(--spacing-panel)] py-1.5 font-medium">
            Node
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            A
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            B
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.nodeId} data-node={row.nodeId} className="border-t border-hairline">
            <th scope="row" className="px-[var(--spacing-panel)] py-1.5 text-left font-medium text-ink-2">
              {row.name}
              {row.name === row.nodeId ? null : (
                <span className="ml-1 font-mono text-micro text-ink-4">{row.nodeId}</span>
              )}
            </th>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-1">{row.a}</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-1">{row.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
