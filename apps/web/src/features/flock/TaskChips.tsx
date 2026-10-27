import type { TaskRun } from '@starling/core';
import { cx } from './cx';
import { taskTone } from './palette';

export interface TaskChipsProps {
  tasks: TaskRun[];
  onSelectTask?(taskKey: string): void;
  compact?: boolean;
}

/** The tasks currently running on one roost. Clicking a chip opens that bird in the agent drawer. */
export function TaskChips({ tasks, onSelectTask, compact = false }: TaskChipsProps) {
  if (tasks.length === 0) {
    return (
      <span data-testid="task-empty" className="text-[12px] text-slate-400">
        idle
      </span>
    );
  }

  return (
    <ul data-testid="task-chips" className="flex flex-wrap items-center gap-1.5">
      {tasks.map((task) => {
        const tone = taskTone(task.status);
        const interactive = onSelectTask !== undefined;
        return (
          <li key={task.taskKey}>
            <button
              type="button"
              data-testid="task-chip"
              data-task-key={task.taskKey}
              data-status={task.status}
              aria-disabled={interactive ? undefined : true}
              title={
                interactive
                  ? `${task.taskKey} · ${task.status} — open in the agent drawer`
                  : `${task.taskKey} · ${task.status}`
              }
              aria-label={
                interactive ? `Open ${task.taskKey} (${task.status})` : `${task.taskKey} (${task.status})`
              }
              onClick={() => onSelectTask?.(task.taskKey)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5',
                'font-mono text-[12px] text-slate-100 transition-colors duration-200',
                'hover:border-white/25 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2',
                'focus-visible:outline-sky-400',
                compact ? 'text-[12px]' : undefined,
                interactive ? undefined : 'cursor-default',
              )}
            >
              <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
              <span className={cx('truncate', tone.text)}>{task.taskKey}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
