import type { Run } from '@starling/core';
import { countStatuses, runDuration } from '../run-util';
import { fmtDuration, fmtUsd, trimLines, visibleLength } from './format';
import type { Palette } from './palette';

export interface RenderSummaryOptions {
  palette: Palette;
  width?: number;
}

/** The box `starling run` and `starling replay` finish with. */
export function renderSummary(run: Run, summary: string, options: RenderSummaryOptions): string {
  const { palette } = options;
  const width = Math.max(48, options.width ?? 78);
  const counts = countStatuses(run);
  const inner = width - 4;
  const metrics = run.metrics;
  const lines: string[] = [];

  const headline =
    run.status === 'finished'
      ? palette.green(`✔ run finished in ${fmtDuration(runDuration(run, run.finishedAt ?? Date.now()))}`)
      : run.status === 'failed'
        ? palette.red(`✘ run failed after ${fmtDuration(runDuration(run, run.finishedAt ?? Date.now()))}`)
        : palette.yellow(`■ run ${run.status}`);

  lines.push(headline);
  lines.push(
    `${palette.green(`✔ ${counts.merged} merged`)}  ${palette.dim('·')}  ${counts.failed > 0 ? palette.red(`✘ ${counts.failed} failed`) : palette.dim('✘ 0 failed')}  ${palette.dim('·')}  ${palette.dim(`${counts.conflict} conflicts`)}`,
  );
  lines.push(
    `${palette.dim('api')} ${fmtUsd(metrics.apiCostUsd)}  ${palette.dim('·')}  ${palette.dim('local')} $0  ${palette.dim('·')}  ${palette.dim('saved')} ${fmtUsd(metrics.estSavedUsd)}`,
  );
  if (run.integrationBranch !== undefined) {
    lines.push(`${palette.dim('branch')} ${run.integrationBranch}`);
  }
  if (summary.trim().length > 0) {
    lines.push('');
    for (const line of wrap(summary, inner)) lines.push(palette.dim(line));
  }

  return box(lines, width, palette);
}

function box(lines: string[], width: number, palette: Palette): string {
  const inner = width - 4;
  const top = `╭${'─'.repeat(width - 2)}╮`;
  const bottom = `╰${'─'.repeat(width - 2)}╯`;
  const body = lines.map((line) => {
    const padding = ' '.repeat(Math.max(0, inner - visibleLength(line)));
    return `│ ${line}${padding} │`;
  });
  return trimLines([palette.dim(top), ...body, palette.dim(bottom)].join('\n'));
}

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
