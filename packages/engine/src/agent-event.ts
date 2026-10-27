/** Defensive parsing of the open-ended `AgentEvent.data` envelope (see ARCHITECTURE §6). */
import type { ModelRef, StarlingConfig, TokenUsage } from '@starling/core';

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Pull `{input, output, cached}` out of a usage event. Providers differ on whether the counts sit
 * at the top level or under `usage`, so both are accepted; a missing count is treated as zero.
 */
export function parseUsage(data: Record<string, unknown>): TokenUsage | undefined {
  const nested = asRecord(data.usage);
  const source = nested ?? data;
  const input = readCount(source.input) ?? readCount(source.promptTokens);
  const output = readCount(source.output) ?? readCount(source.completionTokens);
  const cached = readCount(source.cached) ?? readCount(source.cachedTokens) ?? 0;
  if (input === undefined && output === undefined) return undefined;
  return { input: input ?? 0, output: output ?? 0, cached };
}

/** A `ModelRef` carried in event data, when the provider names the model that answered. */
export function parseModel(value: unknown): ModelRef | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') return undefined;
  return { provider: record.provider, model: record.model };
}

/**
 * Local vs API, from config rather than hard-coded provider names: a provider with no API key is
 * something running on this machine (Ollama, llama.cpp, LM Studio, a lent perch model).
 */
export function isLocalProvider(config: StarlingConfig, provider: string): boolean {
  if (provider === 'ollama' || provider === 'local') return true;
  const endpoint = config.providers[provider];
  return endpoint !== undefined && endpoint.apiKeyEnv === undefined;
}

/** Pricing key: `provider/model` is accepted by the core table, and the bare id is a fallback. */
export function pricingKey(model: ModelRef): string {
  return `${model.provider}/${model.model}`;
}
