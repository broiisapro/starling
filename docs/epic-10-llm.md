# Epic 10 — LLM router (DeepSeek, Ollama, opencode)

## Goal

Make `@starling/llm` the one place the rest of Starling asks a model a question:

```ts
llm.complete({ role: 'planner', system, messages }); // text
llm.completeJson({ role: 'auditor', system, messages }, schema); // validated, repaired T
```

The router resolves a **role** (`planner`, `auditor`, …) to a provider and model, speaks two provider
families (OpenAI-compatible HTTP and the user's own `opencode serve`), turns a zod schema into a
provider request, repairs malformed JSON up to twice, retries transient failures with backoff, and
reports token usage and cost so the dashboard's cost meter is honest. Local models cost exactly $0;
the router proves it with `usage` and `local` on every response.

## How it works

### Routing

```
role ──modelFor(config)──► ModelRef {provider, model}
      ──config.providers──► ProviderConfig {baseUrl, apiKeyEnv?}
      ──provider name────► 'opencode' | 'openai-compatible'
```

- Provider **name** selects the family. `opencode` is the user's server; any other name (`deepseek`,
  `ollama`, `openrouter`, …) is OpenAI-compatible. This keeps the locked `ProviderConfig` shape
  unchanged.
- `context.local` is true **only** for an OpenAI-compatible provider whose `baseUrl` host is
  loopback (`127.0.0.1`, `localhost`, `::1`, `0.0.0.0`). A local opencode _server_ is not free: it
  proxies to `opencode-go` or any other upstream, so `opencode` stays non-local and is priced from
  `PRICING`.
- API keys come from the env var named by `apiKeyEnv`. A provider without `apiKeyEnv` (Ollama) gets
  the placeholder `not-needed`; a _named but missing_ key is a `CONFIG_INVALID` error, not a silent
  401 later.

### Plain completions

`complete()` builds `[system, ...messages]`, adds `temperature` / `max_tokens` when given, and makes
one provider call per attempt. The openai-compatible path uses the `openai` SDK (pinned `7.45.0`)
with an injectable `fetch` and `maxRetries: 0` — the router owns retries so both providers share one
policy.

### Structured output

1. `z.toJSONSchema(schema)` (zod 4) produces the schema. If a schema cannot be represented, the
   router still sends the prompt-side instruction and relies on repair.
2. The system prompt gets a strict "reply with a single JSON value, no fences, no prose" instruction
   plus the JSON Schema. This is sent **even when** native structured output is available, because
   DeepSeek only has `json_object` and needs the word "JSON" (and the shape) in the prompt.
3. Request format:
   - DeepSeek (`*.deepseek.com`) → `response_format: {type: 'json_object'}`.
   - Ollama and other OpenAI-compatible servers → `response_format: {type: 'json_schema',
     json_schema: {name, schema, strict: true}}`.
   - opencode → no `response_format`; the schema goes in the prompt.
4. The reply is parsed leniently: code fences stripped, surrounding prose tolerated, the outermost
   balanced `{…}`/`[…]` extracted (string- and escape-aware). Then zod validates it.
5. On failure the router appends the model's bad reply as an `assistant` turn and a `user` repair
   turn containing the exact issue (`summary: expected string, received number`). Up to **2 repairs**
   (3 calls total). Usage and cost accumulate across repair turns; the returned `text` is the last
   reply.
6. Still bad → `StarlingError('LLM_ERROR')` with `details.reason = 'LLM_BAD_JSON'`, `details.raw`
   (last raw text), `details.issues`, `details.attempts` and `details.usage`. Use `isBadJsonError`.

### Retries, timeouts, abort

- Up to **3 attempts** on `408/409/429/5xx`, `TypeError` (fetch failure), `APIConnectionError`, and
  common socket codes (`ECONNRESET`, `ECONNREFUSED`, …). `4xx` other than 408/409/429 is permanent.
- Backoff: `baseDelayMs × 2^(attempt-1)` plus up to 50 % jitter, capped at `maxDelayMs` (defaults
  250 ms → 8 s). A server `Retry-After` (seconds **or** HTTP date) wins, capped at
  `maxRetryAfterMs` (60 s) so a broken header cannot park a run.
- Per-attempt timeout, default **120 s**, abortable. A timeout becomes `LLM_ERROR` with
  `details.reason = 'timeout'` and is not retried.
- `AbortSignal` support is exposed through `LLMClient`'s optional second argument
  (`complete(req, {signal, timeoutMs})`). The locked `LLM` port has no room for it; see the contract
  request below.

### Usage and cost

`TokenUsage {input, output, cached}`:

- OpenAI-compatible: `usage.prompt_tokens`, `usage.completion_tokens`, and
  `prompt_tokens_details.cached_tokens` **or** DeepSeek's top-level `prompt_cache_hit_tokens`.
- opencode: session `tokens` (`input`, `output`, `cache.read` as cached), read after the call.
- Cost: `0` for local providers, otherwise `usageCostUsd` from `@starling/core`'s `PRICING`. The
  router tries `provider/model`, `model`, and the part after a `providerID/` slash, so
  `opencode-go/deepseek-v4.1-flash` prices as `deepseek-v4.1-flash`.
- Each successful call publishes one `log`/`debug` event (`runId: '*'`): role, model, ms, tokens,
  cost, local, attempts. Each retry publishes a `log`/`warn`.

### Profiles and env wiring

`createLLMFromEnv()` = `loadConfig()` + `STARLING_LLM_PROFILE`:

| Profile              | Effect                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `deepseek` (default) | The config as written: planner/worker/resolver on DeepSeek, auditor/writer on Ollama.       |
| `local`              | Every role → `ollama/qwen3.6:35b-a3b` (the `--fully-open` promise).                         |
| `opencode`           | Every role → `opencode/opencode-go/deepseek-v4.1-flash` through the local `opencode serve`. |

An unknown profile is `CONFIG_INVALID`; it never silently falls back.

## opencode investigation (2.1.2, checked 2026-10-27)

`opencode --version` → **2.1.2**. `opencode serve --help` describes it as the "v2 API and web server".
On boot it prints:

```
server listening on http://127.0.0.1:<port>
server password <password>
```

Auth is **HTTP Basic**, username `opencode`, that password. `/doc` serves the web UI (`text/html`);
the OpenAPI document is at **`/openapi.json`** (also requires Basic auth).

| Method & path                                     | Request                                                                                                 | Response                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/session`                               | `{title?, model?: {id, providerID, variant?}, location?: {directory}, agent?, metadata?, permissions?}` | `200 {data: {id, projectID, model, cost, tokens: {input, output, reasoning, cache: {read, write}}, time: {created, updated, …}, location, …}}` |
| `POST /api/session/{sessionID}/generate`          | `{prompt: string}`                                                                                      | `200 {data: {text: string}}` — synchronous single turn, text only                                                                              |
| `GET /api/session/{sessionID}`                    | —                                                                                                       | `200 {data: {…, tokens: {input, output, reasoning, cache: {read, write}}, cost, …}}`                                                           |
| `DELETE /api/session/{sessionID}`                 | —                                                                                                       | `204`                                                                                                                                          |
| `POST /api/session/{sessionID}/prompt`            | `{text, files?, agents?, skills?, metadata?, delivery?, resume?}`                                       | `200 {data: Session.Inbox.User}` — **async queue**, not the assistant reply                                                                    |
| `POST /api/experimental/session/{sessionID}/wait` | —                                                                                                       | `204` when the agent loop is idle                                                                                                              |
| `GET /api/session/{sessionID}/message`            | query `limit?`, `order?=asc                                                                             | desc`, `cursor?`, `type?`                                                                                                                      | `200 {data: [Message.Info…], cursor: {previous, next}}` |

The adapter uses create → **generate** → get session (token totals) → delete. `generate` is the only
synchronous, text-only endpoint, which is exactly what a completion is. The prompt endpoint is a
durable queue intended for the agent loop, so it would need `wait` + message pagination and would
still be racy.

The legacy V1 routes (`/session`, `/app`, `/global/health`) return **the SPA HTML** on 2.1.2, and
`@opencode-ai/sdk@1.19.4`'s default client targets those paths. Its `v2` client is generated from an
older V2 spec (no `/generate`, no session delete, different prompt semantics). See _Deviations_.

### DeepSeek structured output

DeepSeek's JSON-mode guide (checked 2026-10-27) documents **only** `response_format:
{type: 'json_object'}`, with the word "json" and an example in the prompt. There is no `json_schema`
mode. The router therefore uses `json_object` for `*.deepseek.com` and `json_schema` elsewhere
(`supportsJsonSchema`), with prompt-side schema text for both.

## Interfaces for future epics

Everything is re-exported from `@starling/llm`'s root (`packages/llm/src/index.ts`).

```ts
// Construction
export function createLLM(config: StarlingConfig, opts?: LLMOptions): LLMClient;
export function createLLMFromEnv(opts?: LLMFromEnvOptions): LLMClient;

export interface LLMOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  bus?: EventBus;
  opencode?: OpencodeCompletionClient;
  retry?: Partial<RetryOptions>;
  timeoutMs?: number;                                  // default 120_000
  env?: Record<string, string | undefined>;            // default process.env
}
export interface LLMFromEnvOptions extends LLMOptions {
  config?: StarlingConfig; cwd?: string; configPath?: string;
}
export interface RetryOptions {
  maxAttempts: number; baseDelayMs: number; maxDelayMs: number; maxRetryAfterMs: number;
}

// The port, plus optional per-call controls (assignable to core's `LLM`)
export interface LLMClient extends LLM {
  complete(req: LLMRequest, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<LLMResponse>;
  completeJson<T>(req: LLMRequest, schema: ZodType<T>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<LLMResponse<T>>;
}

// opencode provider seam (tests inject a fake; the runner may supply a pre-built client)
export interface OpencodeCompletionClient {
  complete(req: { system: string; prompt: string; providerID: string; modelID: string; signal?: AbortSignal }):
    Promise<{ text: string; usage: TokenUsage }>;
}
export function createOpencodeCompletionClient(opts: {
  baseUrl: string; password?: string; fetch?: typeof fetch; directory?: string; agent?: string;
  title?: string; onCleanupError?: (err: unknown) => void;
}): OpencodeCompletionClient;

// Profiles
export const LLM_PROFILES: readonly ['opencode', 'deepseek', 'local'];
export type LLMProfileName = 'opencode' | 'deepseek' | 'local';
export function applyProfile(config: StarlingConfig, profile: LLMProfileName): StarlingConfig;
export function parseProfile(value: string | undefined): LLMProfileName;

// Errors
export const LLM_BAD_JSON = 'LLM_BAD_JSON';
export function isBadJsonError(err: unknown): err is StarlingError;

// Helpers (also useful to the planner/auditor epics)
export function resolveModel(config: StarlingConfig, role: ModelRole): {
  ref: ModelRef; settings: ProviderConfig; kind: 'opencode' | 'openai-compatible'; local: boolean;
};
export function splitOpencodeModel(model: string): { providerID: string; modelID: string };
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string };
export function toJsonSchemaSafe(schema: ZodType): Record<string, unknown> | undefined;
export function costOf(model: ModelRef, usage: TokenUsage, local: boolean): number;
export function isLocalBaseUrl(baseUrl: string): boolean;
```

Usage for the planner (Epic 12) and auditor (Epic 16):

```ts
import { createLLMFromEnv, isBadJsonError } from '@starling/llm';
import { PlanSchema } from '@starling/core';

const llm = createLLMFromEnv({ bus, timeoutMs: 90_000 });

try {
  const res = await llm.completeJson(
    {
      role: 'planner',
      system: plannerPrompt,
      messages: [{ role: 'user', content: goal.text }],
      maxTokens: 8_000,
    },
    PlanSchema,
    { signal: runAbort.signal },
  );
  res.parsed; // Plan, typed and validated
  res.usage; // roll into RunMetrics with withCall()
  res.costUsd; // honest meter
  res.local; // true for Ollama
} catch (err) {
  if (isBadJsonError(err)) {
    // err.details.raw / .issues are safe to log
  }
  throw err;
}
```

The auditor should pass `role: 'auditor'` and its own zod verdict schema; the writer/ summarizer can
use `complete()` for prose.

## Deviations from plan

- **No `@opencode-ai/sdk` call path (the dependency is still pinned).** The installed server is
  2.1.2; the SDK's V1 client targets `/session`-style routes that now return the SPA HTML, and the
  SDK's V2 client is generated from an older spec without `/generate` or session delete. The
  adapter therefore speaks the live V2 REST API directly, against the shapes read from
  `/openapi.json`. The dependency is kept at `1.19.4` (same pin as `packages/runner`) so the
  handshake stays consistent, but it is not used at runtime yet.
- **`LLM_BAD_JSON` is a reason, not an error code.** `@starling/core`'s locked `StarlingErrorCode`
  union has no `LLM_BAD_JSON`. The router throws `LLM_ERROR` with
  `details.reason = 'LLM_BAD_JSON'` and exports `isBadJsonError`. CONTRACT REQUEST filed.
- **`AbortSignal` / per-call timeout via an extended return type.** The `LLM` port takes one
  argument, so `createLLM` returns `LLMClient` (assignable to `LLM`) with an optional second
  argument. CONTRACT REQUEST filed.
- **`json_schema` is used for every OpenAI-compatible host except DeepSeek**, rather than a config
  flag. `ProviderConfig` is locked and has no capability field; a host check is the smallest correct
  thing today.
- **Usage is summed across repair turns** rather than reporting only the last call, because the cost
  meter should reflect what was actually spent.

## Known limitations / deferred

- `complete()` is non-streaming; streaming to the UI is out of scope (Epic 30+).
- The opencode adapter cannot disable tools explicitly (`generate` takes only a prompt). Pass
  `agent: 'plan'` (or another read-only agent) when constructing the client, or rely on the
  throwaway session being deleted. A `permissions` ruleset on session create is the future fix.
- `supportsJsonSchema` is name-based; a self-hosted DeepSeek-compatible server will get
  `json_schema` and must ignore it or fail. Add a `capabilities` field to `ProviderConfig` at the
  next contract revision.
- No embeddings, no model benchmarking (Epic 28), no prompt content (Epics 12/16).
- The unpacked `openai` SDK and `@opencode-ai/sdk` add startup weight; both are dynamic-import
  candidates later if CLI cold start matters.
- `*.live.test.ts` exists but is never run in this wave; it makes one tiny real call per provider
  under `STARLING_LIVE=1`.
