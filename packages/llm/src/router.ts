import type {
  EventBus,
  LLMRequest,
  LLMResponse,
  ModelRef,
  ModelRole,
  ProviderConfig,
  StarlingConfig,
  TokenUsage,
} from '@starling/core';
import { addUsage, emptyUsage, modelFor, StarlingError, systemClock } from '@starling/core';
import type { ZodType } from 'zod';
import { costOf, isLocalBaseUrl } from './cost';
import { badJsonError, llmError } from './errors';
import { extractJson, formatIssues, jsonInstruction, schemaName, toJsonSchemaSafe } from './json';
import {
  completeOpenAICompatible,
  type ResponseFormat,
  supportsJsonSchema,
} from './providers/openai-compatible';
import { createOpencodeCompletionClient } from './providers/opencode';
import { DEFAULT_RETRY, withRetries, withTimeout } from './retry';
import type {
  CallOptions,
  LLMClient,
  LLMOptions,
  LLMProviderKind,
  OpencodeCompletionClient,
  RetryOptions,
} from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const REPAIR_ATTEMPTS = 2;

interface ResolvedModel {
  ref: ModelRef;
  settings: ProviderConfig;
  kind: LLMProviderKind;
  local: boolean;
}

/** The provider *name* selects the family: `opencode` is the user's server, everything else is
 * OpenAI-compatible. This keeps `ProviderConfig` (locked in core) unchanged. */
export function providerKind(name: string): LLMProviderKind {
  return name === 'opencode' ? 'opencode' : 'openai-compatible';
}

/** Role → provider settings, with the local/cost flags the response and the meter need. */
export function resolveModel(config: StarlingConfig, role: ModelRole): ResolvedModel {
  const ref = modelFor(config, role);
  const settings = config.providers[ref.provider];
  if (settings === undefined) {
    throw new StarlingError('CONFIG_INVALID', `No provider "${ref.provider}" configured for role "${role}"`, {
      details: { role, provider: ref.provider, configured: Object.keys(config.providers) },
    });
  }
  const kind = providerKind(ref.provider);
  // The opencode server runs locally but proxies to a remote model (opencode-go), so it is *not*
  // free: only an OpenAI-compatible endpoint on a loopback host is.
  const local = kind === 'openai-compatible' && isLocalBaseUrl(settings.baseUrl);
  return { ref, settings, kind, local };
}

/** Split `opencode-go/deepseek-v4.1-flash` into the two ids opencode's API wants. */
export function splitOpencodeModel(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) {
    throw new StarlingError(
      'CONFIG_INVALID',
      `opencode model "${model}" must look like "providerID/modelID"`,
      {
        details: { model },
      },
    );
  }
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

function apiKeyFor(settings: ProviderConfig, env: Record<string, string | undefined>): string {
  if (settings.apiKeyEnv === undefined) return 'not-needed';
  const key = env[settings.apiKeyEnv];
  if (key === undefined || key === '') {
    throw new StarlingError('CONFIG_INVALID', `Missing API key: set ${settings.apiKeyEnv}`, {
      details: { apiKeyEnv: settings.apiKeyEnv },
    });
  }
  return key;
}

/** A flat transcript for providers that take one prompt instead of a message array. */
export function renderConversation(messages: LLMRequest['messages']): string {
  const first = messages[0];
  if (messages.length === 1 && first?.role === 'user') return first.content;
  return messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
}

function mergeRetry(partial: Partial<RetryOptions> | undefined): RetryOptions {
  return { ...DEFAULT_RETRY, ...partial };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build the LLM router. One instance owns provider clients, retry policy and structured output for
 * every role; calls are independent and safe to run concurrently.
 */
export function createLLM(config: StarlingConfig, opts: LLMOptions = {}): LLMClient {
  const fetcher = opts.fetch ?? fetch;
  const clock = opts.clock ?? systemClock;
  const bus: EventBus | undefined = opts.bus;
  const env = opts.env ?? process.env;
  const retry = mergeRetry(opts.retry);
  const defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let opencodeClient: OpencodeCompletionClient | undefined = opts.opencode;

  const log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string): void => {
    bus?.publish({ type: 'log', runId: '*', ts: clock.now(), payload: { level, msg } });
  };

  function getOpencodeClient(settings: ProviderConfig): OpencodeCompletionClient {
    if (opencodeClient !== undefined) return opencodeClient;
    const password = settings.apiKeyEnv === undefined ? undefined : env[settings.apiKeyEnv];
    opencodeClient = createOpencodeCompletionClient({
      baseUrl: settings.baseUrl,
      password,
      fetch: fetcher,
      onCleanupError: (err) => log('warn', `opencode session cleanup failed: ${errorText(err)}`),
    });
    return opencodeClient;
  }

  async function invokeOnce(
    resolved: ResolvedModel,
    req: LLMRequest,
    responseFormat: ResponseFormat | undefined,
    callOpts: CallOptions,
  ): Promise<{ text: string; usage: TokenUsage; usageKnown?: boolean }> {
    const timeoutMs = callOpts.timeoutMs ?? defaultTimeoutMs;
    const timeout = withTimeout(callOpts.signal, timeoutMs);
    try {
      if (resolved.kind === 'opencode') {
        const ids = splitOpencodeModel(resolved.ref.model);
        const reply = await getOpencodeClient(resolved.settings).complete({
          system: req.system,
          prompt: renderConversation(req.messages),
          providerID: ids.providerID,
          modelID: ids.modelID,
          signal: timeout.signal,
        });
        return { text: reply.text, usage: reply.usage, usageKnown: reply.usageKnown !== false };
      }
      return await completeOpenAICompatible({
        settings: resolved.settings,
        apiKey: apiKeyFor(resolved.settings, env),
        model: resolved.ref.model,
        request: req,
        responseFormat,
        signal: timeout.signal,
        fetch: fetcher,
      });
    } catch (err) {
      if (timeout.didTimeout()) {
        throw llmError('timeout', `LLM call timed out after ${timeoutMs} ms`, {
          provider: resolved.ref.provider,
          model: resolved.ref.model,
          timeoutMs,
        });
      }
      if (callOpts.signal?.aborted) {
        throw llmError('aborted', 'LLM call was aborted', {
          provider: resolved.ref.provider,
          model: resolved.ref.model,
        });
      }
      throw err;
    } finally {
      timeout.dispose();
    }
  }

  async function invoke(
    resolved: ResolvedModel,
    req: LLMRequest,
    responseFormat: ResponseFormat | undefined,
    callOpts: CallOptions,
  ): Promise<LLMResponse> {
    const started = clock.now();
    let attempts = 0;
    let reply: { text: string; usage: TokenUsage; usageKnown?: boolean };
    try {
      reply = await withRetries(
        async (attempt) => {
          attempts = attempt;
          return invokeOnce(resolved, req, responseFormat, callOpts);
        },
        retry,
        {
          signal: callOpts.signal,
          onRetry: ({ attempt, delayMs, error }) =>
            log(
              'warn',
              `llm ${req.role} ${resolved.ref.provider}/${resolved.ref.model} attempt ${attempt} failed (${errorText(
                error,
              )}); retrying in ${delayMs} ms`,
            ),
        },
      );
    } catch (err) {
      if (callOpts.signal?.aborted) {
        throw llmError('aborted', 'LLM call was aborted', {
          provider: resolved.ref.provider,
          model: resolved.ref.model,
        });
      }
      if (err instanceof StarlingError) throw err;
      throw new StarlingError(
        'LLM_ERROR',
        `LLM call failed for ${req.role} on ${resolved.ref.provider}/${resolved.ref.model}: ${errorText(err)}`,
        {
          cause: err,
          details: {
            reason: 'provider',
            role: req.role,
            provider: resolved.ref.provider,
            model: resolved.ref.model,
            attempts,
          },
        },
      );
    }

    const response: LLMResponse = {
      text: reply.text,
      usage: reply.usage,
      model: resolved.ref,
      costUsd: costOf(resolved.ref, reply.usage, resolved.local),
      local: resolved.local,
    };
    const elapsedMs = clock.now() - started;
    const usageNote =
      reply.usageKnown === false
        ? ' usage=unknown (the provider reported no token totals; cost is 0, not measured)'
        : ` in=${response.usage.input} out=${response.usage.output} cached=${response.usage.cached}`;
    log(
      'debug',
      `llm ${req.role} ${response.model.provider}/${response.model.model} ${elapsedMs}ms` +
        usageNote +
        ` cost=$${response.costUsd.toFixed(6)} local=${response.local} attempts=${attempts}`,
    );
    return response;
  }

  function responseFormatFor(
    resolved: ResolvedModel,
    schemaJson: Record<string, unknown> | undefined,
    name: string,
  ): ResponseFormat | undefined {
    if (resolved.kind !== 'openai-compatible' || schemaJson === undefined) return undefined;
    if (supportsJsonSchema(resolved.settings.baseUrl)) {
      return { type: 'json_schema', json_schema: { name, schema: schemaJson, strict: true } };
    }
    return { type: 'json_object' };
  }

  return {
    async complete(req, callOpts = {}) {
      return invoke(resolveModel(config, req.role), req, undefined, callOpts);
    },

    async completeJson<T>(
      req: LLMRequest,
      schema: ZodType<T>,
      callOpts: CallOptions = {},
    ): Promise<LLMResponse<T>> {
      const resolved = resolveModel(config, req.role);
      const schemaJson = toJsonSchemaSafe(schema);
      const name = schemaName(req.role);
      const responseFormat = responseFormatFor(resolved, schemaJson, name);
      const system = `${req.system}\n\n${jsonInstruction(schemaJson)}`;
      let messages = [...req.messages];
      let usage: TokenUsage = emptyUsage();
      let costUsd = 0;
      let lastText = '';
      let lastProblem = '';

      for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt++) {
        const response = await invoke(resolved, { ...req, system, messages }, responseFormat, callOpts);
        lastText = response.text;
        usage = addUsage(usage, response.usage);
        costUsd += response.costUsd;

        const extracted = extractJson(lastText);
        if (extracted.ok) {
          const checked = schema.safeParse(extracted.value);
          if (checked.success) return { ...response, parsed: checked.data, usage, costUsd };
          lastProblem = `JSON did not match the schema: ${formatIssues(checked.error)}`;
        } else {
          lastProblem = `Response was not JSON: ${extracted.error}`;
        }

        if (attempt < REPAIR_ATTEMPTS) {
          messages = [
            ...messages,
            { role: 'assistant', content: lastText },
            {
              role: 'user',
              content:
                `${lastProblem}\n\nReply again with ONLY the corrected JSON value. ` +
                'No prose, no Markdown fences, no trailing text.',
            },
          ];
        }
      }

      throw badJsonError(
        `Model ${resolved.ref.provider}/${resolved.ref.model} did not produce JSON matching the schema ` +
          `after ${REPAIR_ATTEMPTS + 1} attempts`,
        {
          raw: lastText,
          issues: lastProblem,
          attempts: REPAIR_ATTEMPTS + 1,
          usage,
        },
      );
    },
  };
}
