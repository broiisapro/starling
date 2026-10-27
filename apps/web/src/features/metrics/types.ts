import type { MetricsPanelProps } from './handshake';

/**
 * Additive props beyond ARCHITECTURE §8, declared as an intersection so `MetricsPanel` compiles
 * before and after core grows the field (C1 added `live`; this lane has shipped it as an extra
 * since Wave 1).
 *
 * - `live` freezes/ticks the elapsed clock explicitly instead of inferring liveness from sample age.
 * - `animate` forces the cost meter's count-up on (or off) regardless of liveness — the demo player
 *   can turn it on even though a replay's clock has already stopped.
 */
export interface MetricsExtras {
  live?: boolean;
  animate?: boolean;
}

export type MetricsPanelAllProps = MetricsPanelProps & MetricsExtras;
