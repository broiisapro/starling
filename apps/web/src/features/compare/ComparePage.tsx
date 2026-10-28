import type { NodeInfo, Run } from '@starling/core/browser';
import { GitCompareArrows } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, EmptyState, Panel } from '../../components';
import { sortedRuns } from '../../data/selectors';
import { useNow, usePrefersReducedMotion } from '../metrics';
import { useCompareEnhancement } from './api';
import {
  type CompareRow,
  compareStats,
  deltaChip,
  formatMetricValue,
  type NodeCount,
  nodeTaskCounts,
  runStats,
  SERIAL_BASELINE_LABEL,
} from './derive';
import { MetricTable } from './MetricTable';
import { NodeCounts } from './NodeCounts';
import { type BarDatum, PairedBars } from './PairedBars';
import { PlanDiffView } from './PlanDiffView';
import { RunPickers } from './RunPickers';
import {
  BASELINE_VALUE,
  baselineFor,
  type CompareParams,
  defaultSelection,
  isLiveRun,
  runLabel,
} from './selection';
import type { ComparePageProps } from './types';
import { parseCompareParams, pickerValue, writeCompareUrl } from './url';

/** The three headline numbers that get a paired bar. */
function barData(rows: readonly CompareRow[]): BarDatum[] {
  const wanted = new Set<CompareRow['metric']>(['wall', 'apiCost', 'peakParallel']);
  return rows
    .filter((row) => wanted.has(row.metric))
    .map((row) => ({
      id: row.metric as BarDatum['id'],
      label: row.label,
      format: row.format,
      a: row.a,
      b: row.b,
    }));
}

function namesOf(nodes: Record<string, NodeInfo>): Record<string, string> {
  const names: Record<string, string> = {};
  for (const node of Object.values(nodes)) names[node.id] = node.name;
  return names;
}

function serialNodeCount(run: Run): NodeCount[] {
  return [{ nodeId: 'serial', name: 'one agent, serial', count: Object.keys(run.tasks).length }];
}

/**
 * `?page=compare&a=<runId>&b=<runId>` — two runs side by side.
 *
 * Props-only: the shell (C3) passes `state` from the store. Everything is derived from the `Run`
 * snapshots, so the page works in demo mode with the recorded fixture, compares a lone run against
 * its serial baseline, and only optionally asks `/api/compare` for numbers when the hub is live.
 */
export function ComparePage({
  state,
  onSelectRun,
  fetchImpl,
  search,
  historyTarget,
  locationTarget,
  now: fixedNow,
}: ComparePageProps) {
  const runs = useMemo(() => sortedRuns(state), [state]);
  const [params, setParams] = useState<CompareParams>(() =>
    parseCompareParams(search ?? globalThis.location?.search ?? ''),
  );
  const selection = useMemo(
    () => defaultSelection(runs, state.activeRunId, params),
    [runs, state.activeRunId, params],
  );

  const live =
    selection !== undefined &&
    (isLiveRun(selection.a) || (selection.b !== undefined && isLiveRun(selection.b)));
  const tickingNow = useNow(live);
  const now = fixedNow ?? tickingNow;
  const reducedMotion = usePrefersReducedMotion();

  const baselineRun = useMemo(
    () => (selection === undefined ? undefined : baselineFor(selection, now)),
    [selection, now],
  );
  const localA = useMemo(
    () => (selection === undefined ? undefined : runStats(selection.a, now)),
    [selection, now],
  );
  const localB = useMemo(
    () => (baselineRun === undefined ? undefined : runStats(baselineRun, now)),
    [baselineRun, now],
  );

  const remote = useCompareEnhancement({
    aId: selection?.a.id,
    bId: selection?.b?.id,
    enabled: state.connection === 'live' && selection !== undefined && selection.b !== undefined,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });

  const aStats = remote?.a ?? localA;
  const bStats = remote?.b ?? localB;
  const rows =
    remote?.rows ?? (aStats !== undefined && bStats !== undefined ? compareStats(aStats, bStats) : []);

  const names = useMemo(() => namesOf(state.nodes), [state.nodes]);

  if (selection === undefined) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-5" data-testid="compare-page">
        <Panel title="Compare two runs">
          <EmptyState
            icon={<GitCompareArrows aria-hidden="true" />}
            title="Nothing to compare yet"
            description="Launch a run, or open the dashboard in demo mode to see the recorded launch-day run against its serial baseline."
          />
        </Panel>
      </main>
    );
  }

  const a = selection.a;
  const bRun = selection.b;
  const baseline = selection.baseline;
  const bLabel = baseline ? SERIAL_BASELINE_LABEL : `Run B · ${runLabel(bRun ?? a)}`;
  const bId = baseline ? undefined : bRun?.id;
  const wallRow = rows.find((row) => row.metric === 'wall');
  const headline = wallRow === undefined ? undefined : deltaChip(wallRow);
  const aNodes = nodeTaskCounts(a, names);
  const bNodes = baseline ? serialNodeCount(a) : bRun === undefined ? [] : nodeTaskCounts(bRun, names);

  const history = historyTarget ?? globalThis.history;
  const location = locationTarget ?? globalThis.location;

  const changeA = (id: string): void => {
    const nextB = pickerValue(bRun?.id, baseline) === id ? BASELINE_VALUE : pickerValue(bRun?.id, baseline);
    writeCompareUrl(id, nextB, history, location);
    setParams({ a: id, b: nextB });
  };
  const changeB = (value: string): void => {
    writeCompareUrl(a.id, value, history, location);
    setParams({ a: a.id, b: value });
  };

  return (
    <main
      aria-labelledby="compare-title"
      data-testid="compare-page"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-5 text-body text-ink-1"
    >
      <header className="rounded-xl border border-hairline bg-panel px-4 py-4 shadow-[var(--shadow-panel)]">
        <p className="text-micro uppercase tracking-[0.2em] text-teal-300">Compare</p>
        <h1 id="compare-title" className="mt-1 text-title font-semibold tracking-tight text-ink-1">
          Two runs, side by side
        </h1>
        <p className="mt-1 max-w-3xl text-caption leading-relaxed text-ink-2">
          {headline === undefined || isSameChip(headline) ? (
            <>Duration, cost, parallelism, fixes and the plan diff — read from the run snapshots.</>
          ) : (
            <>
              {headline.winner === 'a' ? 'A' : 'B'} is{' '}
              <span className="font-semibold text-ink-1">{headline.text} faster</span> on wall clock
              {wallRow !== undefined
                ? ` (${formatMetricValue(wallRow.format, wallRow.a)} vs ${formatMetricValue(wallRow.format, wallRow.b)})`
                : ''}
              .
            </>
          )}
        </p>
        {baseline ? (
          <p data-testid="compare-baseline-note" className="mt-2 text-caption text-amber-200">
            Estimated baseline: one agent, one task at a time. Labelled synthetic, never recorded.
          </p>
        ) : null}
        {live ? (
          <p data-testid="compare-live-note" className="mt-2 text-caption text-sky-200">
            Live run — numbers will move until it lands.
          </p>
        ) : null}
        {selection.notice !== undefined ? (
          <p data-testid="compare-notice" className="mt-2 text-caption text-amber-200">
            {selection.notice}
          </p>
        ) : null}
      </header>

      <RunPickers
        runs={runs}
        a={a}
        {...(bRun === undefined ? {} : { b: bRun })}
        baseline={baseline}
        aNodes={aNodes.length}
        bNodes={bNodes.length}
        onPickA={changeA}
        onPickB={changeB}
        {...(onSelectRun === undefined ? {} : { onSelectRun })}
      />

      <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Numbers" subtitle="Delta is A against B; the arrow says which side is better.">
          <div className="px-2 py-1">
            <MetricTable
              rows={rows}
              aLabel={runLabel(a)}
              bLabel={baseline ? SERIAL_BASELINE_LABEL : runLabel(bRun ?? a)}
            />
          </div>
        </Panel>

        <Panel title="Shape" subtitle="Wall clock, API cost and peak parallelism.">
          <div className="px-[var(--spacing-panel)] py-3">
            {rows.length === 0 ? (
              <p className="text-caption text-ink-4">Waiting for both snapshots…</p>
            ) : (
              <PairedBars
                bars={barData(rows)}
                aLabel={runLabel(a)}
                bLabel={baseline ? 'serial baseline' : runLabel(bRun ?? a)}
              />
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.35fr]">
        <Panel title="Per node" subtitle="Which roost flew which task.">
          <NodeCounts a={aNodes} b={bNodes} aLabel={runLabel(a)} bLabel={bLabel} baseline={baseline} />
        </Panel>

        <Panel
          title="Plan diff"
          subtitle={
            baseline
              ? 'Same plan on both sides'
              : bRun === undefined
                ? 'No second plan yet'
                : 'Matched by task key'
          }
          actions={baseline ? <Badge tone="warn">same plan</Badge> : undefined}
        >
          <PlanDiffView a={a.plan} b={baseline ? a.plan : bRun?.plan} baseline={baseline} />
        </Panel>
      </div>

      <p className="px-1 text-micro text-ink-4">
        Compare link:{' '}
        <span className="font-mono text-ink-3">
          ?a={a.id}&amp;b={bId ?? 'baseline'}
        </span>
      </p>
    </main>
  );
}

/** A tiny guard so the header can stay one sentence in every edge case. */
function isSameChip(chip: ReturnType<typeof deltaChip>): boolean {
  return chip.winner === 'same';
}
