// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
import type { NodeInfo, Run, StarlingEvent } from '@starling/core';

export interface SkyViewProps {
  run?: Run;
  nodes: NodeInfo[];
  recent: StarlingEvent[];
  selectedTask?: string;
  onSelectTask(key: string): void;
  reducedMotion?: boolean;
}
