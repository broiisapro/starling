import type { TaskRun } from '@starling/core';

/** Elapsed time for a task card: live while running, frozen once finished. */
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

/** Node chip text. The hub runs locally; a perch is identified by its node id. */
export function nodeLabel(run: TaskRun | undefined): string {
  if (!run?.nodeId) return 'unassigned';
  return run.nodeId;
}

/** Card titles are deliberately short; the full title stays available via the tooltip. */
export function shortTitle(title: string, max = 42): string {
  if (title.length <= max) return title;
  return `${title.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
