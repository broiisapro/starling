/**
 * Is Ollama actually there, and is the model we chose actually pulled?
 *
 * The `mixed` profile promises "auditor local when available, otherwise opencode with a warning".
 * "Available" has to mean both things: the daemon answers **and** the model is present. Checking
 * only the port produces a run that dies on the first audit with a 404 from Ollama, which is worse
 * than falling back.
 *
 * This probe never throws. A dead daemon, a timeout and a garbage body all become `ok: false` with a
 * reason, because the caller's job is to fall back, not to handle errors.
 */

import type { ProfileWarningCode } from './profiles';
import { LOCAL_BASE_URL } from './profiles';

export interface OllamaProbeOptions {
  /** OpenAI-compatible (`…/v1`) or native (`…:11434`) base URL. */
  baseUrl?: string;
  /** Model tag to require, e.g. `qwen3.8:27b-mlx`. Omit to only check reachability. */
  model?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Default 1500 ms — a fallback decision must not stall a run. */
  timeoutMs?: number;
}

export interface OllamaProbe {
  ok: boolean;
  reachable: boolean;
  /** Tags Ollama reported (empty when unreachable or when the body was unreadable). */
  models: string[];
  /** True only when `model` was given and found. */
  hasModel: boolean;
  code?: ProfileWarningCode;
  /** Short, log-safe explanation. Never contains a response body larger than 200 chars. */
  detail: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 1500;

/** `http://127.0.0.1:11434/v1` and `http://127.0.0.1:11434/` both become `http://127.0.0.1:11434`. */
export function nativeOllamaUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

interface TagsBody {
  models?: { name?: string; model?: string }[];
}

function tagsOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const models = (body as TagsBody).models;
  if (!Array.isArray(models)) return [];
  const tags: string[] = [];
  for (const entry of models) {
    const tag = entry?.model ?? entry?.name;
    if (typeof tag === 'string' && tag !== '') tags.push(tag);
  }
  return tags;
}

function detailText(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : err.name;
    return `${name}: ${err.message}`.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

/**
 * Ask Ollama for its tags. Resolves in at most `timeoutMs`.
 *
 * Uses the native `/api/tags` route rather than `/v1/models` because tags are exactly what
 * opencode's `ollama` providerID and the router's model field need — no mapping required.
 */
export async function probeOllama(options: OllamaProbeOptions = {}): Promise<OllamaProbe> {
  const fetcher = options.fetch ?? fetch;
  const base = nativeOllamaUrl(options.baseUrl ?? LOCAL_BASE_URL);
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetcher(`${base}/api/tags`, { signal, headers: { accept: 'application/json' } });
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      models: [],
      hasModel: false,
      code: 'local-unavailable',
      detail: `Ollama is not reachable at ${base} (${detailText(err)})`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reachable: false,
      models: [],
      hasModel: false,
      code: 'local-unavailable',
      detail: `Ollama at ${base} answered ${response.status}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      reachable: true,
      models: [],
      hasModel: false,
      code: 'local-unavailable',
      detail: `Ollama at ${base} returned an unreadable body (${detailText(err)})`,
    };
  }

  const models = tagsOf(body);
  if (options.model === undefined) {
    return {
      ok: true,
      reachable: true,
      models,
      hasModel: false,
      detail: `Ollama is up at ${base} with ${models.length} model(s)`,
    };
  }

  const hasModel = models.includes(options.model);
  if (!hasModel) {
    return {
      ok: false,
      reachable: true,
      models,
      hasModel: false,
      code: 'local-model-missing',
      detail: `Ollama is up at ${base} but ${options.model} is not pulled (have: ${
        models.length === 0 ? 'none' : models.join(', ')
      })`,
    };
  }

  return {
    ok: true,
    reachable: true,
    models,
    hasModel: true,
    detail: `Ollama is up at ${base} and ${options.model} is present`,
  };
}
