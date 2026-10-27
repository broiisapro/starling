// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
import type { AgentEvent, AuditVerdict, DiffSummary, TaskRun, TaskSpec } from '@starling/core';

export interface AgentDrawerProps {
  task?: TaskSpec;
  run?: TaskRun;
  events: AgentEvent[];
  verdicts: AuditVerdict[];
  diff?: DiffSummary;
  onClose(): void;
}
