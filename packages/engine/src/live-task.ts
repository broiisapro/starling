/** Per-task runtime state. Not part of the persisted contract: `TaskRun` is the durable shape. */
import type { ExecutionNode, TaskHandle, TaskSpec } from '@starling/core';

export interface LiveTask {
  key: string;
  spec: TaskSpec;
  node?: ExecutionNode;
  nodeId?: string;
  handle?: TaskHandle;
  /** Bumped whenever a session is abandoned (migration, cancel): stale pipeline steps bail out. */
  generation: number;
  /** Serialises lifecycle steps for this task: start → audit → merge → fix → audit … */
  chain: Promise<void>;
  migrationFrom?: string;
  migrationReason?: string;
}
