import type { TaskRun } from '@starling/core';

/** `TaskRun` as core will carry it once `nodeName` lands (tracked as a FIX REQUEST to Epic 40). */
export type TaskRunWithNodeName = TaskRun & { nodeName?: string };

/**
 * Elapsed time for a task card: live while running, frozen once finished.
 */
export function elapsedFor(run: TaskRun | undefined, now: number): number | undefined {
  if (!run?.startedAt) return undefined;
  return Math.max(0, (run.finishedAt ?? now) - run.startedAt);
}

export function formatElapsed(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The roost's human name: `TaskRun.nodeName` when the engine publishes one (Epic 40), else the id
 * the shell already maps to a display name. Feature-detected so this compiles before and after core
 * grows the field.
 */
export function nodeNameOf(run: TaskRun | undefined): string | undefined {
  const name = (run as TaskRunWithNodeName | undefined)?.nodeName;
  if (typeof name === 'string' && name.trim().length > 0) return name;
  return run?.nodeId;
}

/** Node chip text. The hub runs locally; a perch is identified by its node name (or id). */
export function nodeLabel(run: TaskRun | undefined): string {
  return nodeNameOf(run) ?? 'unassigned';
}

/** Card titles are deliberately short; the full title stays available via the tooltip. */
export function shortTitle(title: string, max = 42): string {
  if (title.length <= max) return title;
  return `${title.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
