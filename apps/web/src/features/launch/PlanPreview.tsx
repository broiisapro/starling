import type { Plan, PlanIssue, TaskSpec } from '@starling/core';
import { AlertTriangle, Check, ListTree, Loader2, RefreshCw } from 'lucide-react';
import { Badge, EmptyState, Panel } from '../../components';
import { cn } from '../../lib/cn';
import { overlapReport } from './overlap';
import type { PreviewState } from './types';

export interface PlanPreviewProps {
  state: PreviewState;
  canPreview: boolean;
  /** The current form no longer matches the previewed inputs. */
  stale: boolean;
  onPreview(): void;
}

function Lane({ task }: { task: TaskSpec }) {
  const owns = task.lane.owns.filter((glob) => glob.trim().length > 0);
  if (owns.length === 0) return <span className="text-ink-4">nothing listed</span>;
  const shown = owns.slice(0, 2);
  return (
    <span className="flex flex-wrap gap-1" title={owns.join('\n')}>
      {shown.map((glob) => (
        <code key={glob} className="rounded bg-surface-3/70 px-1 py-0.5 font-mono text-[10px] text-ink-2">
          {glob}
        </code>
      ))}
      {owns.length > shown.length ? (
        <span className="text-[10px] text-ink-4">+{owns.length - shown.length}</span>
      ) : null}
    </span>
  );
}

function Depends({ task }: { task: TaskSpec }) {
  if (task.dependsOn.length === 0) return <span className="text-ink-4">—</span>;
  return (
    <span className="flex flex-wrap gap-1 font-mono text-[10px] text-ink-2">
      {task.dependsOn.map((key) => (
        <span key={key} className="rounded border border-hairline bg-surface-1/70 px-1 py-0.5">
          {key}
        </span>
      ))}
    </span>
  );
}

function Issues({ issues }: { issues: PlanIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul data-testid="launch-plan-issues" className="mt-2 space-y-1">
      {issues.map((issue) => (
        <li
          key={`${issue.code}:${issue.taskKeys.join(',')}:${issue.message}`}
          className={cn(
            'flex items-start gap-1.5 rounded-lg border px-2 py-1 text-caption',
            issue.severity === 'error'
              ? 'border-red-400/30 bg-red-400/10 text-red-100'
              : 'border-amber-400/30 bg-amber-400/10 text-amber-100',
          )}
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0">
            <span className="font-mono text-[10px] opacity-70">{issue.code}</span>
            <span className="ml-1.5">{issue.message}</span>
            {issue.taskKeys.length === 0 ? null : (
              <span className="ml-1.5 font-mono text-[10px] opacity-70">{issue.taskKeys.join(', ')}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanTable({ plan }: { plan: Plan }) {
  const report = overlapReport(plan);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Tasks in the previewed plan, with lanes and dependencies</caption>
        <thead>
          <tr className="border-b border-hairline text-micro tracking-[0.08em] text-ink-4 uppercase">
            <th scope="col" className="py-1 pr-2 font-medium">
              Task
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Lane owns
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Depends on
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Est.
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.tasks.map((task) => (
            <tr
              key={task.key}
              data-testid="launch-plan-task"
              data-task-key={task.key}
              className="border-b border-hairline/50 align-top last:border-b-0"
            >
              <td className="py-1.5 pr-2">
                <span className="block font-mono text-[10px] text-ink-4">{task.key}</span>
                <span className="block text-caption text-ink-1">{task.title}</span>
              </td>
              <td className="py-1.5 pr-2">
                <Lane task={task} />
              </td>
              <td className="py-1.5 pr-2">
                <Depends task={task} />
              </td>
              <td className="py-1.5 text-right font-mono text-[10px] whitespace-nowrap text-ink-3">
                {task.estimateMin} min
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.concurrent.length === 0 ? null : (
        <ul data-testid="launch-overlaps" className="mt-1.5 space-y-0.5">
          {report.concurrent.map((overlap) => (
            <li key={`${overlap.a}-${overlap.b}`} className="font-mono text-[10px] text-rose-200">
              {overlap.a} ↔ {overlap.b}: {overlap.globs.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The plan preview: a compact task table, the overlap check and the validator's issues.
 *
 * The overlap badge is computed from the plan itself (concurrent lane pairs) *and* from the issues
 * the server returned, so it never contradicts the planner. Without `onPreview` the panel explains
 * what is missing instead of pretending to plan.
 */
export function PlanPreview({ state, canPreview, stale, onPreview }: PlanPreviewProps) {
  const ready = state.status === 'ready' ? state : undefined;
  const report = ready === undefined ? undefined : overlapReport(ready.plan, ready.issues);
  const badge =
    report === undefined ? null : report.clear ? (
      <Badge tone="success" icon={<Check aria-hidden="true" className="h-3 w-3" />}>
        Lanes clear
      </Badge>
    ) : report.concurrent.length > 0 ? (
      <Badge
        tone="danger"
        icon={<AlertTriangle aria-hidden="true" className="h-3 w-3" />}
        title="Two tasks that can run at once write overlapping paths"
      >
        {report.concurrent.length} lane {report.concurrent.length === 1 ? 'overlap' : 'overlaps'}
      </Badge>
    ) : (
      <Badge tone="warn" icon={<AlertTriangle aria-hidden="true" className="h-3 w-3" />}>
        {report.errorCount} plan {report.errorCount === 1 ? 'error' : 'errors'}
      </Badge>
    );

  const actions =
    state.status === 'loading' ? (
      <Loader2
        aria-label="Planning"
        className="h-3.5 w-3.5 animate-spin text-ink-3 motion-reduce:animate-none"
      />
    ) : (
      <button
        type="button"
        data-testid="launch-preview-retry"
        onClick={onPreview}
        disabled={!canPreview}
        className="inline-flex items-center gap-1 rounded-md border border-hairline-strong bg-surface-3/60 px-1.5 py-0.5 text-micro font-medium text-ink-2 transition-colors hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RefreshCw aria-hidden="true" className="h-3 w-3" />
        {state.status === 'ready' ? 'Re-plan' : 'Plan'}
      </button>
    );

  return (
    <div data-testid="launch-preview">
      <Panel
        title="Plan preview"
        subtitle={
          ready === undefined
            ? 'See the DAG before anything flies.'
            : `${ready.plan.tasks.length} tasks · ${ready.plan.summary}`
        }
        actions={actions}
        bodyClassName="p-[var(--spacing-panel)]"
        scroll
      >
        {state.status === 'idle' ? (
          <EmptyState
            compact
            icon={<ListTree />}
            title={canPreview ? 'No plan yet' : 'Preview is not wired yet'}
            description={
              canPreview
                ? 'Press "Preview plan" for a dry decomposition: tasks, lanes and the overlap check. Nothing is written.'
                : 'The shell has no preview endpoint yet (Epic 41). You can still release the flock; the plan appears as the run starts.'
            }
            action={
              canPreview ? (
                <button
                  type="button"
                  data-testid="launch-preview-empty"
                  onClick={onPreview}
                  className="rounded-lg border border-hairline-strong bg-surface-3/60 px-2.5 py-1 text-caption font-medium text-ink-2 transition-colors hover:text-ink-1"
                >
                  Preview plan
                </button>
              ) : undefined
            }
          />
        ) : null}

        {state.status === 'loading' ? (
          <div data-testid="launch-preview-loading" aria-busy="true" className="space-y-1.5">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-7 animate-pulse rounded bg-surface-3/50 motion-reduce:animate-none"
              />
            ))}
            <p className="text-caption text-ink-4">Asking the planner for a dry DAG…</p>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <div
            role="alert"
            data-testid="launch-preview-error"
            className="rounded-lg border border-red-400/30 bg-red-400/10 p-2.5"
          >
            <p className="flex items-center gap-1.5 text-caption font-medium text-red-100">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              The planner could not preview this goal
            </p>
            <p className="mt-0.5 break-words font-mono text-[10px] text-red-200/80">{state.message}</p>
            <button
              type="button"
              data-testid="launch-preview-error-retry"
              onClick={onPreview}
              className="mt-1.5 rounded-md border border-red-300/40 bg-red-400/10 px-2 py-0.5 text-micro font-medium text-red-100 hover:bg-red-400/20"
            >
              Try again
            </button>
          </div>
        ) : null}

        {ready === undefined ? null : (
          <div data-testid="launch-preview-ready">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="info">{ready.plan.tasks.length} tasks</Badge>
              <span data-testid="launch-overlap-state">{badge}</span>
              {report !== undefined && report.warnCount > 0 ? (
                <Badge tone="warn">{report.warnCount} warnings</Badge>
              ) : null}
              {stale ? (
                <Badge tone="warn" title="The form changed after this plan was made">
                  inputs changed
                </Badge>
              ) : null}
              <Badge tone="neutral" title="Planner model">
                {ready.plan.model.model}
              </Badge>
            </div>

            <PlanTable plan={ready.plan} />
            <Issues issues={ready.issues} />

            {ready.plan.lockedDecisions.length === 0 ? null : (
              <details className="mt-2 text-caption text-ink-3">
                <summary className="cursor-pointer select-none text-ink-4">
                  Locked decisions ({ready.plan.lockedDecisions.length})
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {ready.plan.lockedDecisions.map((decision) => (
                    <li key={decision}>{decision}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
