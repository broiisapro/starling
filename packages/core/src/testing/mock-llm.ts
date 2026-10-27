import type { ZodType } from 'zod';
import type { ModelRef } from '../contracts';
import { StarlingError } from '../errors';
import type { LLM, LLMRequest, LLMResponse } from '../ports';

export type MockLLMResponder = (req: LLMRequest) => Partial<LLMResponse> | Promise<Partial<LLMResponse>>;

export interface MockLLMOptions {
  /** Consumed in order, one per call. When empty the `responder` (if any) takes over. */
  responses?: Array<Partial<LLMResponse>>;
  responder?: MockLLMResponder;
  model?: ModelRef;
  local?: boolean;
}

const DEFAULT_MODEL: ModelRef = { provider: 'ollama', model: 'qwen3.6:35b-a3b' };

/**
 * Scripted `LLM` double.
 *
 * `completeJson` runs the real zod schema, so a test that scripts bad JSON fails the same way
 * production would. Requests are recorded in `calls` for assertions.
 */
export class MockLLM implements LLM {
  readonly calls: LLMRequest[] = [];
  readonly #responses: Array<Partial<LLMResponse>>;
  readonly #responder: MockLLMResponder | undefined;
  readonly #defaults: Partial<LLMResponse>;

  constructor(options: MockLLMOptions = {}) {
    this.#responses = [...(options.responses ?? [])];
    this.#responder = options.responder;
    this.#defaults = {
      model: options.model ?? DEFAULT_MODEL,
      local: options.local ?? true,
      usage: { input: 100, output: 20, cached: 0 },
      costUsd: 0,
    };
  }

  /** Queue more scripted responses (e.g. between assertions). */
  push(...responses: Array<Partial<LLMResponse>>): void {
    this.#responses.push(...responses);
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    const scripted = this.#responses.shift() ?? (this.#responder ? await this.#responder(req) : undefined);
    if (scripted === undefined) {
      throw new StarlingError('LLM_ERROR', 'MockLLM has no scripted response left', {
        details: { role: req.role },
      });
    }
    return {
      text: scripted.text ?? '',
      ...(scripted.parsed === undefined ? {} : { parsed: scripted.parsed }),
      usage: scripted.usage ?? this.#defaults.usage ?? { input: 0, output: 0, cached: 0 },
      model: scripted.model ?? this.#defaults.model ?? DEFAULT_MODEL,
      costUsd: scripted.costUsd ?? this.#defaults.costUsd ?? 0,
      local: scripted.local ?? this.#defaults.local ?? true,
    };
  }

  async completeJson<T>(req: LLMRequest, schema: ZodType<T>): Promise<LLMResponse<T>> {
    const res = await this.complete(req);
    let candidate: unknown = res.parsed;
    if (candidate === undefined) {
      try {
        candidate = JSON.parse(res.text);
      } catch (err) {
        throw new StarlingError('LLM_ERROR', 'MockLLM response was not valid JSON', { cause: err });
      }
    }
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      throw new StarlingError(
        'LLM_ERROR',
        `MockLLM response failed schema validation: ${parsed.error.message}`,
        {
          cause: parsed.error,
        },
      );
    }
    return { ...res, parsed: parsed.data };
  }
}
