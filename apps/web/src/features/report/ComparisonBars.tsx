import { formatDuration } from '../../lib/format';
import { barWidth, comparisonCaption, speedupLabel } from './format';
import type { FlightReport } from './types';

export interface ComparisonBarsProps {
  report: FlightReport;
  reducedMotion?: boolean;
}

/**
 * The argument the whole project is making, in two bars: one agent doing every task in turn versus
 * the flock overlapping them. The serial bar is derived (see `buildFlightReport`) and says so.
 */
export function ComparisonBars({ report, reducedMotion = false }: ComparisonBarsProps) {
  const scale = Math.max(report.serialMs, report.wallMs, 1);
  const flockWidth = barWidth(report.wallMs, scale, 2);
  const motion = reducedMotion ? '' : 'transition-[width] duration-700 ease-out';

  return (
    <section
      data-testid="report-comparison"
      aria-labelledby="report-comparison-title"
      className="rounded-[var(--radius-panel)] border border-hairline bg-panel px-4 py-4 print:break-inside-avoid print:border-slate-300 print:bg-white print:text-slate-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2
            id="report-comparison-title"
            className="text-heading font-semibold text-ink-1 print:text-slate-900"
          >
            One agent vs the flock
          </h2>
          <p className="mt-0.5 text-caption text-ink-3 print:text-slate-600">
            Same plan, same tasks: sequential work is an estimate from the run&apos;s own timings.
          </p>
        </div>
        <p
          className="font-mono text-title font-semibold tabular-nums text-teal-200 print:text-teal-800"
          data-testid="report-speedup"
        >
          {speedupLabel(report)}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Bar
          label="One agent"
          estimate
          value={formatDuration(report.serialMs)}
          width="100%"
          tone="bg-slate-500/70 print:bg-slate-500"
          motion={motion}
        />
        <Bar
          label="The flock"
          value={formatDuration(report.wallMs)}
          width={flockWidth}
          tone="bg-teal-400/80 print:bg-teal-600"
          motion={motion}
        />
      </div>

      <p className="mt-2 text-caption text-ink-3 print:text-slate-600">{comparisonCaption(report)}</p>
    </section>
  );
}

interface BarProps {
  label: string;
  estimate?: boolean;
  value: string;
  width: string;
  tone: string;
  motion: string;
}

function Bar({ label, estimate = false, value, width, tone, motion }: BarProps) {
  const name = estimate ? `${label} (estimate)` : label;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="text-ink-2 print:text-slate-700">
          {name}
          {estimate ? (
            <span className="ml-1 rounded-[var(--radius-pill)] border border-hairline px-1.5 py-0.5 text-micro text-ink-4 print:border-slate-400 print:text-slate-600">
              estimate
            </span>
          ) : null}
        </span>
        <span className="font-mono tabular-nums text-ink-1 print:text-slate-900">{value}</span>
      </div>
      <div
        role="img"
        aria-label={`${name}: ${value}`}
        className="mt-1 h-3 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-3/70 print:bg-slate-200"
      >
        <div className={`h-full rounded-[var(--radius-pill)] ${tone} ${motion}`} style={{ width }} />
      </div>
    </div>
  );
}
