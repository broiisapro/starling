import type { Plan, PlanIssue, TaskSpec } from '@starling/core';
import { globsOverlap } from '@starling/core';
import { planHealth } from '../plan-health';
import { renderTable, trimLines, truncate, visibleLength } from './format';
import type { Palette } from './palette';

export interface RenderPlanOptions {
  palette: Palette;
  /** Optional goal line; a Plan does not carry its Goal. */
  goal?: string;
  /** A short badge such as `mock plan` or `dry run`. */
  badge?: string;
  width?: number;
}

/**
 * Render a plan as a scannable table of tasks, dependencies and lanes, followed by an all-pairs
 * lane matrix and any issues the local validator found.
 */
export function renderPlan(plan: Plan, issues: PlanIssue[], options: RenderPlanOptions): string {
  const { palette } = options;
  const width = Math.max(48, options.width ?? 100);
  const health = planHealth(issues);
  const lines: string[] = [];

  const badge = options.badge === undefined ? '' : palette.dim(` · ${options.badge}`);
  lines.push(
    `${palette.bold('Starling plan')}${badge}  ${palette.dim('·')}  ${plan.tasks.length} tasks  ${palette.dim('·')}  ${plan.model.provider}/${plan.model.model}`,
  );
  if (options.goal !== undefined) lines.push(`${palette.dim('goal')}     ${wrap(options.goal, width - 9)}`);
  lines.push(`${palette.dim('summary')}  ${wrap(plan.summary, width - 9)}`);
  lines.push('');

  const check = (ok: boolean, label: string): string =>
    ok ? palette.green(`✔ ${label}`) : palette.red(`✘ ${label}`);
  lines.push(
    `  ${check(health.acyclic, 'acyclic')}   ${check(health.lanesDisjoint, 'lanes disjoint')}   ${check(health.everyTaskHasDod, 'definitions of done')}`,
  );
  lines.push('');

  const taskRows = plan.tasks.map((task) => {
    const marker = issueMarker(task.key, issues, palette);
    const deps = task.dependsOn.length === 0 ? '—' : task.dependsOn.join(', ');
    const owns = task.lane.owns.length === 0 ? palette.red('none') : task.lane.owns.join(', ');
    return [`${marker}${task.key}`, task.title, deps, owns, `${task.estimateMin}m`];
  });
  lines.push(
    renderTable(['TASK', 'TITLE', 'DEPENDS', 'OWNS', 'EST'], taskRows, {
      align: ['left', 'left', 'left', 'left', 'right'],
    }),
  );

  lines.push('');
  lines.push(renderLaneMatrix(plan, palette));

  if (plan.lockedDecisions.length > 0) {
    lines.push('');
    lines.push(palette.bold('Locked decisions'));
    for (const decision of plan.lockedDecisions) {
      lines.push(`  ${palette.dim('·')} ${wrap(decision, width - 4)}`);
    }
  }

  lines.push('');
  if (issues.length === 0) {
    lines.push(palette.green('✔ No issues — the DAG is ready to fly.'));
  } else {
    lines.push(palette.bold(`Issues (${issues.length})`));
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? palette.red('✘') : palette.yellow('!');
      const code = palette.dim(issue.code.padEnd(12));
      lines.push(`  ${icon} ${code} ${wrap(issue.message, width - 18)}`);
      if (issue.taskKeys.length > 0) {
        lines.push(`    ${palette.dim(issue.taskKeys.join(', '))}`);
      }
    }
  }

  return trimLines(lines.join('\n'));
}

function issueMarker(key: string, issues: PlanIssue[], palette: Palette): string {
  const relevant = issues.filter((issue) => issue.taskKeys.includes(key));
  if (relevant.some((issue) => issue.severity === 'error')) return `${palette.red('✘')} `;
  if (relevant.length > 0) return `${palette.yellow('!')} `;
  return '  ';
}

/** All-pairs lane matrix. `✘` means the globs overlap; dependent pairs are flagged separately. */
export function renderLaneMatrix(plan: Plan, palette: Palette): string {
  const tasks = plan.tasks.slice(0, 10);
  const header = ['LANE', ...tasks.map((task) => truncate(task.key, 7))];
  const rows: string[][] = [];

  for (const row of tasks) {
    const cells = tasks.map((column) => {
      if (row.key === column.key) return palette.dim('·');
      return overlaps(row, column) ? palette.red('✘') : palette.green('✓');
    });
    rows.push([truncate(row.key, 12), ...cells]);
  }

  const table = renderTable(header, rows, { gap: 3 });
  const note = palette.dim(
    '  ✓ lanes disjoint   ✘ globs overlap   · same task   (overlaps between dependent tasks never run together)',
  );
  const truncated =
    plan.tasks.length > tasks.length
      ? `\n${palette.dim(`  showing the first ${tasks.length} of ${plan.tasks.length} tasks`)}`
      : '';
  return `${palette.bold('Lane matrix')}\n${table}${truncated}\n${note}`;
}

function overlaps(a: TaskSpec, b: TaskSpec): boolean {
  return globsOverlap(a.lane.owns, b.lane.owns).length > 0;
}

function wrap(text: string, width: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (visibleLength(clean) <= width) return clean;
  return `${clean.slice(0, Math.max(0, width - 1))}…`;
}
