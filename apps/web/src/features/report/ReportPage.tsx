import { FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../../components';
import type { SkyState } from '../../data/reducer';
import { sortedRuns } from '../../data/selectors';
import { useNow, usePrefersReducedMotion } from '../metrics';
import { ComparisonBars } from './ComparisonBars';
import { buildFlightReport, isRunOver } from './derive';
import { Hero } from './Hero';
import { NodeBars } from './NodeBars';
import { printPage } from './print';
import { StoryTimeline } from './StoryTimeline';
import { TaskChips } from './TaskChips';
import type { FlightReport } from './types';
import { useServerReport } from './use-server-report';
import { VerdictCards } from './VerdictCards';

export interface ReportPageProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  /** C3 passes a fetch that carries the hub token (Epic 110); absent in demo/replay. */
  fetchImpl?: typeof fetch;
  /** Fixed clock for tests and screenshots; live pages tick on their own. */
  now?: number;
}

function runLabel(goal: string, merged: number, total: number, status: string): string {
  const short = goal.length > 52 ? `${goal.slice(0, 52)}…` : goal;
  return `${short} · ${merged}/${total} · ${status}`;
}

/**
 * `?page=report` — the post-run flight report.
 *
 * Props-only and derived from `SkyState`, so the same page works live, in demo mode and on a replayed
 * JSONL file. The optional Epic 111 endpoint is layered on top when the hub is live; every field it
 * does not provide (or provides in a shape this file does not recognise) falls back to the local
 * derivation.
 *
 * Print rules: white background, no controls, panels kept off page breaks. The page is also the
 * projector shot, so the hero deliberately repeats nothing that is below the fold.
 */
export function ReportPage({ state, onSelectTask, onSelectRun, fetchImpl, now: fixedNow }: ReportPageProps) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const runId = picked !== undefined && state.runs[picked] !== undefined ? picked : state.activeRunId;
  const run = runId === undefined ? undefined : state.runs[runId];
  const inFlight = run !== undefined && !isRunOver(run.status);
  const clock = useNow(inFlight && fixedNow === undefined);
  const now = fixedNow ?? clock;

  const local = buildFlightReport(state, runId, now);
  const report = useServerReport(local, {
    enabled: state.connection === 'live',
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  const reducedMotion = usePrefersReducedMotion();
  const runs = sortedRuns(state);

  if (report === undefined) {
    return (
      <main
        data-testid="report-empty"
        aria-labelledby="report-empty-title"
        className="mx-auto flex min-h-[60vh] w-full max-w-5xl items-center justify-center p-6 print:bg-white"
      >
        <EmptyState
          icon={<FileText />}
          title={<span id="report-empty-title">No flight to report yet</span>}
          description="Start a run, replay a recording, or open the demo — the report is written from the run's own events."
        />
      </main>
    );
  }

  return (
    <main
      data-testid="report-page"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 text-body text-ink-1 print:max-w-none print:bg-white print:p-0 print:text-slate-900"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <label className="flex items-center gap-2 text-caption text-ink-3">
          Run
          <select
            data-testid="report-run-select"
            aria-label="Run"
            value={report.runId}
            onChange={(event) => {
              const next = event.target.value;
              setPicked(next);
              onSelectRun?.(next);
            }}
            className="max-w-[26rem] truncate rounded-md border border-hairline-strong bg-surface-3/70 px-2 py-1 text-caption text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {runs.map((candidate) => {
              const merged = Object.values(candidate.tasks).filter((task) => task.status === 'merged').length;
              const total = Math.max(Object.keys(candidate.tasks).length, candidate.plan?.tasks.length ?? 0);
              return (
                <option key={candidate.id} value={candidate.id}>
                  {runLabel(candidate.goal.text, merged, total, candidate.status)}
                </option>
              );
            })}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-micro text-ink-4">
            Every estimate is labelled · cost from the run&apos;s metrics
          </span>
          <button
            type="button"
            data-testid="report-print"
            onClick={() => printPage()}
            className="flex items-center gap-1.5 rounded-md border border-hairline-strong bg-surface-3/70 px-2.5 py-1 text-caption text-ink-2 hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Printer aria-hidden className="h-3.5 w-3.5" />
            Print
          </button>
        </div>
      </header>

      {inFlight ? (
        <p
          data-testid="report-live-note"
          className="rounded-md border border-teal-400/30 bg-teal-400/10 px-3 py-1.5 text-caption text-teal-100 print:hidden"
        >
          Still flying — this report updates live. The numbers below are a snapshot of the run so far.
        </p>
      ) : null}

      <Hero
        report={report}
        {...(run?.integrationBranch === undefined ? {} : { integrationBranch: run.integrationBranch })}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <ComparisonBars report={report} reducedMotion={reducedMotion} />
        <NodeBars nodes={report.nodes} reducedMotion={reducedMotion} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TaskChips
          tasks={run?.tasks ?? {}}
          {...(run?.plan === undefined ? {} : { plan: run.plan })}
          {...(state.selectedTask === undefined ? {} : { selectedTask: state.selectedTask })}
          {...(onSelectTask === undefined ? {} : { onSelectTask })}
        />
        <VerdictCards verdicts={report.verdicts} {...(onSelectTask === undefined ? {} : { onSelectTask })} />
      </div>

      <StoryTimeline
        story={report.story}
        {...(report.summary === undefined ? {} : { summary: report.summary })}
        {...(onSelectTask === undefined ? {} : { onSelectTask })}
      />

      <EstimateNote report={report} />
    </main>
  );
}

/** The honest footnote: which numbers are derived, and from what. */
function EstimateNote({ report }: { report: FlightReport }) {
  const planner = report.estimated.includes('planner-estimate');
  return (
    <p data-testid="report-estimate" className="px-1 text-micro text-ink-4 print:text-slate-500">
      <strong className="font-semibold text-ink-3 print:text-slate-700">estimate</strong> — the serial time is
      the run&apos;s overlap window plus each task&apos;s flight
      {planner ? ', using the planner’s minute estimates because no task timings were recorded' : ''}. Time
      saved and speed-up are derived from it; wall time, cost and local calls are measured.
    </p>
  );
}
