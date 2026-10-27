// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
import type { Plan, TaskRun } from '@starling/core';

export interface DagViewProps {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  selectedTask?: string;
  onSelectTask(key: string): void;
}
