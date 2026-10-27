import type { Plan, PlanIssue } from '@starling/core';
import { AlertTriangle, ArrowRight, Bird, Loader2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatDuration, formatUsd } from '../../lib/format';
import { budgetUsedPercent } from './estimate';
import type { OverlapReport } from './overlap';
import type { LaunchInput } from './types';

export interface ConfirmLaunchProps {
  input: LaunchInput;
  plan?: Plan;
  issues?: PlanIssue[];
  overlap?: OverlapReport;
  /** The plan on screen was made from different inputs. */
  previewStale: boolean;
  /** Absent when the shell has no preview endpoint (or the user did not ask). */
  estimateUsd?: number;
  estimateMinutes?: number;
  busy: boolean;
  error?: string;
  onConfirm(): void;
  onCancel(): void;
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline/60 py-1 last:border-b-0">
      <dt className="text-caption text-ink-4">{label}</dt>
      <dd
        className={mono ? 'truncate font-mono text-caption text-ink-1' : 'truncate text-caption text-ink-1'}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The confirm gate: a short, honest summary of what is about to happen and what it may cost.
 *
 * It is an inline region rather than a modal (no focus trap, no portal): the launch panel lives in a
 * dashboard column and the rest of the run stays visible. Focus lands on the confirm button so
 * Enter/space finishes the flow; Escape cancels.
 */
export function ConfirmLaunch({
  input,
  plan,
  issues,
  overlap,
  previewStale,
  estimateUsd,
  estimateMinutes,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmLaunchProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const errors = issues?.filter((issue) => issue.severity === 'error').length ?? 0;
  const warnings = issues?.filter((issue) => issue.severity === 'warn').length ?? 0;
  const concurrent = overlap?.concurrent.length ?? 0;
  const budget = input.budgetUsd ?? 0;
  const used = estimateUsd === undefined ? 0 : budgetUsedPercent(estimateUsd, budget);
  const costLabel =
    estimateUsd === undefined
      ? 'preview to estimate'
      : used >= 100
        ? `${formatUsd(estimateUsd)} — over budget`
        : `${formatUsd(estimateUsd)}${previewStale ? ' (earlier plan)' : ''}`;

  return (
    <section
      data-testid="launch-confirm"
      aria-label="Confirm launch"
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onCancel();
        }
      }}
      className="rounded-xl border border-teal-300/30 bg-teal-400/[0.06] p-[var(--spacing-panel)] text-ink-1"
    >
      <h3 className="flex items-center gap-1.5 text-body font-semibold text-teal-100">
        <Bird aria-hidden="true" className="h-3.5 w-3.5" />
        Ready to release the flock?
      </h3>
      <p className="mt-0.5 text-caption text-ink-3">
        One goal in, a murmuration out. You can stop the run from the dashboard at any time.
      </p>

      <dl className="mt-2">
        <Row label="Goal" value={input.goal} />
        <Row label="Repo" value={input.repoPath} mono />
        <Row label="Agents" value={String(input.maxParallel ?? 'default')} mono />
        <Row label="Budget" value={`${formatUsd(budget)} cap`} mono />
        <Row label="Estimated cost" value={costLabel} mono />
        {estimateMinutes === undefined || estimateMinutes <= 0 ? null : (
          <Row label="Estimated time" value={`~${formatDuration(estimateMinutes * 60_000)}`} mono />
        )}
        <Row label="Mode" value={input.dryRun === true ? 'dry run — plan only' : 'full run'} />
      </dl>

      {input.dryRun === true ? (
        <p className="mt-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-caption text-sky-100">
          Dry run: the flock maps the repo and writes the plan, then stops. Nothing is dispatched and no
          worktree is created.
        </p>
      ) : null}

      {plan !== undefined && estimateUsd !== undefined && used >= 100 ? (
        <p
          data-testid="launch-budget-warning"
          className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-caption text-amber-100"
        >
          The estimate spends {used}% of the budget. The engine stops dispatching when the cap is reached, so
          late tasks may never leave the nest.
        </p>
      ) : null}

      {errors > 0 ? (
        <p
          data-testid="launch-plan-errors"
          className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-caption text-red-100"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            The validator found {errors} {errors === 1 ? 'error' : 'errors'}
            {warnings > 0 ? ` and ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}. The planner gets two
            repair passes; if it still cannot split the goal cleanly this run will fail early.
          </span>
        </p>
      ) : null}

      {concurrent > 0 ? (
        <p
          data-testid="launch-overlap-warning"
          className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-caption text-amber-100"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {concurrent} concurrent lane {concurrent === 1 ? 'overlap' : 'overlaps'} — two agents could write
            the same files. The merge queue will probably ask for a resolver.
          </span>
        </p>
      ) : null}

      {error === undefined ? null : (
        <p
          role="alert"
          data-testid="launch-error"
          className="mt-2 rounded-lg border border-red-400/40 bg-red-400/10 px-2.5 py-1.5 text-caption text-red-100"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          ref={confirmRef}
          type="button"
          data-testid="launch-confirm-button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-teal-300/60 bg-teal-400/25 px-3 py-2 text-caption font-semibold text-teal-50 transition-colors hover:bg-teal-400/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {busy ? 'Releasing…' : 'Yes, release the flock'}
        </button>
        <button
          type="button"
          data-testid="launch-cancel"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface-3/60 px-3 py-2 text-caption font-medium text-ink-2 transition-colors hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Not yet
        </button>
      </div>
      <p className="mt-1.5 text-caption text-ink-4">Escape backs out. The form keeps what you typed.</p>
    </section>
  );
}
