import './test-env';
import { afterEach, describe, expect, test } from 'bun:test';
import type { Run } from '@starling/core';
import { emptyMetrics } from '@starling/core/browser';
import { BASE_TS, makeGoal, makeRun, makeTaskRun } from '@starling/core/testing';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { formatUsd } from '../../lib/format';
import { estimatePlanCostUsd } from './estimate';
import { fixturePlan } from './fixtures';
import { DEMO_GOALS } from './goals';
import { LaunchPanel } from './LaunchPanel';
import type { LaunchInput, LaunchPanelProps, LaunchPreview } from './types';

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

const REPOS = ['examples/sky-todo', '/tmp/other-repo'];
const QUICK_WINS = DEMO_GOALS[0];
if (QUICK_WINS === undefined) throw new Error('demo goals are missing');

const finishedRun = makeRun({
  id: 'run_finished',
  goal: makeGoal({ text: 'Ship dark mode', repoPath: '/tmp/sky-todo', createdAt: BASE_TS }),
  status: 'finished',
  startedAt: BASE_TS,
  finishedAt: BASE_TS + 125_000,
  tasks: {
    theme: makeTaskRun({ taskKey: 'theme', status: 'merged' }),
    search: makeTaskRun({ taskKey: 'search', status: 'failed' }),
  },
  metrics: { ...emptyMetrics(), tasksMerged: 1, tasksFailed: 1, apiCostUsd: 0.42 },
});

const failedRun = makeRun({
  id: 'run_failed',
  goal: makeGoal({ text: 'Fix the date bugs', repoPath: '/tmp/other-repo', createdAt: BASE_TS }),
  status: 'failed',
  startedAt: BASE_TS - 70_000,
  finishedAt: BASE_TS - 10_000,
  tasks: { theme: makeTaskRun({ taskKey: 'theme', status: 'failed' }) },
  metrics: { ...emptyMetrics(), tasksFailed: 1, apiCostUsd: 0.12 },
});

const RUNS: Run[] = [finishedRun, failedRun];

interface Setup {
  launches: LaunchInput[];
  previews: LaunchInput[];
  opened: string[];
  view: ReturnType<typeof render>;
}

function setup(overrides: Partial<LaunchPanelProps> = {}): Setup {
  const launches: LaunchInput[] = [];
  const previews: LaunchInput[] = [];
  const opened: string[] = [];
  const onLaunch: LaunchPanelProps['onLaunch'] = async (input) => {
    launches.push(input);
    return { runId: 'run_new' };
  };
  const onPreview: NonNullable<LaunchPanelProps['onPreview']> = async (input): Promise<LaunchPreview> => {
    previews.push(input);
    return { plan: fixturePlan(input.goal), issues: [] };
  };
  const props: LaunchPanelProps = {
    onLaunch,
    onPreview,
    recentRepos: REPOS,
    goals: [...DEMO_GOALS],
    runs: RUNS,
    onOpenRun: (id) => opened.push(id),
    ...overrides,
  };
  return { launches, previews, opened, view: render(<LaunchPanel {...props} />) };
}

function typeInto(view: Setup['view'], testId: string, value: string): void {
  fireEvent.change(view.getByTestId(testId), { target: { value } });
}

describe('launch form', () => {
  test('starts on the most recent repo and a quick-pick chip fills the goal', () => {
    const { view } = setup();
    expect((view.getByTestId('launch-repo') as HTMLInputElement).value).toBe('examples/sky-todo');

    const chip = view.getByRole('button', { name: QUICK_WINS.name });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);

    expect((view.getByTestId('launch-goal') as HTMLTextAreaElement).value).toBe(QUICK_WINS.text);
    expect(view.getByRole('button', { name: QUICK_WINS.name }).getAttribute('aria-pressed')).toBe('true');
  });

  test('the release button opens the confirm gate and only then calls onLaunch', async () => {
    const { view, launches } = setup();

    fireEvent.click(view.getByRole('button', { name: QUICK_WINS.name }));
    typeInto(view, 'launch-max-parallel', '4');
    typeInto(view, 'launch-budget', '3.5');
    fireEvent.click(view.getByTestId('launch-dry-run'));

    fireEvent.click(view.getByTestId('launch-release'));

    expect(view.getByTestId('launch-confirm')).toBeTruthy();
    expect(launches).toHaveLength(0);
    expect(view.getByTestId('launch-confirm').textContent).toContain('dry run — plan only');

    fireEvent.click(view.getByTestId('launch-confirm-button'));

    await waitFor(() => expect(launches).toHaveLength(1));
    expect(launches[0]).toEqual({
      goal: QUICK_WINS.text,
      repoPath: 'examples/sky-todo',
      maxParallel: 4,
      budgetUsd: 3.5,
      dryRun: true,
    });

    const success = await view.findByTestId('launch-success');
    expect(success.textContent).toContain('run_new');
    fireEvent.click(view.getByTestId('launch-open-started'));
    expect(view.getByTestId('launch-panel').textContent).toContain('run_new');
  });

  test('validation blocks the gate and points at the empty fields', () => {
    const { view, launches } = setup();
    typeInto(view, 'launch-repo', '');
    typeInto(view, 'launch-goal', '');

    fireEvent.click(view.getByTestId('launch-release'));

    expect(view.queryByTestId('launch-confirm')).toBeNull();
    expect(view.getByTestId('launch-repo-error').textContent).toContain('Choose the repo');
    expect(view.getByTestId('launch-goal-error').textContent).toContain('Tell the flock');
    expect((view.getByTestId('launch-goal') as HTMLTextAreaElement).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(launches).toHaveLength(0);
  });

  test('⌘/Ctrl+Enter opens the confirm gate too', () => {
    const { view } = setup();
    fireEvent.click(view.getByRole('button', { name: QUICK_WINS.name }));
    fireEvent.keyDown(view.getByTestId('launch-form'), { key: 'Enter', metaKey: true });
    expect(view.getByTestId('launch-confirm')).toBeTruthy();
    fireEvent.keyDown(view.getByTestId('launch-confirm'), { key: 'Escape' });
    expect(view.queryByTestId('launch-confirm')).toBeNull();
  });

  test('a rejected launch keeps the form and shows the server message', async () => {
    const { view } = setup({
      onLaunch: async () => {
        throw new Error('POST /api/runs failed with 503');
      },
    });
    fireEvent.click(view.getByRole('button', { name: QUICK_WINS.name }));
    fireEvent.click(view.getByTestId('launch-release'));
    fireEvent.click(view.getByTestId('launch-confirm-button'));

    const error = await view.findByTestId('launch-error');
    expect(error.textContent).toContain('503');
    expect((view.getByTestId('launch-goal') as HTMLTextAreaElement).value).toBe(QUICK_WINS.text);
    expect((view.getByTestId('launch-confirm-button') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(view.getByTestId('launch-cancel'));
    expect(view.queryByTestId('launch-confirm')).toBeNull();
  });

  test('explains that preview is not wired rather than pretending', () => {
    const { view } = setup({ onPreview: undefined });
    expect(view.getByTestId('launch-preview').textContent).toContain('Preview is not wired yet');
    expect((view.getByTestId('launch-preview-retry') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('plan preview', () => {
  test('renders every task with its lane, dependencies and a clear-lane badge', async () => {
    const { view, previews } = setup();
    fireEvent.click(view.getByRole('button', { name: DEMO_GOALS[1]?.name ?? 'launch-day' }));
    fireEvent.click(view.getByTestId('launch-preview-button'));

    await view.findByTestId('launch-preview-ready');

    expect(previews).toHaveLength(1);
    const rows = view.getAllByTestId('launch-plan-task');
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.getAttribute('data-task-key'))).toContain('help-overlay');

    const help = rows.find((row) => row.getAttribute('data-task-key') === 'help-overlay');
    expect(help?.textContent).toContain('shortcuts');
    expect(help?.textContent).toContain('src/features/help/**');
    expect(view.getByTestId('launch-overlap-state').textContent).toContain('Lanes clear');
  });

  test('flags the deliberate conflict-bait overlap and the validator issue', async () => {
    const conflict = fixturePlan('sort by due date');
    const { view } = setup({
      onPreview: async () => ({
        plan: conflict,
        issues: [
          {
            severity: 'error',
            code: 'lane-overlap',
            message: 'tasks "date-sort" and "delete-all" can run concurrently but their lanes overlap',
            taskKeys: ['date-sort', 'delete-all'],
          },
        ],
      }),
    });
    fireEvent.click(view.getByRole('button', { name: 'conflict-bait' }));
    fireEvent.click(view.getByTestId('launch-preview-button'));
    await view.findByTestId('launch-preview-ready');

    expect(view.getByTestId('launch-overlap-state').textContent).toContain('1 lane overlap');
    expect(view.getByTestId('launch-plan-issues').textContent).toContain('lane-overlap');
    expect(view.getByTestId('launch-overlaps').textContent).toContain('src/ui/render.ts');
  });

  test('marks the plan stale when the form changes after previewing', async () => {
    const { view } = setup();
    fireEvent.click(view.getByRole('button', { name: QUICK_WINS.name }));
    fireEvent.click(view.getByTestId('launch-preview-button'));
    await view.findByTestId('launch-preview-ready');

    typeInto(view, 'launch-max-parallel', '2');
    expect(view.getByTestId('launch-preview').textContent).toContain('inputs changed');
  });

  test('shows a preview failure and recovers on retry', async () => {
    let calls = 0;
    const { view } = setup({
      onPreview: async (input) => {
        calls += 1;
        if (calls === 1) throw new Error('planner exploded');
        return { plan: fixturePlan(input.goal), issues: [] };
      },
    });
    fireEvent.click(view.getByRole('button', { name: QUICK_WINS.name }));
    fireEvent.click(view.getByTestId('launch-preview-button'));

    const error = await view.findByTestId('launch-preview-error');
    expect(error.textContent).toContain('planner exploded');

    fireEvent.click(view.getByTestId('launch-preview-error-retry'));
    await view.findByTestId('launch-preview-ready');
    expect(calls).toBe(2);
  });

  test('the confirm step shows the estimated cost from the previewed plan', async () => {
    const { view } = setup();
    const plan = fixturePlan(DEMO_GOALS[1]?.text ?? '');
    fireEvent.click(view.getByRole('button', { name: 'launch-day' }));
    fireEvent.click(view.getByTestId('launch-preview-button'));
    await view.findByTestId('launch-preview-ready');

    fireEvent.click(view.getByTestId('launch-release'));
    expect(view.getByTestId('launch-confirm').textContent).toContain(formatUsd(estimatePlanCostUsd(plan)));
  });
});

describe('run history', () => {
  test('lists newest first with status, progress, cost and duration', () => {
    const { view } = setup();
    const rows = view.getAllByTestId('launch-history-run');
    expect(rows.map((row) => row.getAttribute('data-run-id'))).toEqual(['run_finished', 'run_failed']);
    const newest = rows[0];
    expect(newest?.textContent).toContain('Finished');
    expect(newest?.textContent).toContain('1/2 landed');
    expect(newest?.textContent).toContain('1 failed');
    expect(newest?.textContent).toContain('$0.42');
    expect(newest?.textContent).toContain('2m 05s');

    const oldest = rows[1];
    expect(oldest?.textContent).toContain('Failed');
    expect(oldest?.textContent).toContain('$0.12');
  });

  test('clicking a run opens it and an empty history says so', () => {
    const opened: string[] = [];
    const { view } = setup({ onOpenRun: (id) => opened.push(id) });
    fireEvent.click(view.getAllByTestId('launch-history-run')[0] as HTMLElement);
    expect(opened).toEqual(['run_finished']);

    view.unmount();
    cleanup();
    const empty = setup({ runs: [], onOpenRun: () => {} });
    expect(empty.view.getByTestId('launch-history').textContent).toContain('No runs yet');
  });
});
