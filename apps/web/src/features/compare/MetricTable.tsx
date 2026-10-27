import type { CompareRow } from './derive';
import { deltaChip, formatMetricValue } from './derive';

/**
 * The metric table: one row per number, A and B side by side, and a delta chip that never relies on
 * colour alone (▲ / ▼ / = plus the absolute difference and an accessible label).
 */

const CHIP_TONE: Record<'better-a' | 'better-b' | 'same', string> = {
  'better-a': 'border-teal-400/40 bg-teal-400/15 text-teal-200',
  'better-b': 'border-violet-400/40 bg-violet-400/15 text-violet-200',
  same: 'border-hairline bg-surface-2/60 text-ink-3',
};

export interface MetricTableProps {
  rows: readonly CompareRow[];
  aLabel: string;
  bLabel: string;
}

export function MetricTable({ rows, aLabel, bLabel }: MetricTableProps) {
  return (
    <div className="overflow-x-auto">
      <table data-testid="compare-table" className="w-full min-w-[32rem] border-collapse text-body">
        <caption className="sr-only">
          Run comparison: {aLabel} against {bLabel}
        </caption>
        <thead>
          <tr className="text-left text-micro uppercase tracking-[0.08em] text-ink-4">
            <th scope="col" className="px-2 py-1.5 font-medium">
              Metric
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              A
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              B
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              A vs B
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const chip = deltaChip(row);
            return (
              <tr key={row.metric} data-metric={row.metric} className="border-t border-hairline align-middle">
                <th scope="row" className="px-2 py-1.5 text-left font-medium text-ink-2">
                  {row.label}
                </th>
                <td
                  data-testid={`value-a-${row.metric}`}
                  className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-1"
                >
                  {formatMetricValue(row.format, row.a)}
                </td>
                <td
                  data-testid={`value-b-${row.metric}`}
                  className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-1"
                >
                  {formatMetricValue(row.format, row.b)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span
                    data-testid={`delta-${row.metric}`}
                    data-better={row.better}
                    title={chip.label}
                    className={`inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-2 py-0.5 font-mono text-caption tabular-nums ${CHIP_TONE[chip.tone]}`}
                  >
                    <span aria-hidden="true">{chip.arrow}</span>
                    <span>{chip.text}</span>
                    <span className="font-sans text-micro uppercase tracking-[0.06em]">
                      {chip.winner === 'same' ? 'same' : `${chip.winner.toUpperCase()} better`}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
