import type { Run, TaskRun } from '@starling/core';
import type { LiveState } from '../live-state';
import { countStatuses, orderedTasks, runDuration, taskDuration } from '../run-util';
import { fmtDuration, fmtUsd, progressBar, renderTable, trimLines, truncate } from './format';
import type { Palette } from './palette';
import { statusCell } from './task-status';

export interface RenderLiveOptions {
  palette: Palette;
  width?: number;
}

/**
 * One compact frame of the live dashboard. Pure: the driver handles cursor movement and throttling,
 * so this can be snapshot-tested with no terminal at all.
 */
export function renderLive(state: LiveState, options: RenderLiveOptions): string {
  const { palette } = options;
  const width = Math.max(60, options.width ?? 100);
  const run = state.run;
  if (run === undefined) {
    return palette.dim('Waiting for the flock to take off…');
  }

  const lines: string[] = [];
  const id = run.id.slice(-6);
  lines.push(
    `${palette.bold('Starling')}  ${palette.dim('·')}  ${id}  ${palette.dim('·')}  ${statusLabel(run.status, palette)}  ${palette.dim('·')}  ${fmtDuration(runDuration(run, state.now))}`,
  );
  lines.push(`${palette.dim('goal')}  ${truncate(run.goal.text, width - 6)}`);

  if (state.plan !== undefined) {
    const edges = state.plan.tasks.reduce((sum, task) => sum + task.dependsOn.length, 0);
    lines.push(
      `${palette.dim('plan')}  ${state.plan.tasks.length} tasks · ${edges} dep edges · ${state.plan.model.model}`,
    );
  }

  if (state.nodes.length > 0) {
    const free = state.nodes.reduce(
      (sum, node) => sum + Math.max(0, node.maxSessions - node.activeSessions),
      0,
    );
    const online = state.nodes.filter((node) => node.status !== 'offline').length;
    lines.push(
      `${palette.dim('flock')} ${state.nodes.length} nodes · ${online} online · ${free} free session slots`,
    );
  }

  lines.push('');
  const actionWidth = Math.max(16, width - 50);
  const tasks = orderedTasks(run);
  const rows = tasks.map((task) => [
    statusCell(palette, task.status),
    task.taskKey,
    task.nodeId ?? palette.dim('—'),
    String(task.attempts),
    fmtDuration(taskDuration(task, state.now)),
    actionFor(task, state, palette, actionWidth),
  ]);
  lines.push(
    renderTable(['STATUS', 'TASK', 'NODE', 'ATT', 'TIME', 'LAST ACTION'], rows, {
      align: ['left', 'left', 'left', 'right', 'right', 'left'],
    }),
  );

  lines.push('');
  lines.push(footer(run, state, palette));

  const lastLog = state.logs.at(-1);
  if (lastLog !== undefined) lines.push(palette.dim(`  ${truncate(lastLog, width - 2)}`));

  return trimLines(lines.join('\n'));
}

function actionFor(task: TaskRun, state: LiveState, palette: Palette, width: number): string {
  const action = state.lastActions[task.taskKey];
  if (action !== undefined) return palette.dim(truncate(action, width));
  if (task.status === 'merged')
    return palette.dim(`merged${task.branch === undefined ? '' : ` · ${task.branch}`}`);
  if (task.status === 'pending') return palette.dim('waiting for dependencies');
  return palette.dim('—');
}

function footer(run: Run, state: LiveState, palette: Palette): string {
  const counts = countStatuses(run);
  const total = Object.keys(run.tasks).length;
  const active = counts.running + counts.fixing + counts.auditing + counts.merging;
  const metrics = run.metrics;
  const bar = progressBar(counts.merged, total, 14);

  const left = [
    palette.green(`✔ ${counts.merged} merged`),
    counts.failed > 0 ? palette.red(`✘ ${counts.failed} failed`) : palette.dim('✘ 0 failed'),
    active > 0 ? palette.cyan(`◐ ${active} active`) : palette.dim('◐ 0 active'),
    palette.dim(`queue ${counts.pending + counts.ready}`),
  ].join(palette.dim('  ·  '));

  const cost = [
    `${palette.dim('api')} ${fmtUsd(metrics.apiCostUsd)}`,
    `${palette.dim('local')} $0`,
    `${palette.dim('saved')} ${fmtUsd(metrics.estSavedUsd)}`,
  ].join(palette.dim('  ·  '));

  const merged = state.merges.length;
  const mergedNote = merged === 1 ? '1 merge' : `${merged} merges`;
  return `${left}\n  ${palette.dim(bar)}  ${palette.dim(mergedNote)}   ${cost}`;
}

function statusLabel(status: Run['status'], palette: Palette): string {
  switch (status) {
    case 'finished':
      return palette.green(status);
    case 'failed':
      return palette.red(status);
    case 'cancelled':
      return palette.gray(status);
    case 'running':
      return palette.cyan(status);
    default:
      return palette.yellow(status);
  }
}
