import { Bird, CheckCircle2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Panel } from '../../components';
import { ConfirmLaunch } from './ConfirmLaunch';
import { budgetUsedPercent, estimateMinutes, estimatePlanCostUsd } from './estimate';
import { hasErrors, initialFormValues, requestKey, toLaunchInput, validateForm } from './form';
import { LaunchForm } from './LaunchForm';
import { overlapReport } from './overlap';
import { PlanPreview } from './PlanPreview';
import { RunHistory } from './RunHistory';
import type {
  LaunchFormErrors,
  LaunchFormValues,
  LaunchPanelProps,
  LaunchPhase,
  PreviewState,
} from './types';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  return 'That did not work. The server log has the rest of the story.';
}

interface Launched {
  runId: string;
  goal: string;
}

/**
 * The launch screen: pick a repo, describe the goal, preview the DAG, release the flock, and browse
 * past runs.
 *
 * Props-only (the shell owns the store, the fetch calls and routing). The panel keeps just enough
 * state to protect the user from a mistake — validation errors, a confirm gate with the estimated
 * cost, a stale-preview marker and the launch result — and never talks to a server itself.
 */
export function LaunchPanel({ onLaunch, onPreview, recentRepos, goals, runs, onOpenRun }: LaunchPanelProps) {
  const [values, setValues] = useState<LaunchFormValues>(() => initialFormValues(recentRepos));
  const [errors, setErrors] = useState<LaunchFormErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<LaunchPhase>('edit');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [launchError, setLaunchError] = useState<string | undefined>(undefined);
  const [launched, setLaunched] = useState<Launched | undefined>(undefined);

  const request = requestKey(values);
  const ready = preview.status === 'ready' ? preview : undefined;
  const stale = ready !== undefined && ready.request !== request;
  const report = ready === undefined ? undefined : overlapReport(ready.plan, ready.issues);
  const fresh = ready !== undefined && !stale;
  const estimateUsd = fresh ? estimatePlanCostUsd(ready.plan) : undefined;
  const minutes = fresh ? estimateMinutes(ready.plan) : undefined;

  const change = (next: LaunchFormValues): void => {
    setValues(next);
    setLaunchError(undefined);
    if (attempted) setErrors(validateForm(next));
  };

  const validate = (): LaunchFormValues | undefined => {
    setAttempted(true);
    const nextErrors = validateForm(values);
    setErrors(nextErrors);
    return hasErrors(nextErrors) ? undefined : values;
  };

  const runPreview = (): void => {
    if (onPreview === undefined) return;
    const valid = validate();
    if (valid === undefined) return;
    const key = requestKey(valid);
    setPreview({ status: 'loading' });
    onPreview(toLaunchInput(valid))
      .then((result) => {
        setPreview({ status: 'ready', plan: result.plan, issues: result.issues, request: key });
      })
      .catch((error: unknown) => {
        setPreview({ status: 'error', message: errorMessage(error) });
      });
  };

  const review = (): void => {
    const valid = validate();
    if (valid === undefined) return;
    setLaunchError(undefined);
    setLaunched(undefined);
    setPhase('confirm');
  };

  const launch = (): void => {
    const valid = validate();
    if (valid === undefined) {
      setPhase('edit');
      return;
    }
    const input = toLaunchInput(valid);
    setPhase('launching');
    setLaunchError(undefined);
    onLaunch(input)
      .then(({ runId }) => {
        setLaunched({ runId, goal: input.goal });
        setPhase('launched');
      })
      .catch((error: unknown) => {
        setLaunchError(errorMessage(error));
        setPhase('confirm');
      });
  };

  const cancel = (): void => {
    setPhase('edit');
    setLaunchError(undefined);
  };

  const input = toLaunchInput(values);
  const plannedTasks = ready?.plan.tasks.length;
  const budget = input.budgetUsd ?? 0;

  return (
    <section
      data-testid="launch-panel"
      className="grid min-h-0 gap-3 text-ink-1 xl:grid-cols-2"
      aria-label="Launch a run and run history"
    >
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <Bird aria-hidden="true" className="h-4 w-4 text-teal-300" />
            Launch a run
          </span>
        }
        subtitle="One goal in, a murmuration out. Preview the plan, then release the flock."
        actions={
          values.dryRun ? (
            <Badge tone="info">dry run</Badge>
          ) : plannedTasks === undefined ? null : (
            <Badge tone="accent">{plannedTasks} tasks planned</Badge>
          )
        }
        bodyClassName="flex flex-col"
      >
        {launched === undefined ? null : (
          <div
            role="status"
            data-testid="launch-success"
            aria-live="polite"
            className="m-[var(--spacing-panel)] mb-0 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-2.5 py-2 text-caption text-emerald-100"
          >
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1">
              The flock is away. Run <code className="font-mono text-[10px]">{launched.runId}</code> is
              mapping {launched.goal.length > 48 ? `${launched.goal.slice(0, 48)}…` : launched.goal}.
            </span>
            <button
              type="button"
              data-testid="launch-open-started"
              onClick={() => onOpenRun(launched.runId)}
              className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-2 py-0.5 text-micro font-medium text-emerald-50 hover:bg-emerald-400/25"
            >
              Open run
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setLaunched(undefined)}
              className="rounded p-0.5 text-emerald-200/70 hover:text-emerald-100"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <LaunchForm
          values={values}
          errors={errors}
          goals={goals}
          recentRepos={recentRepos}
          phase={phase}
          canPreview={onPreview !== undefined}
          previewLoading={preview.status === 'loading'}
          onChange={change}
          onPreview={runPreview}
          onSubmit={review}
        />

        {phase === 'confirm' || phase === 'launching' ? (
          <div className="px-[var(--spacing-panel)] pb-[var(--spacing-panel)]">
            <ConfirmLaunch
              input={input}
              plan={ready?.plan}
              issues={ready?.issues}
              overlap={report}
              previewStale={stale}
              estimateUsd={estimateUsd}
              estimateMinutes={minutes}
              busy={phase === 'launching'}
              error={launchError}
              onConfirm={launch}
              onCancel={cancel}
            />
            {estimateUsd !== undefined && budget > 0 ? (
              <p className="mt-1 text-[10px] text-ink-4" data-testid="launch-budget-share">
                Estimate uses peak DeepSeek pricing and ~{Math.round(budgetUsedPercent(estimateUsd, budget))}%
                of the budget.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <PlanPreview
        state={preview}
        canPreview={onPreview !== undefined}
        stale={stale}
        onPreview={runPreview}
      />

      <div className="xl:col-span-2">
        <RunHistory runs={runs} onOpenRun={onOpenRun} />
      </div>
    </section>
  );
}
