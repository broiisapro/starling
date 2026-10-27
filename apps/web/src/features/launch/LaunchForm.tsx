import { Bird, Eye, Loader2 } from 'lucide-react';
import { useId } from 'react';
import { Kbd } from '../../components';
import { cn } from '../../lib/cn';
import { applyGoal, editedGoal } from './form';
import type { LaunchFormErrors, LaunchFormValues, LaunchGoal, LaunchPhase } from './types';

export interface LaunchFormProps {
  values: LaunchFormValues;
  errors: LaunchFormErrors;
  goals: readonly LaunchGoal[];
  recentRepos: readonly string[];
  phase: LaunchPhase;
  /** False when the shell did not supply `onPreview` (Epic 41 wires it). */
  canPreview: boolean;
  previewLoading: boolean;
  onChange(values: LaunchFormValues): void;
  onPreview(): void;
  onSubmit(): void;
}

const FIELD =
  'w-full rounded-lg border bg-surface-2/70 px-2.5 py-1.5 font-mono text-caption text-ink-1 outline-none transition-colors placeholder:text-ink-4 focus-visible:border-[var(--focus-ring)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]/25';
const LABEL =
  'flex items-center justify-between gap-2 text-micro font-semibold tracking-[0.08em] text-ink-3 uppercase';
const HINT = 'text-caption text-ink-4';

function fieldClass(invalid: boolean): string {
  return cn(FIELD, invalid ? 'border-red-400/60' : 'border-hairline-strong');
}

/**
 * The launch form: repo, goal (with demo chips), parallelism, budget and the dry-run switch.
 *
 * Keyboard-first: ⌘/Ctrl+Enter opens the confirm gate from anywhere in the form, the chips are
 * plain buttons, and every error is wired through `aria-invalid` + `aria-describedby`.
 */
export function LaunchForm({
  values,
  errors,
  goals,
  recentRepos,
  phase,
  canPreview,
  previewLoading,
  onChange,
  onPreview,
  onSubmit,
}: LaunchFormProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const repoListId = `launch-repos-${id}`;
  const busy = phase === 'launching';
  const confirmOpen = phase === 'confirm' || phase === 'launching';

  return (
    <form
      noValidate
      aria-label="Launch a run"
      data-testid="launch-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit();
        }
      }}
      className="flex min-h-0 flex-col gap-3 p-[var(--spacing-panel)]"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`launch-repo-${id}`} className={LABEL}>
          Repo
          <span className="font-normal tracking-normal text-ink-4 normal-case">where the flock works</span>
        </label>
        <input
          id={`launch-repo-${id}`}
          data-testid="launch-repo"
          type="text"
          spellCheck={false}
          autoComplete="off"
          list={repoListId}
          placeholder="examples/sky-todo"
          value={values.repoPath}
          disabled={busy}
          aria-invalid={errors.repoPath !== undefined}
          aria-describedby={`launch-repo-hint-${id}${errors.repoPath === undefined ? '' : ` launch-repo-error-${id}`}`}
          onChange={(event) => onChange({ ...values, repoPath: event.target.value })}
          className={fieldClass(errors.repoPath !== undefined)}
        />
        <datalist id={repoListId} data-testid="launch-recent-repos">
          {recentRepos.map((repo) => (
            <option key={repo} value={repo} />
          ))}
        </datalist>
        <p id={`launch-repo-hint-${id}`} className={HINT}>
          Recent repos appear in the dropdown. Paths are relative to the server's working directory.
        </p>
        {errors.repoPath === undefined ? null : (
          <p
            id={`launch-repo-error-${id}`}
            role="alert"
            data-testid="launch-repo-error"
            className="text-caption text-red-300"
          >
            {errors.repoPath}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`launch-goal-${id}`} className={LABEL}>
          Goal
          <span className="font-normal tracking-normal text-ink-4 normal-case">
            {values.goal.trim().length} chars
          </span>
        </label>
        <textarea
          id={`launch-goal-${id}`}
          data-testid="launch-goal"
          rows={4}
          placeholder="Add dark mode with a toggle and fix the overdue-date calculation…"
          value={values.goal}
          disabled={busy}
          aria-invalid={errors.goal !== undefined}
          aria-describedby={`launch-goal-hint-${id}${errors.goal === undefined ? '' : ` launch-goal-error-${id}`}`}
          onChange={(event) => onChange(editedGoal(values, event.target.value))}
          className={cn(
            fieldClass(errors.goal !== undefined),
            'min-h-24 resize-y font-sans text-body leading-relaxed',
          )}
        />
        <p id={`launch-goal-hint-${id}`} className={HINT}>
          One sentence is enough. The planner turns it into a lane-safe task DAG.
        </p>
        {errors.goal === undefined ? null : (
          <p
            id={`launch-goal-error-${id}`}
            role="alert"
            data-testid="launch-goal-error"
            className="text-caption text-red-300"
          >
            {errors.goal}
          </p>
        )}
      </div>

      {goals.length === 0 ? null : (
        <fieldset className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0">
          <legend className="sr-only">Demo goals</legend>
          <span
            aria-hidden="true"
            className="mr-0.5 text-micro font-semibold tracking-[0.08em] text-ink-4 uppercase"
          >
            Try
          </span>
          {goals.map((goal) => {
            const pressed = values.goalName === goal.name || values.goal === goal.text;
            return (
              <button
                key={goal.name}
                type="button"
                data-testid="launch-goal-chip"
                data-goal-name={goal.name}
                aria-pressed={pressed}
                title={goal.hint ?? goal.text}
                disabled={busy}
                onClick={() => onChange(applyGoal(values, goal))}
                className={cn(
                  'rounded-[var(--radius-pill)] border px-2 py-0.5 font-mono text-micro transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  pressed
                    ? 'border-teal-400/50 bg-teal-400/15 text-teal-100'
                    : 'border-hairline-strong bg-surface-3/50 text-ink-2 hover:border-teal-300/40 hover:text-ink-1',
                )}
              >
                {goal.name}
              </button>
            );
          })}
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`launch-parallel-${id}`} className={LABEL}>
            Agents
          </label>
          <input
            id={`launch-parallel-${id}`}
            data-testid="launch-max-parallel"
            type="number"
            min={1}
            max={64}
            step={1}
            value={values.maxParallel}
            disabled={busy}
            aria-invalid={errors.maxParallel !== undefined}
            aria-describedby={`launch-parallel-hint-${id}${errors.maxParallel === undefined ? '' : ` launch-parallel-error-${id}`}`}
            onChange={(event) => onChange({ ...values, maxParallel: event.target.value })}
            className={fieldClass(errors.maxParallel !== undefined)}
          />
          <p id={`launch-parallel-hint-${id}`} className={HINT}>
            max parallel
          </p>
          {errors.maxParallel === undefined ? null : (
            <p
              id={`launch-parallel-error-${id}`}
              role="alert"
              data-testid="launch-max-parallel-error"
              className="text-caption text-red-300"
            >
              {errors.maxParallel}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`launch-budget-${id}`} className={LABEL}>
            Budget
          </label>
          <input
            id={`launch-budget-${id}`}
            data-testid="launch-budget"
            type="number"
            min={0}
            max={1000}
            step={0.5}
            value={values.budgetUsd}
            disabled={busy}
            aria-invalid={errors.budgetUsd !== undefined}
            aria-describedby={`launch-budget-hint-${id}${errors.budgetUsd === undefined ? '' : ` launch-budget-error-${id}`}`}
            onChange={(event) => onChange({ ...values, budgetUsd: event.target.value })}
            className={fieldClass(errors.budgetUsd !== undefined)}
          />
          <p id={`launch-budget-hint-${id}`} className={HINT}>
            USD cap · 0 = plan only
          </p>
          {errors.budgetUsd === undefined ? null : (
            <p
              id={`launch-budget-error-${id}`}
              role="alert"
              data-testid="launch-budget-error"
              className="text-caption text-red-300"
            >
              {errors.budgetUsd}
            </p>
          )}
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-hairline bg-surface-1/60 px-2.5 py-2">
        <input
          type="checkbox"
          data-testid="launch-dry-run"
          checked={values.dryRun}
          disabled={busy}
          onChange={(event) => onChange({ ...values, dryRun: event.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 accent-teal-400"
        />
        <span className="min-w-0">
          <span className="block text-caption font-medium text-ink-2">Dry run</span>
          <span className="block text-caption text-ink-4">
            Plan only: map the repo and write the DAG, then stop before a single bird flies.
          </span>
        </span>
      </label>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          data-testid="launch-release"
          disabled={busy || confirmOpen}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-teal-300/50 bg-gradient-to-b from-teal-400/30 to-teal-500/15 px-4 py-2.5 text-body font-semibold text-teal-50 shadow-[var(--shadow-glow)] transition-[filter,transform] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-transform"
        >
          <Bird aria-hidden="true" className="h-4 w-4" />
          Release the flock
        </button>
        <button
          type="button"
          data-testid="launch-preview-button"
          onClick={onPreview}
          disabled={!canPreview || busy || previewLoading}
          title={
            canPreview ? 'Ask the planner for a dry plan' : 'The preview endpoint is not wired yet (Epic 41)'
          }
          className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-surface-3/60 px-3 py-2.5 text-caption font-medium text-ink-2 transition-colors hover:border-sky-300/40 hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {previewLoading ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {previewLoading ? 'Planning…' : 'Preview plan'}
        </button>
      </div>

      <p className="flex items-center gap-1 text-caption text-ink-4">
        <Kbd size="sm">⌘</Kbd>
        <Kbd size="sm">↵</Kbd>
        <span>to review, then confirm. Nothing flies until you say so.</span>
      </p>
    </form>
  );
}
