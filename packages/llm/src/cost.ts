import type { ModelRef, TokenUsage } from '@starling/core';
import { PRICING, usageCostUsd } from '@starling/core';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** True when a provider base URL points at this machine, which makes every token free. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Pricing keys to try, most specific first.
 *
 * The opencode profile stores `opencode-go/deepseek-v4.1-flash` so the provider can split it into
 * providerID/modelID. `PRICING` is keyed by model id, so the part after the slash is the fallback.
 */
export function pricingKeys(model: ModelRef): string[] {
  const keys = [`${model.provider}/${model.model}`, model.model];
  const slash = model.model.indexOf('/');
  if (slash > 0 && slash < model.model.length - 1) {
    const tail = model.model.slice(slash + 1);
    keys.push(tail, `${model.provider}/${tail}`);
  }
  return [...new Set(keys)];
}

/** Cost in USD, or exactly 0 for local providers regardless of token counts. */
export function costOf(model: ModelRef, usage: TokenUsage, local: boolean): number {
  if (local) return 0;
  for (const key of pricingKeys(model)) {
    if (key in PRICING) return usageCostUsd(key, usage);
  }
  return 0;
}
