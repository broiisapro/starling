import { percent } from '../../lib/format';
import { formatMetricValue, type MetricFormat } from './derive';

/**
 * Paired horizontal bars for the three headline numbers: wall clock, API cost, peak parallelism.
 * Both values are printed next to their bars, so the chart adds shape without hiding the number.
 */

export interface BarDatum {
  id: 'wall' | 'apiCost' | 'peakParallel';
  label: string;
  format: MetricFormat;
  a: number;
  b: number;
}

export interface PairedBarsProps {
  bars: readonly BarDatum[];
  aLabel: string;
  bLabel: string;
}

function widthPercent(value: number, max: number): string {
  return `${percent(value, max)}%`;
}

export function PairedBars({ bars, aLabel, bLabel }: PairedBarsProps) {
  return (
    <div data-testid="paired-bars" className="flex flex-col gap-4">
      <div className="flex items-center gap-4 text-micro uppercase tracking-[0.08em] text-ink-4">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-teal-400" />A · {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-violet-400" />B · {bLabel}
        </span>
      </div>
      {bars.map((bar) => {
        const max = Math.max(bar.a, bar.b, 1);
        return (
          <div key={bar.id} data-testid={`bar-${bar.id}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-caption font-medium text-ink-2">{bar.label}</span>
              <span className="font-mono text-caption tabular-nums text-ink-3">
                {formatMetricValue(bar.format, bar.a)} vs {formatMetricValue(bar.format, bar.b)}
              </span>
            </div>
            <div
              className="flex flex-col gap-1"
              role="img"
              aria-label={`${bar.label}: A ${formatMetricValue(bar.format, bar.a)}, B ${formatMetricValue(bar.format, bar.b)}`}
            >
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2/70">
                <div
                  data-testid={`bar-${bar.id}-a`}
                  className="h-full rounded-full bg-teal-400/80"
                  style={{ width: widthPercent(bar.a, max) }}
                />
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2/70">
                <div
                  data-testid={`bar-${bar.id}-b`}
                  className="h-full rounded-full bg-violet-400/80"
                  style={{ width: widthPercent(bar.b, max) }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
