import { CostMeter } from './CostMeter';
import { liveElapsedMs, throughputPer10Min } from './cost';
import { formatDuration, formatRate } from './format';
import { useNow, usePrefersReducedMotion } from './hooks';
import { MOTION_CSS } from './motion';
import { SparklineChart } from './SparklineChart';
import { seriesFromHistory } from './sparkline';
import type { MetricsPanelAllProps } from './types';

/**
 * The bottom-right strip: cost meter, agents-active sparkline, merged/failed counters, elapsed clock
 * and throughput. Props-only (ARCHITECTURE §8); the shell feeds it `run.metrics` plus the metrics
 * history it accumulates from `metrics` events.
 *
 * The elapsed clock ticks between samples by interpolating from the newest `metrics` event (see
 * `liveElapsedMs`) and freezes within ~1.5 sample intervals, so a finished run does not keep
 * counting. The whole panel is sized so ticking digits never reflow (tabular numerals + fixed
 * minimum widths on every stat).
 *
 * While the stream is live the money figures count up; on a replay or a scrub they snap to the
 * recorded value, because a judge stepping through events needs exact numbers, not an animation.
 */
export function MetricsPanel({
  metrics,
  history,
  live: liveProp,
  animate: animateProp,
}: MetricsPanelAllProps) {
  const reducedMotion = usePrefersReducedMotion();
  const probe = Date.now();
  const reportedElapsed = metrics?.elapsedMs ?? 0;
  const live =
    liveProp ?? (metrics !== undefined && liveElapsedMs(metrics, history, probe) > reportedElapsed);
  const now = useNow(live);
  const elapsedMs = live ? liveElapsedMs(metrics, history, now) : reportedElapsed;
  const animate = (animateProp ?? live) && !reducedMotion;

  const merged = metrics?.tasksMerged ?? 0;
  const failed = metrics?.tasksFailed ?? 0;
  const throughput = throughputPer10Min(merged, elapsedMs);
  const agentsNow = metrics?.agentsActive ?? 0;

  const agentSeries = seriesFromHistory(history, (sample) => sample.metrics.agentsActive);
  const peakAgents = agentSeries.length === 0 ? 0 : Math.max(...agentSeries);
  const agentLabel =
    agentSeries.length === 0
      ? 'Agents active: no samples yet'
      : `Agents active: ${agentsNow} now, peak ${peakAgents} over ${agentSeries.length} samples`;

  return (
    <section
      aria-labelledby="starling-metrics-title"
      data-starling-motion=""
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-testid="metrics-panel"
      className="rounded-xl border border-white/10 bg-slate-950/60 text-slate-200 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]"
    >
      <style>{MOTION_CSS}</style>

      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-2">
        <h2
          id="starling-metrics-title"
          className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-300"
        >
          Metrics
        </h2>
        <p className="text-[12px] tabular-nums text-slate-400" data-testid="metrics-samples">
          {history.length === 0 ? 'awaiting first sample' : `${history.length} samples`}
        </p>
      </header>

      <div className="flex flex-wrap items-stretch gap-x-5 gap-y-3 px-3 pb-3 pt-1">
        <div className="min-w-[15rem] flex-1">
          <CostMeter metrics={metrics} animate={animate} />
        </div>

        <div className="min-w-[9rem] sm:border-l sm:border-white/5 sm:pl-4">
          <p className="text-[12px] uppercase tracking-[0.1em] text-slate-400">Agents active</p>
          <div className="flex items-end gap-2">
            <span className="text-xl leading-6 tabular-nums text-sky-200" data-testid="metrics-agents">
              {agentsNow}
            </span>
            <SparklineChart
              values={agentSeries}
              label={agentLabel}
              className="h-7 w-24"
              height={28}
              width={96}
            />
          </div>
          <p className="text-[12px] leading-4 tabular-nums text-slate-400">
            peak {peakAgents} · {agentSeries.length} samples
          </p>
        </div>

        <dl className="flex items-start gap-x-5 gap-y-2">
          <Metric label="Merged" value={String(merged)} tone="text-emerald-200" testId="metrics-merged" />
          <Metric
            label="Failed"
            value={String(failed)}
            tone={failed > 0 ? 'text-rose-300' : 'text-slate-300'}
            testId="metrics-failed"
          />
          <Metric
            label="Elapsed"
            value={formatDuration(elapsedMs)}
            tone="text-slate-100"
            testId="metrics-elapsed"
            live={live}
          />
          <Metric
            label="Per 10 min"
            value={formatRate(throughput)}
            tone="text-violet-200"
            testId="metrics-throughput"
          />
        </dl>
      </div>
    </section>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone: string;
  testId: string;
  live?: boolean;
}

function Metric({ label, value, tone, testId, live }: MetricProps) {
  return (
    <div className="min-w-[4.25rem]">
      <dt className="text-[12px] uppercase tracking-[0.1em] text-slate-400">{label}</dt>
      <dd
        className={`min-w-[3.25rem] text-base leading-6 tabular-nums ${tone}`}
        data-testid={testId}
        data-live={live === undefined ? undefined : live ? 'true' : 'false'}
      >
        {value}
      </dd>
    </div>
  );
}
