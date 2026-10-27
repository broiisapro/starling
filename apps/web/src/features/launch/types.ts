import type { Plan, PlanIssue, Run, StartRunInput } from '@starling/core';

/**
 * `features/launch` types.
 *
 * Everything here is local to the lane (ARCHITECTURE §8 has no launch handshake yet), and the
 * component takes plain props: the shell owns the store, the fetch calls and the routing.
 */

/**
 * What the dashboard asks the engine for.
 *
 * It is `StartRunInput` plus the one field the form has that the contract does not carry yet:
 * `budgetUsd`. `StartRunInput` is used as the parameter type everywhere, so a shell handler written
 * as `(input: StartRunInput) => …` is assignable to this prop (a function accepting the narrower
 * input is safe here); a shell that wants the budget can read it. See the FIX REQUEST in the
 * handback for adding `budgetUsd` to `StartRunInput` and `POST /api/runs`.
 */
export interface LaunchInput extends StartRunInput {
  /** Per-run API spend cap in USD. Advisory until the server accepts it. */
  budgetUsd?: number;
}

/** What `onPreview` resolves with: the plan plus the validator's findings. */
export interface LaunchPreview {
  plan: Plan;
  issues: PlanIssue[];
}

/**
 * A quick-pick goal. `name` is also the file stem under `examples/sky-todo/demo-goals/` so a shell
 * can label the chip with the name and show `hint` on hover.
 */
export interface LaunchGoal {
  name: string;
  text: string;
  /** Short, human label for the chip tooltip ("3 tiny tasks · ~2 min"). */
  hint?: string;
}

/**
 * `LaunchPanel` props (the deliverable's signature).
 *
 * `onLaunch` and `onPreview` are the only async edges: the panel never fetches, never imports a
 * server client and never reads the zustand store.
 */
export interface LaunchPanelProps {
  onLaunch(input: LaunchInput): Promise<{ runId: string }>;
  onPreview?(input: LaunchInput): Promise<LaunchPreview>;
  recentRepos: string[];
  goals: LaunchGoal[];
  runs: Run[];
  onOpenRun(id: string): void;
}

/** The form's internal value shape: numbers are strings while the user is typing. */
export interface LaunchFormValues {
  repoPath: string;
  goal: string;
  /** Name of the chip currently applied, if any. Cleared as soon as the text is edited by hand. */
  goalName?: string;
  maxParallel: string;
  budgetUsd: string;
  dryRun: boolean;
}

export type LaunchField = 'repoPath' | 'goal' | 'maxParallel' | 'budgetUsd';

export type LaunchFormErrors = Partial<Record<LaunchField, string>>;

/** The four steps the panel moves through. `confirm` is the cost/plan gate before a launch. */
export type LaunchPhase = 'edit' | 'confirm' | 'launching' | 'launched';

/** Preview lifecycle. `idle` means "not asked yet" (or `onPreview` is absent). */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; plan: Plan; issues: PlanIssue[]; request: string }
  | { status: 'error'; message: string };
