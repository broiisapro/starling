import type { RunMetrics, TokenUsage } from './contracts';

export interface ModelPricing {
  /** USD per million uncached input tokens. */
  inputPerM: number;
  /** USD per million cache-hit input tokens. */
  cachedInputPerM: number;
  /** USD per million output tokens. */
  outputPerM: number;
}

/**
 * Prices in USD per million tokens, keyed by model id (and by `provider/model` for convenience).
 *
 * Source: DeepSeek's "Models & Pricing" page, <https://api-docs.deepseek.com/quick_start/pricing>,
 * read on 2026-10-27 for `deepseek-flash` = **DeepSeek-V4.1-Flash-1017**. DeepSeek quotes two
 * tariffs (off-peak is exactly half of peak; peak is 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri):
 *
 * | per 1M tokens      | off-peak | peak  |
 * |--------------------|----------|-------|
 * | input, cache miss  | $0.15    | $0.30 |
 * | input, cache hit   | $0.003   | $0.006|
 * | output             | $0.60    | $1.20 |
 *
 * We bill at the **peak** rate on purpose: this table feeds the `budget.maxUsd` guardrail, and a
 * guardrail must never under-count a run that happens to land in peak hours. Halve the input and
 * output figures if you would rather report a typical (off-peak) bill.
 *
 * Local models cost nothing, which is the entire point of the cost meter.
 */
export const PRICING: Record<string, ModelPricing> = {
  'deepseek-v4.1-flash': { inputPerM: 0.3, cachedInputPerM: 0.006, outputPerM: 1.2 },
  'deepseek/deepseek-v4.1-flash': { inputPerM: 0.3, cachedInputPerM: 0.006, outputPerM: 1.2 },
  // Legacy alias accepted by the DeepSeek API; served by V4.1 Flash and billed at Flash prices.
  'deepseek-flash': { inputPerM: 0.3, cachedInputPerM: 0.006, outputPerM: 1.2 },
  'deepseek/deepseek-flash': { inputPerM: 0.3, cachedInputPerM: 0.006, outputPerM: 1.2 },
  'qwen3.6:35b-a3b': { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 },
  'ollama/qwen3.6:35b-a3b': { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 },
};

/** The API model a saved local token is compared against in the cost meter. */
export const DEFAULT_SAVED_MODEL = 'deepseek-v4.1-flash';

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cached: 0 };
}

/** Sum two token-usage records (pure; returns a new object). */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cached: a.cached + b.cached,
  };
}

/** `cached` is a subset of `input`, so only the uncached remainder pays the full input rate. */
export function usageCostUsd(model: string, usage: TokenUsage): number {
  const price = PRICING[model];
  if (price === undefined) return 0;
  const cached = Math.min(usage.cached, usage.input);
  const uncached = usage.input - cached;
  return (
    (uncached * price.inputPerM + cached * price.cachedInputPerM + usage.output * price.outputPerM) /
    1_000_000
  );
}

/** What the local tokens would have cost on the API — the number the cost meter celebrates. */
export function estimateSavedUsd(localUsage: TokenUsage, model = DEFAULT_SAVED_MODEL): number {
  return usageCostUsd(model, localUsage);
}

export function emptyMetrics(): RunMetrics {
  return {
    agentsActive: 0,
    tasksMerged: 0,
    tasksFailed: 0,
    apiUsage: emptyUsage(),
    localUsage: emptyUsage(),
    apiCostUsd: 0,
    localCallCount: 0,
    estSavedUsd: 0,
    elapsedMs: 0,
  };
}

/** Record one model call in the metrics. Pure; returns a new RunMetrics. */
export function withCall(
  metrics: RunMetrics,
  call: { usage: TokenUsage; model: string; local: boolean; costUsd?: number },
): RunMetrics {
  if (call.local) {
    const localUsage = addUsage(metrics.localUsage, call.usage);
    return {
      ...metrics,
      localUsage,
      localCallCount: metrics.localCallCount + 1,
      estSavedUsd: estimateSavedUsd(localUsage),
    };
  }
  return {
    ...metrics,
    apiUsage: addUsage(metrics.apiUsage, call.usage),
    apiCostUsd: metrics.apiCostUsd + (call.costUsd ?? usageCostUsd(call.model, call.usage)),
  };
}
