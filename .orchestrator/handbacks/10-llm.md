## Epic 10 Handback — LLM router (DeepSeek, Ollama, opencode)

**Status:** Complete. Branch `epic/10-llm` @ `a2ee0bd`.

**Delivered:**
- `packages/llm` now exports `createLLM(config, opts?)` and `createLLMFromEnv(opts?)`, both returning
  an `LLMClient` (assignable to core's `LLM`), plus `resolveModel`, `splitOpencodeModel`,
  `costOf`, `isLocalBaseUrl`, `applyProfile`, `parseProfile`, `extractJson`, `toJsonSchemaSafe`,
  `createOpencodeCompletionClient`, `isBadJsonError` and the retry helpers.
- Role routing: `modelFor` → `config.providers`; provider name `opencode` selects the V2 REST
  adapter, every other name selects the OpenAI-compatible path. Loopback OpenAI-compatible
  providers are `local: true` with `costUsd: 0`; opencode is non-local because it proxies upstream.
- OpenAI-compatible path via `openai@7.45.0` with injectable `fetch`, `maxRetries: 0`, and
  DeepSeek-style cache token mapping (`prompt_tokens_details.cached_tokens` **and**
  `prompt_cache_hit_tokens`).
- `completeJson`: `json_schema` for non-DeepSeek hosts, `json_object` + prompt-side schema for
  DeepSeek, lenient extraction (fences/prose/outermost value), zod validation, up to 2 repair turns
  that send the exact validation issue back, summed usage/cost across turns, and
  `StarlingError('LLM_ERROR')` + `details.reason='LLM_BAD_JSON'` + `details.raw` on exhaustion.
- Retries: 3 attempts on 408/409/429/5xx, `TypeError`/`APIConnectionError`/socket codes;
  exponential backoff with jitter; `Retry-After` (seconds or HTTP date) honoured; 120 s per-attempt
  timeout; `AbortSignal` and per-call timeout via `complete(req, {signal, timeoutMs})`.
- opencode adapter: create session → `POST /api/session/{id}/generate` → read session token totals →
  delete session (best-effort cleanup with an `onCleanupError` hook). HTTP Basic auth with the
  password opencode prints at boot.
- Profiles: `STARLING_LLM_PROFILE=opencode|deepseek|local` (`local` sends every role to Ollama;
  `opencode` sends every role to `opencode-go/deepseek-v4.1-flash`).
- `log`/`debug` event per call and `log`/`warn` per retry on the injected `EventBus`.
- Tests: 59 passing, 3 live-only skipped, across 8 files. Fakes are in-process
  `Bun.serve({port: 0})` servers and an injected fake opencode client; no outbound network.
- `docs/epic-10-llm.md` records the exact opencode 2.1.2 endpoints and the DeepSeek finding.

**Key design decisions:**
- **Opencode is reached over the live V2 REST API, not the pinned SDK.** Installed CLI is 2.1.2;
  `GET /openapi.json` shows `/api/session`, `/api/session/{id}/generate`, `/api/session/{id}` and
  `DELETE /api/session/{id}`. The legacy V1 routes (`/session`, `/app`) return the SPA HTML, and
  `@opencode-ai/sdk@1.19.4`'s V2 client predates `/generate` and session delete. Speaking the
  documented REST shapes is the only path that matches this server; the dependency stays pinned for
  the runner handshake but is unused at runtime.
- **`generate` rather than `prompt`.** `prompt` is a durable async queue (`Session.Inbox.User`)
  requiring `…/wait` plus message pagination; `generate` is the synchronous, text-only endpoint a
  completion needs.
- **Local means loopback OpenAI-compatible only.** A local opencode server proxies to a paid model,
  so treating it as free would make the cost meter lie.
- **Provider name selects the family.** `ProviderConfig` is locked and has no `kind` field; a name
  check adds the second family without a contract change.
- **DeepSeek falls back to `json_object`.** Its JSON-mode guide (checked 2026-10-27) documents only
  `json_object`; prompt-side schema text plus repair covers the gap.
- **Usage is summed across repair turns.** The meter should show what was actually spent, not just
  the last successful call.
- **`AbortSignal` via an extended return type.** `LLMClient extends LLM` keeps engine code on the
  locked port while the CLI/tests get cancellation.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 133 installs across 192 packages` — clean, `bun.lock` updated
  only for `packages/llm`'s two added deps.
- `bun test packages/llm`: `59 pass, 3 skip, 0 fail, 189 expect() calls; Ran 62 tests across 8 files`.
- `bun run test` (root): `244 pass, 3 skip, 0 fail, 973 expect() calls; Ran 247 tests across 44 files`.
- `bun run typecheck`: passes for every workspace.
- `bun run check`: **pre-existing failures, none from this lane.** Biome reports format/organizeImports
  errors in `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/*.ts` and
  two `tools/local-models/results/*.json` files. `git status` shows none of them touched; the
  typecheck half of the script passes. `bunx biome check packages/llm docs/epic-10-llm.md` is clean.
- live investigation (no prompts sent): `opencode --version` → `2.1.2`;
  `opencode serve --port 18473` printed `server password …`; `/doc` → `text/html`;
  `/openapi.json` with Basic auth `opencode:<password>` → 281 KB OpenAPI 3.1;
  `GET /api/info` → `{"version":"2.1.2", …}`; legacy `/session` → `200 text/html` (SPA), confirming
  the V1 SDK cannot be used.
- DeepSeek docs: `https://api-docs.deepseek.com/guides/json_mode` documents
  `response_format: {'type': 'json_object'}` only; no `json_schema`.

**Dependencies added:** `@opencode-ai/sdk@1.19.4` and `zod@4.6.7` in `packages/llm`. `openai@7.45.0`
was already present.

**CONTRACT REQUESTS:**
1. **Add `'LLM_BAD_JSON'` to `StarlingErrorCode`.** The epic asks for that code, but core's union
   (locked) has no member. Today the router throws `LLM_ERROR` with
   `details.reason='LLM_BAD_JSON'` and exports `isBadJsonError`; consumers are correct but must use
   the helper instead of `isStarlingError(err, 'LLM_BAD_JSON')`.
2. **Give `LLM` a place for cancellation.** Proposed: add
   `complete(req: LLMRequest, opts?: { signal?: AbortSignal; timeoutMs?: number })` (and the same
   optional arg on `completeJson`). Today `createLLM` returns `LLMClient extends LLM` with the extra
   arg, which is assignable but invisible through the port.
3. **Optional, for a later revision:** add `kind?: 'openai-compatible' | 'opencode'` and/or
   `supportsJsonSchema?: boolean` to `ProviderConfig`. Today the family is inferred from the provider
   name and `json_schema` support from the host (`*.deepseek.com`). A self-hosted
   DeepSeek-compatible server would get the wrong answer.

**Deliberately deferred / out of scope:**
- Streaming; embeddings; prompt content (Epics 12/16); model benchmarking (Epic 28).
- Distinguishing user abort from SDK-level aborts beyond the `details.reason` label.
- A capability field on providers (contract request 3).
- Disabling tools in the opencode throwaway session beyond passing `agent` (the V2 `generate` body
  has no `tools` field; session `permissions` is the future fix).
- No `--fully-open` CLI flag wiring; the CLI owns that and can call
  `createLLM(applyProfile(config, 'local'))`.

**Open questions / flagged tradeoffs:**
- The pinned `@opencode-ai/sdk@1.19.4` does not match the installed 2.1.2 server. If the runner epic
  needs SDK calls (sessions, SSE), it will hit the same V1/V2 split; a coordinated SDK bump in
  `packages/runner` + `packages/llm` is worth scheduling.
- The opencode `generate` endpoint takes only a prompt, so the adapter prepends the system prompt. If
  a future server adds a `system` field, switch to it.
- `PRICING`'s DeepSeek uncached-input figure remains the Epic 00 placeholder ($0.28/M); only the
  table needs updating before the demo.
- `supportsJsonSchema` is host-based. OpenRouter-hosted DeepSeek would get `json_schema`, which most
  OpenRouter routes accept; if one does not, the repair loop still saves the call.
