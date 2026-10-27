import type { TaskRun } from '@starling/core';

/** `TaskRun` as core will carry it once `nodeName` lands (FIX REQUEST to Epic 40). */
export type TaskRunWithNodeName = TaskRun & { nodeName?: string };

/**
 * The roost's label on a queue card: a published `nodeName` wins, then the id (which the shell's
 * selectors already map to a display name), then nothing.
 */
export function taskNodeLabel(run: TaskRun | undefined): string | undefined {
  const name = (run as TaskRunWithNodeName | undefined)?.nodeName;
  if (typeof name === 'string' && name.trim().length > 0) return name;
  return run?.nodeId;
}
