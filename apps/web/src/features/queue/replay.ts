import type { MergeResult, Plan, StarlingEvent, TaskRun } from '@starling/core';

export interface QueueReplayState {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  merges: MergeResult[];
}

/**
 * Fold the recorded event log up to `upTo` — the pure half of `Playground`, kept free of the
 * `?raw` fixture import so it can be unit-tested in plain Bun.
 */
export function replayQueue(events: readonly StarlingEvent[], upTo: number): QueueReplayState {
  const state: QueueReplayState = { tasks: {}, merges: [] };
  for (let index = 0; index <= upTo && index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    switch (event.type) {
      case 'run.created':
        state.plan = event.payload.run.plan;
        for (const [key, run] of Object.entries(event.payload.run.tasks)) state.tasks[key] = run;
        break;
      case 'task.status':
        state.tasks[event.payload.taskKey] = event.payload.run;
        break;
      case 'merge.result':
        state.merges.push(event.payload);
        break;
      default:
        break;
    }
  }
  return state;
}
