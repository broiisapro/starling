import { Badge, Stat } from '../../components';
import { formatDuration, formatTokens, formatUsd, percent } from '../../lib/format';
import { costLabel, OUTCOME_COPY, savedLabel, tasksLabel, tokenTotal } from './format';
import type { FlightReport } from './types';

const TONE_BADGE = {
  success: 'success',
  warn: 'warn',
  danger: 'danger',
  accent: 'info',
  neutral: 'neutral',
} as const;

export interface HeroProps {
  report: FlightReport;
  integrationBranch?: string;
}

/**
 * The projector shot: did it land, how long did it take, what did it cost, what did open weights
 * save. Every estimate says "estimate" with a tooltip rather than hiding behind a number.
 */
export function Hero({ report, integrationBranch }: HeroProps) {
  const copy = OUTCOME_COPY[report.outcome];
  const landed = percent(report.tasks.merged, report.tasks.total);
  const apiTokens = tokenTotal(report.tokens.api);
  const localTokens = tokenTotal(report.tokens.local);

  return (
    <section
      data-testid="report-hero"
      aria-labelledby="report-title"
      className="rounded-[var(--radius-panel)] border border-hairline bg-panel px-5 py-5 shadow-[var(--shadow-panel)] print:break-inside-avoid print:border-slate-300 print:bg-white print:text-slate-900 print:shadow-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-medium uppercase tracking-[0.2em] text-ink-3 print:text-slate-500">
            Flight report · {report.status}
          </p>
          <h1
            id="report-title"
            data-testid="report-outcome"
            className="mt-1 text-hero font-semibold tracking-tight text-ink-1 print:text-slate-900"
          >
            {copy.headline}
          </h1>
          <p className="mt-1 max-w-3xl text-body text-ink-2 print:text-slate-700">{copy.line}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span data-testid="report-outcome-badge">
            <Badge tone={TONE_BADGE[copy.tone]}>{report.outcome}</Badge>
          </span>
          {integrationBranch !== undefined ? (
            <Badge tone="neutral" title="Integration branch">
              {integrationBranch}
            </Badge>
          ) : null}
        </div>
      </div>

      <p
        data-testid="report-goal"
        className="mt-3 max-w-4xl text-caption leading-relaxed text-ink-3 print:text-slate-700"
      >
        {report.goal}
      </p>

      <p
        data-testid="report-hero-tasks"
        className="mt-3 font-mono text-title font-semibold tabular-nums text-emerald-200 print:text-emerald-800"
      >
        {tasksLabel(report)}
        <span className="ml-2 text-caption font-normal text-ink-4 print:text-slate-500">
          {report.tasks.failed} failed · {report.tasks.conflict} conflict
          {report.tasks.inFlight > 0 ? ` · ${report.tasks.inFlight} in flight` : ''}
        </span>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline pt-3 sm:grid-cols-3 lg:grid-cols-6 print:border-slate-300">
        <div data-testid="report-stat-landed">
          <Stat
            label="Landed"
            value={`${report.tasks.merged}/${report.tasks.total}`}
            hint={`${landed}% of the plan`}
            tone={report.tasks.merged === report.tasks.total ? 'success' : 'warn'}
          />
        </div>
        <div data-testid="report-stat-wall">
          <Stat
            label="Wall time"
            value={formatDuration(report.wallMs)}
            hint={report.outcome === 'in-flight' ? 'still flying' : 'start to finish'}
          />
        </div>
        <div data-testid="report-stat-saved">
          <Stat
            label="Time saved"
            value={savedLabel(report.savedMs)}
            hint="estimate"
            tone={report.savedMs >= 0 ? 'success' : 'warn'}
          />
        </div>
        <div data-testid="report-stat-cost">
          <Stat label="API spend" value={costLabel(report)} hint={`${formatTokens(apiTokens)} tokens`} />
        </div>
        <div data-testid="report-stat-local">
          <Stat
            label="Saved by local"
            value={formatUsd(report.savedUsd)}
            hint={`${report.localCalls} local call${report.localCalls === 1 ? '' : 's'}`}
            tone="accent"
          />
        </div>
        <div data-testid="report-stat-tokens">
          <Stat
            label="Local tokens"
            value={formatTokens(localTokens)}
            hint={`${formatTokens(report.tokens.api.cached)} cached API`}
          />
        </div>
      </div>
    </section>
  );
}
