import type { Run, TaskRun } from '@starling/core';
import { countStatuses, orderedTasks, runDuration, taskDuration } from '../run-util';
import {
  fmtDuration,
  fmtTimestamp,
  fmtTokens,
  fmtUsd,
  progressBar,
  renderTable,
  trimLines,
  truncate,
} from './format';
import type { Palette } from './palette';
import { statusCell } from './task-status';

export interface RenderStatusOptions {
  palette: Palette;
  width?: number;
  /** Replay/recorded runs have no live clock; pass the last event time. */
  now?: number;
}

/** A detailed, one-shot view of a run — what `starling status` prints. */
export function renderStatus(run: Run, options: RenderStatusOptions): string {
  const { palette } = options;
  const width = Math.max(60, options.width ?? 100);
  const now = options.now ?? run.finishedAt ?? Date.now();
  const counts = countStatuses(run);
  const total = Object.keys(run.tasks).length;
  const lines: string[] = [];

  lines.push(`${palette.bold('Starling run')}  ${run.id}`);
  lines.push(`${palette.dim('goal')}      ${truncate(run.goal.text, width - 10)}`);
  lines.push(
    `${palette.dim('status')}    ${runStatusLabel(run, palette)}  ${palette.dim('·')}  ${fmtDuration(runDuration(run, now))}`,
  );
  if (run.integrationBranch !== undefined) {
    lines.push(`${palette.dim('branch')}    ${run.integrationBranch}`);
  }
  lines.push(
    `${palette.dim('repo')}      ${run.goal.repoPath} ${palette.dim(`(base ${run.goal.baseBranch})`)}`,
  );
  lines.push(`${palette.dim('started')}   ${fmtTimestamp(run.startedAt)}`);
  if (run.finishedAt !== undefined) {
    lines.push(`${palette.dim('finished')}  ${fmtTimestamp(run.finishedAt)}`);
  }

  if (run.plan !== undefined) {
    lines.push(`${palette.dim('plan')}      ${run.plan.summary}`);
    lines.push(`${palette.dim('model')}     ${run.plan.model.provider}/${run.plan.model.model}`);
  }

  lines.push('');
  lines.push(
    `  ${palette.dim(progressBar(counts.merged, total, 24))}  ${palette.green(`✔ ${counts.merged} merged`)}  ${counts.failed > 0 ? palette.red(`✘ ${counts.failed} failed`) : palette.dim('✘ 0 failed')}`,
  );
  lines.push('');

  const rows = orderedTasks(run).map((task) => [
    task.taskKey,
    statusCell(palette, task.status),
    task.nodeId ?? '—',
    String(task.attempts),
    fmtDuration(taskDuration(task, now)),
    verdictCell(task, palette),
  ]);
  lines.push(
    renderTable(['TASK', 'STATUS', 'NODE', 'ATT', 'TIME', 'VERDICT'], rows, {
      align: ['left', 'left', 'left', 'right', 'right', 'left'],
    }),
  );

  lines.push('');
  const metrics = run.metrics;
  lines.push(
    `${palette.dim('tokens')}  api ${fmtTokens(metrics.apiUsage.input)} in / ${fmtTokens(metrics.apiUsage.output)} out  ${palette.dim('·')}  local ${fmtTokens(metrics.localUsage.input)} in / ${fmtTokens(metrics.localUsage.output)} out`,
  );
  lines.push(
    `${palette.dim('cost')}    api ${fmtUsd(metrics.apiCostUsd)}  ${palette.dim('·')}  local $0  ${palette.dim('·')}  saved ${fmtUsd(metrics.estSavedUsd)}  ${palette.dim(`(${metrics.localCallCount} local calls)`)}`,
  );

  if (run.goal.constraints.length > 0) {
    lines.push('');
    lines.push(`${palette.dim('constraints')}  ${run.goal.constraints.join(' · ')}`);
  }

  return trimLines(lines.join('\n'));
}

function verdictCell(task: TaskRun, palette: Palette): string {
  if (task.prUrl !== undefined) return palette.cyan(task.prUrl);
  if (task.lastVerdict === undefined) return palette.dim('—');
  const verdict = task.lastVerdict;
  if (!verdict.pass) {
    return palette.red(`✘ ${truncate(verdict.summary, 40)}`);
  }
  return palette.green(`✔ ${truncate(verdict.summary, 40)}`);
}

function runStatusLabel(run: Run, palette: Palette): string {
  switch (run.status) {
    case 'finished':
      return palette.green(run.status);
    case 'failed':
      return palette.red(run.status);
    case 'cancelled':
      return palette.gray(run.status);
    case 'running':
      return palette.cyan(run.status);
    default:
      return palette.yellow(run.status);
  }
}
