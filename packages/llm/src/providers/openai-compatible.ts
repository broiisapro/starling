import type { LLMRequest, ProviderConfig, TokenUsage } from '@starling/core';
import OpenAI from 'openai';

/** The two request shapes the router uses. Kept local so provider code does not leak SDK types. */
export type ResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: { name: string; schema: Record<string, unknown>; strict: boolean };
    };

export interface OpenAICompatibleCall {
  settings: ProviderConfig;
  apiKey: string;
  model: string;
  request: LLMRequest;
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
  fetch: typeof fetch;
}

export interface ProviderReply {
  text: string;
  usage: TokenUsage;
}

/** DeepSeek's `usage` has cache-hit counts at the top level; OpenAI nests them under details. */
type UsageWithDeepSeekCache = {
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
};

function toUsage(usage: UsageWithDeepSeekCache | undefined): TokenUsage {
  const input = (usage as { prompt_tokens?: number } | undefined)?.prompt_tokens ?? 0;
  const output = (usage as { completion_tokens?: number } | undefined)?.completion_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0;
  return { input, output, cached: Math.min(cached, input) };
}

/**
 * One chat completion over any OpenAI-compatible endpoint: DeepSeek, Ollama, OpenRouter, vLLM.
 *
 * Retries and timeouts live in the router (they must cover both providers); this function does a
 * single HTTP request with `maxRetries: 0` so the attempt count is ours, not the SDK's.
 */
export async function completeOpenAICompatible(call: OpenAICompatibleCall): Promise<ProviderReply> {
  const client = new OpenAI({
    apiKey: call.apiKey,
    baseURL: call.settings.baseUrl,
    fetch: call.fetch,
    maxRetries: 0,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: call.request.system },
    ...call.request.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // Errors propagate untouched: the router's retry policy needs the SDK's `status` / error class.
  const completion = await client.chat.completions.create(
    {
      model: call.model,
      messages,
      ...(call.request.temperature === undefined ? {} : { temperature: call.request.temperature }),
      ...(call.request.maxTokens === undefined ? {} : { max_tokens: call.request.maxTokens }),
      ...(call.responseFormat === undefined ? {} : { response_format: call.responseFormat }),
    },
    { signal: call.signal },
  );

  const choice = completion.choices[0];
  const text = choice?.message?.content ?? '';
  return { text, usage: toUsage(completion.usage) };
}

/**
 * DeepSeek's documented structured-output mode is `json_object` only (its API guide, checked
 * 2026-10-27); Ollama and most other OpenAI-compatible servers accept `json_schema`.
 */
export function supportsJsonSchema(baseUrl: string): boolean {
  try {
    return !new URL(baseUrl).hostname.endsWith('deepseek.com');
  } catch {
    return true;
  }
}
