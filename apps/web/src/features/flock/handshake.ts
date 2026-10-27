// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
import type { NodeInfo, TaskRun } from '@starling/core';

/** Join details the hub hands out so another laptop can become a perch (ARCHITECTURE §8, FlockHub.joinInfo). */
export interface JoinInfo {
  code: string;
  hubUrl: string;
  command: string;
}

/** Props the shell (Epic 23 / C1) passes to the flock panel. No global store access, ever. */
export interface FlockPanelProps {
  nodes: NodeInfo[];
  join?: JoinInfo;
  tasks: Record<string, TaskRun>;
}
