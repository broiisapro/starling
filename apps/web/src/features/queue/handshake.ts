// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
//
// Only the interfaces this lane implements are mirrored here, copied verbatim from §8. The shell
// (Epic 23) builds these props in `src/data/selectors.ts`; `MergeQueue` never reads a global store.
import type { MergeResult, Plan, TaskRun } from '@starling/core';

export interface MergeQueueProps {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  merges: MergeResult[];
  onSelectTask(key: string): void;
}
