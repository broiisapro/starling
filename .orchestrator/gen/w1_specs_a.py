SPECS = []

SPECS.append(dict(nn="10", slug="llm", title="LLM router (DeepSeek, Ollama, opencode)", scope="llm",
lane="`packages/llm/**`",
goal="""Implement the `LLM` port so the rest of Starling can ask "planner, give me JSON matching this zod schema" without caring which open-weight model or provider answers. It routes by **role** (planner, auditor, …) to a provider and model from config, validates and repairs structured output, retries transient failures, and reports token usage and cost so the dashboard's cost meter is honest.""",
deliverables="""- `createLLM(config: StarlingConfig, opts?: { fetch?: typeof fetch; clock?: Clock; bus?: EventBus; opencode?: OpencodeCompletionClient }): LLM`. It resolves role → `ModelRef` with core's `modelFor`, then provider → settings from `config.providers`.
- **Provider kind `openai-compatible`** (DeepSeek API, Ollama `http://127.0.0.1:11434/v1`, OpenRouter, …) via the `openai` SDK (L7), with an injectable `fetch`. The API key comes from the env var named in `apiKeyEnv` (none needed for Ollama). A provider is **local** when its baseUrl host is loopback; that sets `LLMResponse.local` and makes the cost $0.
- **Provider kind `opencode`** (L25): a completion is a throwaway session on the user's opencode server. Create a session, send one user message with `providerID/modelID` split from the ModelRef (e.g. `opencode-go` + `deepseek-v4.1-flash`), collect the assistant text and token usage, delete the session. Put this behind a small interface `OpencodeCompletionClient { complete(req: { system: string; prompt: string; providerID: string; modelID: string; signal?: AbortSignal }): Promise<{ text: string; usage: TokenUsage }> }`, with a default implementation over `@opencode-ai/sdk` (add the dep to your package.json). **Investigate** the opencode version installed on this machine (`opencode --version`, `opencode serve --help`). It's a newer CLI with a background service, where `serve` is the "v2 API". Read the OpenAPI it serves at `/doc`: start `opencode serve --port <free port>` briefly, fetch `/doc`, stop it, and **don't send any prompt**. Write the adapter against the real endpoint shapes and record what you found in your doc. Unit tests use a fake client.
- `completeJson(req, schema)`: ask for JSON. Use `response_format: { type: 'json_schema', json_schema: { name, schema: z.toJSONSchema(schema), strict: true } }` where the provider supports it (DeepSeek: verify from its docs and fall back to `json_object` if unsupported; Ollama supports json_schema). For `opencode`, append a strict "reply with only JSON matching this schema" instruction. Then extract JSON (strip code fences, find the outermost object) and validate with zod. On failure, **repair up to 2×**: send the validation error back as a follow-up turn. If it still fails, throw `StarlingError` code `LLM_BAD_JSON` carrying the last raw text.
- Retries with exponential backoff and jitter on 429/5xx/network errors (max 3 attempts, honour `Retry-After`), a per-call timeout (default 120 s), and `AbortSignal` support.
- Usage/cost: fill `LLMResponse.usage` (including cached tokens where the provider reports them) and `costUsd` via core `usageCostUsd` and `PRICING`. Publish a `log` debug event per call when a bus is given (role, model, ms, tokens, local).
- `createLLMFromEnv()` convenience: `loadConfig()`, plus a profile override via `STARLING_LLM_PROFILE=opencode|deepseek|local`. Profiles live in `src/profiles.ts`: `opencode` routes every role through the `opencode` provider with `opencode-go/deepseek-v4.1-flash`; `deepseek` is the default config; `local` sends every role to Ollama.
- Tests: an in-process fake OpenAI-compatible server on `Bun.serve({ port: 0 })` covering success, json_schema request shape, fenced JSON, repair loop success, repair exhaustion, 429 then success (fake clock or tiny delays), timeout, local-vs-API cost, `opencode` provider via the fake client, role routing. Also `src/llm.live.test.ts` (one tiny real call per provider, gated by `STARLING_LIVE=1`; **don't run it**).""",
oos="Planner/auditor prompts (Epics 12, 16). Model benchmarking (Epic 28). Streaming to the UI. Embeddings. Any change to core's `LLM` port (if you need one, file a CONTRACT REQUEST).",
dod=["`bun test packages/llm` passes with ≥ 25 tests, none of them touching the network beyond `127.0.0.1` fakes.",
     "Your doc records the **exact opencode server endpoints** you found at `/doc` (paths, request and response shapes for create session / send message / delete session), and whether DeepSeek's API supports `json_schema`."]))

SPECS.append(dict(nn="11", slug="repomap", title="Repo mapper", scope="repomap",
lane="`packages/repomap/**`",
goal="""Implement `RepoMapper`: turn any git repo into a compact `RepoMap` (file list, languages, exported symbols, a token-budgeted tree, detected test and lint commands). The planner uses it to pick lanes and the prompt compiler uses it to orient workers. It must be fast (under 2 s for a 2k-file repo) and cheap.""",
deliverables="""- `createRepoMapper(opts?: { exec?: typeof exec; llm?: LLM; cacheDir?: string; clock?: Clock }): RepoMapper`.
- File listing via `git ls-files -co --exclude-standard` (tracked plus untracked-but-not-ignored). Skip binaries (NUL-byte sniff on the first 8 KB), files > 256 KB, lockfiles, and `node_modules`/`dist`/`.starling`.
- Language detection by extension (TS/TSX/JS/JSX/MJS, Python, Go, Rust, Swift, Kotlin, Java, C/C++, C#, Ruby, PHP, CSS/SCSS, HTML, Markdown, JSON, YAML, TOML, shell, SQL…) into `languages: Record<lang, fileCount>`.
- **Symbols** via fast regexes (no parser deps) for at least TS/JS (exported functions, classes, consts, types, interfaces, default exports), Python (top-level def/class), Go (func/type), Rust (pub fn/struct/enum/trait), CSS (top-level class selectors, max 20), Markdown (h1/h2). Cap at 40 symbols per file.
- `tree`: an indented directory tree with file counts, collapsing big directories ("src/components/ (42 files)"), with the budget enforced through `renderTree(files, { maxChars })`.
- **Command detection**: `testCommand` and `lintCommand` from package.json scripts (`test`, `lint`, `check`, `typecheck`). Pick the runner from the lockfile (bun.lock → `bun run test`, pnpm-lock → `pnpm test`, yarn.lock → `yarn test`, package-lock → `npm test`). Also pytest (pyproject/pytest.ini/tests dir), `cargo test`, `go test ./...`, and a Makefile `test` target. Document the precedence order.
- `tokenEstimate` ≈ total chars / 4 over the rendered map, plus `createdAt`.
- Optional **summaries** (`opts.summarize`): for up to N most "central" files (most imported or most symbols, your heuristic), ask `llm.complete` with role `summarizer` for a one-line summary. Concurrency 4. Cache by content SHA-1 in `cacheDir` (JSON file) so reruns are instant. Missing LLM means no summaries and no error.
- Export `renderRepoMap(map, { maxTokens, focus?: string[] /* globs to expand */ }): string`, a prompt-ready text rendering. The planner and prompt compiler will adopt it at C1.
- Tests: temp git repos built in the test (`git init`, write files, commit) for each language family. Also run against a copy of `examples/sky-todo` and assert the shape matches `fixtures/repomaps/sky-todo.json` (same languages, `testCommand` detected, symbols found in `src/lib/dates.ts`). Plus a perf test: a generated 2,000-file repo maps in < 2 s.""",
oos="Tree-sitter or any parser dependency. Import-graph analysis beyond a cheap heuristic. Embeddings or semantic search. Planner logic.",
dod=["`bun test packages/repomap` passes, ≥ 20 tests including the perf test and the sky-todo shape test."]))

SPECS.append(dict(nn="12", slug="planner", title="Planner: goal to lane-safe task DAG", scope="planner",
lane="`packages/planner/**`",
goal="""Implement `Planner`: the brain that turns one goal sentence plus a `RepoMap` into a `Plan` whose tasks can run **in parallel without ever touching the same files**. This is Starling's core trick, and the validator is what makes it trustworthy. The LLM proposes; deterministic code verifies and repairs.""",
deliverables="""- `createPlanner(opts: { llm: LLM; clock?: Clock; maxRepairs?: number /* default 2 */; minTasks?: number; maxTasks?: number /* 2..12 */ }): Planner`.
- **Prompt** (`src/prompt.ts`, a pure function, snapshot-tested). The system prompt encodes the rules: each task is 5–25 minutes of agent work; each task has a **lane** of `owns` globs it may write and `reads` it may read; tasks that may run concurrently must have **disjoint `owns`**; prefer new files in feature folders over editing shared files; when two tasks must touch the same file, make one depend on the other; `definitionOfDone` items are literal, checkable steps that always include "tests pass" plus specific new tests; `outOfScope` is explicit; `lockedDecisions` capture repo-wide facts (framework, test runner, style). The user message holds the goal, constraints, and the repo map rendered by your own small renderer (`src/render-map.ts`; repomap's renderer gets adopted at C1).
- LLM call via `llm.completeJson(req, PlanDraftSchema)` (role `planner`), where `PlanDraftSchema` is the LLM-facing shape (summary, lockedDecisions, tasks). Then build the `Plan` (ids via `newId`, the model ref from the response, `createdAt` from the clock).
- **`validate(plan): PlanIssue[]`**, deterministic:
  - `cycle` (report the cycle path) and `missing-dep`.
  - Duplicate task keys (`other`).
  - `empty-dod` and `empty-lane`.
  - **`lane-overlap`**: for every pair of tasks that can run concurrently (neither is an ancestor of the other in the DAG), `globsOverlap(a.lane.owns, b.lane.owns)` non-empty → error naming both keys and the overlapping globs.
  - warn: an `owns` glob matching no file in the map *and* not a plausible new-file location; task count outside the bounds; estimate > 40 min.
- **Repair loop**: if `validate` returns errors, send them back to the LLM (≤ `maxRepairs`) asking for a corrected full plan. If errors remain, apply **deterministic fixes**: break cycles by dropping the newest edge, drop missing deps, and serialise lane-overlapping pairs by adding a dependency edge (later task depends on earlier, ordered by key). After that, a plan returned by `plan()` **never contains error-level issues**; it returns the remaining warnings.
- Tests (MockLLM scripted): a clean sky-todo launch-day plan (use `fixtures/plans/sky-todo-launch-day.json` as the LLM's reply); an overlapping plan fixed by the LLM on repair; an overlapping plan fixed deterministically after repairs run out; a cycle; missing dep; invalid JSON handled by the LLM layer (just assert the error propagates); ancestor pairs allowed to overlap; property-style tests on the validator with generated DAGs (seeded RNG).
- Run a quick sanity check of your prompt text against `examples/sky-todo/demo-goals/launch-day.expected.md`: your doc should show how the prompt steers toward that decomposition.""",
oos="Real LLM calls (L23). Evals harness (Epic 29). Repo mapping (Epic 11). Choosing models.",
dod=["`bun test packages/planner` passes, ≥ 25 tests, including the deterministic-repair guarantee: a fuzz test with 200 random plans, every returned plan having 0 error-level issues."]))

SPECS.append(dict(nn="13", slug="prompts", title="Prompt compiler", scope="prompts",
lane="`packages/prompts/**`",
goal="""Implement `PromptCompiler`: the pure functions that write what each worker agent reads. Starling's own build process (the prompt you are reading right now) proved this format works. Your job is to productise it for Starling's sub-agents: self-contained, lane-strict, finish-line explicit, and short enough for a fast model.""",
deliverables="""- `createPromptCompiler(opts?: { maxRepoMapChars?: number; style?: 'full' | 'compact' }): PromptCompiler` with `worker(ctx)`, `fixer(ctx, verdict)` and `resolver(ctx, conflict)`. All pure and deterministic (no clock, no randomness).
- **Worker prompt** sections, in order:
  - Role: "you are one of N agents working in parallel".
  - Project context: goal text, plan summary, `lockedDecisions`.
  - **Your task**: title, goal, deliverables, out of scope, definition of done.
  - **Your lane**: the `owns` globs ("you may create or modify only files matching these") and `reads`, plus how violations are detected (the auditor diffs your branch and fails you).
  - **What the others are doing**: one line per sibling task with its lane, so the agent doesn't duplicate work or wander into their files.
  - Repo orientation: the repo map rendered with focus on the lane, truncated to budget, using your own small renderer for now.
  - How to verify: the `testCommand` and the task's DoD.
  - Git rules: commit on your branch with Conventional Commits; don't push, merge or switch branches (Starling handles that).
  - **Finish line**: end your final message with the handback block from ARCHITECTURE §8.
- **Fixer prompt**: which checks failed (from `AuditVerdict.checks`), the lane violations, the `fixInstructions` verbatim, "fix only these; don't redo completed work; the same lane rules apply", and the same handback requirement.
- **Resolver prompt**: the conflicted files, both tasks' intents (from the plan), the rules (preserve both behaviours; don't drop either side's tests; run the tests), and the handback.
- `parseHandback(text: string): WorkerHandback | undefined`: finds the **last** `<<<STARLING_HANDBACK … STARLING_HANDBACK>>>` block, tolerates code fences and trailing prose, validates with zod (mirror of §8 in `src/handshake.ts`).
- `estimateTokens(prompt)` and a budget guard: if a worker prompt exceeds `maxChars` (default 24k), shrink the repo map first, then the sibling list, never the task spec.
- Tests: **snapshot tests** (`toMatchSnapshot`) of worker, fixer and resolver prompts for the sky-todo fixture plan; invariants (every DoD item appears, every owns glob appears, siblings listed, handback instructions present); budget shrink behaviour; `parseHandback` cases (fenced, multiple blocks, malformed JSON → undefined, extra fields ignored).""",
oos="Calling any LLM. Deciding the task breakdown (planner). Rendering repo maps beyond a minimal renderer (repomap's is adopted at C1).",
dod=["`bun test packages/prompts` passes, ≥ 20 tests. Snapshots committed.",
     "Paste the full rendered **worker prompt** for task `t03-csv-export` (or the fixture's equivalent key) into your doc as an appendix, so the Orchestrator can review its tone and clarity."]))

SPECS.append(dict(nn="14", slug="workspace", title="Workspace: worktrees, conflict prediction, bundles", scope="workspace",
lane="`packages/workspace/**`",
goal="""Implement the `Workspace` port on the real `git` CLI. Up to ~20 agents work at once, each in its own worktree, so this has to be **correct under concurrency**. It also provides the git-bundle helpers Flock mode uses to ship repos between laptops.""",
deliverables="""- `createWorkspace(opts: { worktreeRoot: string; exec?: typeof exec; clock?: Clock }): Workspace & BundleOps`, implementing every port method via core `exec` (argv arrays only, no shell strings):
  - `ensureIntegrationBranch(repo, base, name)`: idempotent.
  - `create(repo, branch, fromRef)`: `git worktree add -b`; reuse a matching existing worktree; path `<worktreeRoot>/<sanitised branch>`.
  - `diff(worktreePath, baseRef)`: `git diff --numstat` plus the patch of `base...HEAD` **and** uncommitted changes. Patch truncated at 200 KB with `truncated: true`.
  - `changedFiles(worktreePath, baseRef)`: committed, staged, unstaged and untracked (excluding ignored), deduped.
  - `predictConflicts(repo, ours, theirs)`: `git merge-tree --write-tree --name-only --no-messages`, parsing the conflicted paths (requires git ≥ 2.38; check the version once and throw `StarlingError('GIT_TOO_OLD')` otherwise).
  - `commitAll(worktreePath, message)`: returns the sha or undefined if clean. Uses a local identity fallback (`Starling Bot <starling@localhost>`) when none is configured, without touching global config.
  - `remove(worktreePath)`: `worktree remove --force` plus prune. Idempotent.
- **Concurrency safety**: a per-repo async mutex around operations that touch the shared `.git` (worktree add/remove/prune, branch create/delete, fetch, bundle import). Operations inside a single worktree run without the lock. Retry once on `index.lock` contention after a short backoff.
- `BundleOps` (extra exports, not in the port; Flock uses them): `createBundle(repo, ref, opts?: { base?: string; outPath?: string }): Promise<string>` (`git bundle create`; with `base`, only `base..ref`), `cloneFromBundle(bundlePath, dir, ref)`, `fetchBundle(repo, bundlePath, ref, intoBranch)` (`git fetch <bundle> ref:intoBranch`, forced update allowed).
- Tests against **real temporary git repos** (local only): create/reuse/remove, diff with committed and uncommitted changes, untracked detection, conflict prediction (clean vs conflicting), commitAll identity fallback, **20 concurrent `create` calls on one repo** all succeeding, and a bundle round trip: create bundle → clone elsewhere → commit there → bundle back with base → fetch into the original as a branch → diff matches.""",
oos="Merge-queue logic (Epic 17). Pushing to remotes or GitHub. Runner/opencode. Any shell-string exec.",
dod=["`bun test packages/workspace` passes, ≥ 20 tests, including the 20-way concurrency test and the bundle round trip. Total runtime < 30 s."]))
