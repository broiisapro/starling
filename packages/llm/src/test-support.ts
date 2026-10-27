/**
 * Test-only helpers. Not exported from `index.ts`, so production bundles never see them.
 *
 * Everything runs against `Bun.serve({ port: 0 })` on 127.0.0.1 — no network, no real model.
 */

import type { ModelsConfig, ProviderConfig, StarlingConfig } from '@starling/core';
import { StarlingConfigSchema } from '@starling/core';

export interface FakeChatRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
  headers: Headers;
}

export interface FakeChatReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
}

export type FakeChatHandler = (req: FakeChatRequest, index: number) => FakeChatReply | Promise<FakeChatReply>;

export interface FakeChatServer {
  url: string;
  baseURL: string;
  requests: FakeChatRequest[];
  close(): void;
}

/** A throwaway OpenAI-compatible endpoint. `baseURL` already ends in `/v1`. */
export function startFakeChatServer(handler: FakeChatHandler): FakeChatServer {
  const requests: FakeChatRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await request.json();
        if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
      } catch {
        body = {};
      }
      const entry: FakeChatRequest = {
        method: request.method,
        path: url.pathname,
        body,
        headers: request.headers,
      };
      requests.push(entry);
      const reply = await handler(entry, requests.length - 1);
      if (reply.delayMs !== undefined) await Bun.sleep(reply.delayMs);
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json', ...reply.headers },
      });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return { url, baseURL: `${url}/v1`, requests, close: () => server.stop(true) };
}

export interface ChatUsageParts {
  input?: number;
  output?: number;
  cached?: number;
}

/** A realistic `chat.completion` body. */
export function chatReply(content: string, usage: ChatUsageParts = {}): FakeChatReply {
  const input = usage.input ?? 100;
  const output = usage.output ?? 20;
  return {
    body: {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: input,
        completion_tokens: output,
        total_tokens: input + output,
        prompt_tokens_details: { cached_tokens: usage.cached ?? 0 },
      },
    },
  };
}

/** Build a validated config with only the providers/models a test cares about. */
export function testConfig(
  providers: Record<string, ProviderConfig>,
  models?: Partial<ModelsConfig>,
): StarlingConfig {
  return StarlingConfigSchema.parse({
    providers,
    ...(models === undefined ? {} : { models }),
  });
}

export function errorReply(
  status: number,
  message = 'fake failure',
  headers: Record<string, string> = {},
): FakeChatReply {
  return { status, body: { error: { message, type: 'fake_error' } }, headers };
}
