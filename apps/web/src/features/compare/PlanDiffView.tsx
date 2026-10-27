import type { Plan, TaskSpec } from '@starling/core/browser';
import { EmptyState } from '../../components';
import { describeChangedFields, diffPlanTasks, type PlanDiffField } from './plan-diff';

/**
 * Task-level plan diff: tasks that appeared, tasks that disappeared, and tasks whose spec moved.
 * Rendered from the two `Plan` snapshots in `state.runs`; no planner import, no server call.
 */

export interface PlanDiffViewProps {
  a?: Plan;
  b?: Plan;
  /** True when B is the synthetic serial baseline (same plan by construction). */
  baseline: boolean;
}

const FIELD_LABEL: Record<PlanDiffField, string> = {
  title: 'title',
  'lane.owns': 'lane owns',
  'lane.reads': 'lane reads',
  dependsOn: 'depends on',
  estimateMin: 'estimate',
  deliverables: 'deliverables',
};

function keys(tasks: readonly TaskSpec[]): string {
  return tasks.map((task) => `${task.key}: ${task.title}`).join(', ');
}

export function PlanDiffView({ a, b, baseline }: PlanDiffViewProps) {
  if (a === undefined && b === undefined) {
    return (
      <div data-testid="plan-diff">
        <EmptyState
          compact
          title="No plans to compare"
          description="Both snapshots predate the planner, so there is no task list yet."
        />
      </div>
    );
  }

  const diff = diffPlanTasks(a, b);
  const identical = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;

  return (
    <div data-testid="plan-diff" className="flex flex-col gap-3 px-[var(--spacing-panel)] py-3 text-body">
      {baseline ? (
        <p className="text-caption text-ink-3">
          The baseline flies the same plan, so this diff is empty by design.
        </p>
      ) : null}
      {identical ? (
        <p data-testid="plan-diff-empty" className="text-caption text-ink-3">
          Plans match — {diff.same.length} task{diff.same.length === 1 ? '' : 's'} with identical specs.
        </p>
      ) : null}

      {diff.added.length > 0 ? (
        <section data-testid="plan-diff-added" aria-label="Tasks added in B">
          <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-emerald-300">
            Added in B · {diff.added.length}
          </h3>
          <p className="mt-1 text-caption text-ink-2">{keys(diff.added)}</p>
        </section>
      ) : null}

      {diff.removed.length > 0 ? (
        <section data-testid="plan-diff-removed" aria-label="Tasks removed in B">
          <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-red-300">
            Removed in B · {diff.removed.length}
          </h3>
          <p className="mt-1 text-caption text-ink-2">{keys(diff.removed)}</p>
        </section>
      ) : null}

      {diff.changed.length > 0 ? (
        <section data-testid="plan-diff-changed" aria-label="Tasks changed in B">
          <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-amber-300">
            Changed · {diff.changed.length}
          </h3>
          <ul className="mt-1 flex flex-col gap-1">
            {diff.changed.map((change) => (
              <li key={change.key} className="text-caption text-ink-2">
                <span className="font-mono text-ink-1">{change.key}</span>
                <span className="text-ink-3"> · {describeChangedFields(change.fields)}</span>
                <span className="sr-only">{change.fields.map((field) => FIELD_LABEL[field]).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-micro text-ink-4">{diff.same.length} unchanged · matched by task key</p>
    </div>
  );
}
