# Epic 10: LLM router (DeepSeek, Ollama, opencode)

**Wave 1 · Branch `epic/10-llm` · Issue: find it with `gh issue list --search "Epic 10 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/llm/**`
plus `docs/epic-10-llm.md` and `.orchestrator/handbacks/10-llm.md`. Read anything; write nothing else.

## Goal
Implement the `LLM` port so the rest of Starling can ask "planner, give me JSON matching this zod schema" without caring which open-weight model or provider answers. It routes by **role** (planner, auditor, …) to a provider and model from config, validates and repairs structured output, retries transient failures, and reports token usage and cost so the dashboard's cost meter is honest.

## Deliverables
- `createLLM(config: StarlingConfig, opts?: { fetch?: typeof fetch; clock?: Clock; bus?: EventBus; opencode?: OpencodeCompletionClient }): LLM`. It resolves role → `ModelRef` with core's `modelFor`, then provider → settings from `config.providers`.
- **Provider kind `openai-compatible`** (DeepSeek API, Ollama `http://127.0.0.1:11434/v1`, OpenRouter, …) via the `openai` SDK (L7), with an injectable `fetch`. The API key comes from the env var named in `apiKeyEnv` (none needed for Ollama). A provider is **local** when its baseUrl host is loopback; that sets `LLMResponse.local` and makes the cost $0.
- **Provider kind `opencode`** (L25): a completion is a throwaway session on the user's opencode server. Create a session, send one user message with `providerID/modelID` split from the ModelRef (e.g. `opencode-go` + `deepseek-v4.1-flash`), collect the assistant text and token usage, delete the session. Put this behind a small interface `OpencodeCompletionClient { complete(req: { system: string; prompt: string; providerID: string; modelID: string; signal?: AbortSignal }): Promise<{ text: string; usage: TokenUsage }> }`, with a default implementation over `@opencode-ai/sdk` (add the dep to your package.json). **Investigate** the opencode version installed on this machine (`opencode --version`, `opencode serve --help`). It's a newer CLI with a background service, where `serve` is the "v2 API". Read the OpenAPI it serves at `/doc`: start `opencode serve --port <free port>` briefly, fetch `/doc`, stop it, and **don't send any prompt**. Write the adapter against the real endpoint shapes and record what you found in your doc. Unit tests use a fake client.
- `completeJson(req, schema)`: ask for JSON. Use `response_format: { type: 'json_schema', json_schema: { name, schema: z.toJSONSchema(schema), strict: true } }` where the provider supports it (DeepSeek: verify from its docs and fall back to `json_object` if unsupported; Ollama supports json_schema). For `opencode`, append a strict "reply with only JSON matching this schema" instruction. Then extract JSON (strip code fences, find the outermost object) and validate with zod. On failure, **repair up to 2×**: send the validation error back as a follow-up turn. If it still fails, throw `StarlingError` code `LLM_BAD_JSON` carrying the last raw text.
- Retries with exponential backoff and jitter on 429/5xx/network errors (max 3 attempts, honour `Retry-After`), a per-call timeout (default 120 s), and `AbortSignal` support.
- Usage/cost: fill `LLMResponse.usage` (including cached tokens where the provider reports them) and `costUsd` via core `usageCostUsd` and `PRICING`. Publish a `log` debug event per call when a bus is given (role, model, ms, tokens, local).
- `createLLMFromEnv()` convenience: `loadConfig()`, plus a profile override via `STARLING_LLM_PROFILE=opencode|deepseek|local`. Profiles live in `src/profiles.ts`: `opencode` routes every role through the `opencode` provider with `opencode-go/deepseek-v4.1-flash`; `deepseek` is the default config; `local` sends every role to Ollama.
- Tests: an in-process fake OpenAI-compatible server on `Bun.serve({ port: 0 })` covering success, json_schema request shape, fenced JSON, repair loop success, repair exhaustion, 429 then success (fake clock or tiny delays), timeout, local-vs-API cost, `opencode` provider via the fake client, role routing. Also `src/llm.live.test.ts` (one tiny real call per provider, gated by `STARLING_LIVE=1`; **don't run it**).

## Explicitly out of scope
Planner/auditor prompts (Epics 12, 16). Model benchmarking (Epic 28). Streaming to the UI. Embeddings. Any change to core's `LLM` port (if you need one, file a CONTRACT REQUEST).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/llm` passes with ≥ 25 tests, none of them touching the network beyond `127.0.0.1` fakes.
3. Your doc records the **exact opencode server endpoints** you found at `/doc` (paths, request and response shapes for create session / send message / delete session), and whether DeepSeek's API supports `json_schema`.
4. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
5. `bun run check` passes (Biome + typecheck for every workspace).
6. `docs/epic-10-llm.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/10-llm.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/10-llm`. Conventional Commits scoped to your lane (`feat(llm): …`, `test(llm): …`, `docs(epic-10): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
