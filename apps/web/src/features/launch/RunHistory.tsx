import type { Run } from '@starling/core';
import { History } from 'lucide-react';
import { Badge, EmptyState, Panel } from '../../components';
import { formatDuration, formatRelative, formatUsd } from '../../lib/format';
import { runHistory } from './history';

export interface RunHistoryProps {
  runs: readonly Run[];
  onOpenRun(id: string): void;
  /** Pin the clock for tests (and recorded demos); defaults to `Date.now()`. */
  now?: number;
}

function RunRow({
  summary,
  now,
  onOpen,
}: {
  summary: ReturnType<typeof runHistory>[number];
  now: number;
  onOpen(): void;
}) {
  const landed = summary.total === 0 ? 'no tasks yet' : `${summary.merged}/${summary.total} landed`;
  return (
    <li>
      <button
        type="button"
        data-testid="launch-history-run"
        data-run-id={summary.id}
        onClick={onOpen}
        aria-label={`Open run: ${summary.goal}`}
        className="group flex w-full flex-col gap-1 rounded-lg border border-hairline bg-surface-1/50 px-2.5 py-2 text-left transition-colors hover:border-sky-300/35 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <span className="flex items-start gap-2">
          <Badge tone={summary.tone}>{summary.statusLabel}</Badge>
          <span className="min-w-0 flex-1 text-caption leading-snug text-ink-1 line-clamp-2">
            {summary.goal}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-4">
          <span className="text-ink-3">{summary.repoName}</span>
          <span aria-hidden="true">·</span>
          <span data-testid="launch-history-progress">{landed}</span>
          {summary.failed > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span data-testid="launch-history-failed" className="text-red-300">
                {summary.failed} failed
              </span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span data-testid="launch-history-cost">{formatUsd(summary.costUsd)}</span>
          <span aria-hidden="true">·</span>
          <span data-testid="launch-history-duration">{formatDuration(summary.durationMs)}</span>
          <span aria-hidden="true">·</span>
          <span title={new Date(summary.startedAt).toISOString()}>
            {formatRelative(summary.startedAt, now)}
          </span>
        </span>
        {summary.planSummary === undefined ? null : (
          <span className="truncate text-[10px] text-ink-4">{summary.planSummary}</span>
        )}
      </button>
    </li>
  );
}

/**
 * Past runs: status, how much landed, what it cost and how long it took. One click opens the run in
 * the rest of the dashboard (`onOpenRun`); the panel keeps no selection state of its own.
 */
export function RunHistory({ runs, onOpenRun, now = Date.now() }: RunHistoryProps) {
  const summaries = runHistory(runs, now);

  return (
    <div data-testid="launch-history">
      <Panel
        title="Past runs"
        subtitle={
          summaries.length === 0
            ? 'Nothing has left the nest yet.'
            : `${summaries.length} runs · newest first`
        }
        scroll
        bodyClassName="p-[var(--spacing-panel)]"
      >
        {summaries.length === 0 ? (
          <EmptyState
            compact
            icon={<History />}
            title="No runs yet"
            description="Release the flock and the first run lands here: goal, status, cost and duration."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {summaries.map((summary) => (
              <RunRow key={summary.id} summary={summary} now={now} onOpen={() => onOpenRun(summary.id)} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
