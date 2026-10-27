/**
 * The peak / off-peak note under the API number.
 *
 * `@starling/core`'s `PRICING` table bills DeepSeek at its **peak** tariff on purpose: it feeds the
 * `budget.maxUsd` guardrail, and a guardrail must never under-count a run that lands in peak hours.
 * DeepSeek's off-peak tariff is exactly half of peak (input, cached input and output alike), so the
 * meter can show both without a second price table — the ratio is the only fact it needs.
 *
 * This module does not import `PRICING` at runtime: `apps/web` deliberately keeps `@starling/core`'s
 * entry point (and its zod/config graph) out of the browser bundle (see `src/lib/events.ts`). The
 * assumption is pinned to core's table by `pricing.test.ts`, which runs in Bun and *does* import it:
 * if DeepSeek's numbers or the peak ratio change, that test fails before this note can drift.
 */
import { formatTokensExact, formatUsd } from './format';

export const PEAK_MODEL = 'deepseek-v4.1-flash';

/** Off-peak is half of peak for every DeepSeek line item (input, cached input, output). */
export const OFF_PEAK_RATIO = 0.5;

/** The model whose peak prices back the "you saved" estimate (mirrors core's `DEFAULT_SAVED_MODEL`). */
export const SAVED_MODEL = PEAK_MODEL;

export interface PeakNote {
  peakUsd: number;
  offPeakUsd: number;
  /** Human line for the meter, e.g. "peak rates · off-peak ≈ $0.02". */
  text: string;
  /** The long explanation for the tooltip. */
  detail: string;
}

export function offPeakUsd(peakSpendUsd: number, ratio = OFF_PEAK_RATIO): number {
  if (!Number.isFinite(peakSpendUsd) || peakSpendUsd <= 0) return 0;
  return peakSpendUsd * ratio;
}

/** The note under the API spend, or `undefined` when the panel has nothing to price yet. */
export function peakNote(apiSpendUsd: number): PeakNote | undefined {
  if (!Number.isFinite(apiSpendUsd)) return undefined;
  const peak = Math.max(0, apiSpendUsd);
  const offPeak = offPeakUsd(peak);
  return {
    peakUsd: peak,
    offPeakUsd: offPeak,
    // One short line: the label above already says "API · DeepSeek", and the tooltip carries the
    // long explanation. At 1280 px the column is ~110 px wide, and a wrapped note would push the
    // counters below the fold in the fixed-height strip.
    text: `off-peak ${formatUsd(offPeak)}`,
    detail:
      'The meter bills DeepSeek at its peak tariff so the budget guardrail never under-counts. ' +
      `Off-peak is exactly half of peak, so this run would cost about ${formatUsd(offPeak)} in off-peak hours.`,
  };
}

/** The explanation under "You saved": local tokens are priced as if they had gone to the API. */
export function savedDetail(localTokens: { input: number; output: number; cached: number }): string {
  const total = Math.max(0, localTokens.input) + Math.max(0, localTokens.output);
  return (
    `Estimate: ${formatTokensExact(total)} local tokens priced at ${PEAK_MODEL}'s peak rates ` +
    '($0.30/M uncached in, $0.006/M cached in, $1.20/M out). Nothing was actually billed for them.'
  );
}
