// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
//
// Only the interfaces this lane implements are mirrored here, copied verbatim from §8. The shell
// (Epic 23) builds these props in `src/data/selectors.ts`; `MetricsPanel` never reads a global store.
import type { RunMetrics } from '@starling/core';

export interface MetricsPanelProps {
  metrics?: RunMetrics;
  history: { ts: number; metrics: RunMetrics }[];
}
