import type { Plan, TaskRun } from '@starling/core/browser';
import { STATUS_COLORS, statusLabel } from '../../lib/status';

export interface TaskChipsProps {
  tasks: Record<string, TaskRun>;
  plan?: Plan;
  selectedTask?: string;
  onSelectTask?(key: string): void;
}

/**
 * Every task in the plan with the status it ended on. Buttons, not decoration: the shell opens the
 * agent drawer for the key, which is where the diff, transcript and full verdict history live.
 */
export function TaskChips({ tasks, plan, selectedTask, onSelectTask }: TaskChipsProps) {
  const keys = new Set<string>(Object.keys(tasks));
  for (const task of plan?.tasks ?? []) keys.add(task.key);
  const titles = new Map((plan?.tasks ?? []).map((task) => [task.key, task.title]));

  return (
    <section
      data-testid="report-tasks"
      aria-labelledby="report-tasks-title"
      className="rounded-[var(--radius-panel)] border border-hairline bg-panel px-4 py-4 print:break-inside-avoid print:border-slate-300 print:bg-white print:text-slate-900"
    >
      <h2 id="report-tasks-title" className="text-heading font-semibold text-ink-1 print:text-slate-900">
        Every task
      </h2>
      <p className="mt-0.5 text-caption text-ink-3 print:text-slate-600">
        Click a task to open its agent drawer.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {[...keys].sort().map((key) => {
          const task = tasks[key];
          const status = task?.status ?? 'pending';
          const palette = STATUS_COLORS[status];
          const selected = selectedTask === key;
          return (
            <li key={key}>
              <button
                type="button"
                data-testid={`report-task-${key}`}
                data-task-key={key}
                aria-pressed={selected}
                onClick={() => onSelectTask?.(key)}
                title={titles.get(key) ?? key}
                className={`flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 py-0.5 text-caption transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus print:border-slate-400 ${
                  selected ? 'border-sky-400/60 bg-sky-400/15' : `${palette.border} ${palette.bg}`
                }`}
              >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
                <span className="font-mono text-ink-1 print:text-slate-900">{key}</span>
                <span className={`text-micro ${palette.text} print:text-slate-600`}>
                  {statusLabel(status)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
