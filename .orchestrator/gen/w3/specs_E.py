"""Wave 3b specs, group E (epics 200-207). These launch AFTER Epic 40 (real composition) merges."""


def owner_3b(lane_name, others):
    return f"""- **Wave 3b ownership.** You are the **single owner of {lane_name}** in Wave 3b. The header's line saying `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are off limits was written for Wave 3a and **does not apply to your lane**. The other areas in that list stay off limits to you: {others} own them and run **in parallel** with you, so never wait for them and never edit their lanes.
- **Where main is now.** Your `main` includes Epic 40 (the real `starling run`: `apps/cli/src/real/compose-real.ts`, real recordings in `fixtures/real/*.jsonl`, its core additions) and the Wave 3a epics merged so far. Start with `git log --oneline origin/main | head -40`, `docs/epic-40-integration-captain.md` and `.orchestrator/handbacks/40-integration-captain.md`. The Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md` (careful: `1*.md` also matches the Wave 1 handbacks 10–19). Read the ones that mention your area: their **FIX REQUESTS**, **CONTRACT REQUESTS** and **C3 wiring** sections are carryover for you too, exactly like `fix-requests-w2.md`."""


OWNERS = {
    "llm": "Epics 201 (`packages/runner`), 202 (`packages/core`), 203 (`apps/cli`) and 204 (`apps/web/src/data`)",
    "runner": "Epics 200 (`packages/llm`), 202 (`packages/core`), 203 (`apps/cli`) and 204 (`apps/web/src/data`)",
    "core": "Epics 200 (`packages/llm`), 201 (`packages/runner`), 203 (`apps/cli`) and 204 (`apps/web/src/data`)",
    "cli": "Epics 200 (`packages/llm`), 201 (`packages/runner`), 202 (`packages/core`) and 204 (`apps/web/src/data`)",
    "web": "Epics 200 (`packages/llm`), 201 (`packages/runner`), 202 (`packages/core`) and 203 (`apps/cli`)",
}

READ_ONLY_3B = """- **Wave 3b context.** Your `main` includes Epic 40 (the real `starling run`, `fixtures/real/*.jsonl`) and the Wave 3a epics merged so far (`git log --oneline origin/main | head -40`; Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md`). `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` now belong to Epics 200–204, which run **in parallel** with you: import from them, never edit them, and never wait for them."""

SPECS = []

# ── 200 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="200", slug="llm-r2", title="LLM round 2: honest usage, one retry policy, model capabilities", wave="3b", convention=None,
lane="`packages/llm/**`",
budget="90–150 min",
goal="""Since Epic 40, planner, auditor and writer completions go through opencode's stateless generate route, which reports **no token usage**, so every planning and review turn shows `$0.000` on the cost meter. On stage that reads as either "free" or "broken", and neither is true. Make `@starling/llm` honest: every response says whether its usage was **reported**, **estimated** or **unknown**. Retries follow the same Retry-After rules as the runner. A capability table replaces the name-based JSON-schema guess. The profile helpers Epic 51 built become public. Great looks like this: a real run's cost includes its planning and audit turns, clearly labelled "estimated" where opencode reports nothing, and `starling doctor` can describe the active profile using only public exports.""",
deliverables="""1. **Read before you write.** Read `packages/llm/src/providers/opencode.ts` and `packages/runner/src/opencode/client.ts` as they are on main. Epic 40's Fix 2 moved the `POST /api/experimental/generate` stateless path onto the shared `OpencodeClient`, and it may already mark usage somehow. Record what you found in your doc, and build on it rather than rewriting it.
2. **`packages/llm/src/usage.ts`**:
   - `export type UsageSource = 'reported' | 'estimated' | 'unknown'`;
   - `estimateTokens(text: string): number`, deterministic (`Math.ceil(chars / 4)`, documented as a heuristic);
   - `estimateUsage(prompt: string, output: string): TokenUsage` with `cached: 0`.
3. **opencode provider.** The session path gives `'reported'` (session totals). The stateless route with no usage gives an estimate from prompt + output, marked `'estimated'`. A new option `OpencodeClientOptions.estimateUsage?: boolean` (default `true`) turns that off: with `false` you get zeros marked `'unknown'`. `OpencodeCompletionResult` gains `usageSource?: UsageSource` (additive).
4. **Router.** Every `LLMResponse` carries `usageSource`. Use a local type `LLMResponseWithSource = LLMResponse & { usageSource?: UsageSource }` (exported). Epic 202 is adding exactly `usageSource?: UsageSource` to core's `LLMResponse` in parallel, and the intersection compiles both before and after that lands. Sources by provider:
   - openai-compatible with `usage` → `'reported'`; without it → `'estimated'`;
   - `costUsd` is computed from estimated usage as well, so the meter stops showing `$0`;
   - local providers stay at exactly `$0`;
   - `completeJson` sums usage across repair attempts, so it keeps the weakest source (`unknown` < `estimated` < `reported`).
5. **Pricing honesty** (`cost.ts`, keep `costOf`'s signature):
   - add `priceFor(model: ModelRef): { key: string; pricing: ModelPricing } | undefined` and `isPriced(model): boolean`;
   - an **unpriced API model** publishes one bus `log` warn per model per LLM instance (message starting `[llm.unpriced]`) instead of silently costing `$0`;
   - add an llm-local `EXTRA_PRICING` table for aliases that `pricingKeys` can't resolve, with a source comment per row. Never edit core's `PRICING`: that's Epic 202's lane. Test that `opencode-go/deepseek-v4.1-flash` already prices through `pricingKeys`.
6. **Capabilities** (`packages/llm/src/capabilities.ts`):
   - `interface ModelCapabilities { jsonSchema: boolean; jsonObject: boolean; tools: boolean; contextTokens: number; reportsUsage: 'always' | 'session-only' | 'never'; local: boolean }`;
   - `MODEL_CAPABILITIES: Record<string, Partial<ModelCapabilities>>`, keyed like `PRICING` (`deepseek-v4.1-flash`, `opencode-go/deepseek-v4.1-flash`, `qwen3.8:27b-mlx`, `qwen3.6:35b-a3b`);
   - `capabilitiesOf(providerName: string, provider: ProviderConfig, model: ModelRef): ModelCapabilities`, with conservative defaults. It honours an optional `provider.capabilities` object when present: Epic 202 is adding `ProviderConfig.capabilities?`, so read it through a local intersection type;
   - the router picks its structured-output strategy from this;
   - `supportsJsonSchema(baseUrl)` keeps its signature (L33) and stays as the fallback.
7. **Retry consistency with the runner** (`retry.ts`). Today `withRetries` only reads `err.headers`, but `@starling/runner`'s `OpencodeClient` throws `StarlingError`s carrying `details.status`, `details.rateLimited` and `details.retryAfterMs`. That means an opencode 429 ignores its Retry-After. Fix it:
   - read `details.retryAfterMs` first, then headers;
   - treat `details.rateLimited === true` as retryable;
   - keep the one `maxRetryAfterMs` cap and document how it differs from the runner's 120 s cap;
   - add `RetryHooks.sleep?` so tests never really wait;
   - `onRetry` publishes a bus `log` warn starting `[llm.retry]`.
8. **opencode service discovery** (Epic 48's request), in `packages/llm/src/opencode-service.ts`:
   - `discoverOpencodeService(opts?: { home?: string; readFile?: (p: string) => string | undefined }): { url: string; password?: string } | undefined`;
   - it reads `~/.local/state/opencode/service.json`, then `~/.config/opencode/service.json` (the same candidates as `packages/planner/src/default-llm.ts`), and skips a half-written file;
   - `createLLMFromEnv` uses it for the `opencode` profile when `STARLING_OPENCODE_URL` and `OPENCODE_SERVER_PASSWORD` are unset;
   - tests use a temp HOME.
9. **Public exports** (Epic 51's request). Add to `src/index.ts`:
   - `resolveLLMProfile`, `reportProfile`, `opencodeFallbackConfig`, `EnvProfileOptions`;
   - from `profiles`: `describeProfile`, `resolveProfile`, `LOCAL_BASE_URL`, `LOCAL_PROVIDER`, `MIXED_CLOUD_ROLES`, `MIXED_LOCAL_ROLES` and their types;
   - from `profiles-recommend`: `chooseLocalModel`, `hostProfile`, `parseRecommendation`, `readRecommendation`, `RECOMMENDATION_RELATIVE_PATH`;
   - from `profiles-probe`: `nativeOllamaUrl`, `probeOllama`;
   - plus everything new from this epic.

   `index.test.ts` asserts that each one exists.
10. **Tests: at least 35 new.** Cover:
   - usage source per path, using a fake `fetch` behind `createOpencodeCompletionClient`;
   - that `estimateTokens` is deterministic;
   - that the unpriced warning fires once;
   - capability lookup and `supportsJsonSchema` back-compat;
   - retries honouring `details.retryAfterMs`, with an injected sleep;
   - service discovery.

   No real opencode, no real model.""",
oos="""- `packages/runner/**` belongs to Epic 201. If the shared `OpencodeClient` needs a change, file a FIX REQUEST and code against the client as it is today.
- `packages/core/**` belongs to Epic 202. It owns `LLMResponse.usageSource?`, `ProviderConfig.capabilities?` and any new `PRICING` rows.
- `apps/cli/**` belongs to Epic 203: printing `describeProfile` in `starling doctor` and constructing the auditor with `llm: 'auto'` are its job. Your handback gives it the exact calls.
- The planner keeps its own service-discovery copy (`packages/planner`). File a FIX REQUEST to switch it to yours.
- Streaming completions, embeddings, model benchmarking, and any real model call.""",
dod=["`bun test packages/llm` → 0 fail, at least 35 new tests.",
     "`bunx tsc --noEmit -p packages/llm` clean.",
     "`bun -e \"import * as l from './packages/llm/src/index.ts'; const m = l as Record<string, unknown>; console.log(['resolveLLMProfile','describeProfile','opencodeFallbackConfig','capabilitiesOf','estimateUsage','discoverOpencodeService','priceFor'].map((k) => k + ':' + typeof m[k]).join(' '))\"` prints `function` for every name (paste).",
     "Paste the names and key assertion lines of two tests: (a) a fake opencode server answering the stateless route without usage yields `usageSource: 'estimated'` and `costUsd > 0` on the opencode profile; (b) a runner-style 429 `StarlingError` with `details.retryAfterMs: 1500` makes `withRetries` sleep exactly 1500 ms (injected sleep)."],
carryover="""- **Epic 40, CONTRACT REQUEST 2, plus Fix 2:** report usage from the opencode provider. When the stateless route reports none, mark it unknown or estimated, never a silent zero.
- **Epic 51, FIX REQUEST 1:** export the profile surface (`resolveLLMProfile`, `describeProfile`, `opencodeFallbackConfig`, the recommend/probe helpers) from `src/index.ts`. Callers can't deep-import because of the `exports` map.
- **Epic 48:** move `service.json` discovery into `createLLMFromEnv` for the `opencode` profile, so the CLI, server, evals and scripts stop duplicating it.
- **Epic 44 (indirect):** `opencodeFallbackConfig` must be public so the auditor can drop its second fallback table. Note in your handback that the auditor's owner should adopt it.
- **Epic 10 known limitation:** `supportsJsonSchema` is name-based. Replace it with the capability table, keeping the old function as a fallback.""",
extra_locked=owner_3b("`packages/llm`", OWNERS["llm"]) + """
- **Coordinate through types, not timing.** Epic 202 adds `LLMResponse.usageSource?: 'reported' | 'estimated' | 'unknown'` and `ProviderConfig.capabilities?: { jsonSchema?: boolean; jsonObject?: boolean; tools?: boolean; contextTokens?: number }` to core using exactly these names. Read them through local intersection types so you compile with or without 202, and list in your handback the intersection types that can be deleted once 202 lands.""",
))

# ── 201 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="201", slug="runner-r2", title="Runner round 2: opencode 2.x edge cases, session cleanup, server pool, log limits", wave="3b", convention=None,
lane="`packages/runner/**`",
budget="90–150 min",
goal="""The runner is the bridge between Starling and real agents. Epic 40 learned opencode 2.1.2's streaming vocabulary the hard way, with a live run that emitted nothing but `session.started` and `session.idle`. Make the runner boringly reliable for a 30-bird run on demo day:
- every event type in the server's spec is either mapped or deliberately ignored;
- permission prompts never leave a task hanging for four minutes;
- agent sessions get deleted;
- one spawned `opencode serve` can be leased by the runner and the LLM router together;
- transcripts are bounded, and replays can be re-timed for live demos.

Great looks like this: a test table proves coverage of the whole opencode vocabulary, and nothing in the runner can grow without bound.""",
deliverables="""1. **Read first.** Read `src/opencode/normalize.ts` after Epic 40, plus the stateless generate method Fix 2 added to `OpencodeClient` (Epic 200 depends on it: keep it, L33). Put the current mapping table (opencode event type → `AgentEvent` kind) in your doc as the reference.
2. **Vocabulary coverage.** `test/fixtures/openapi.json` is the real server's spec. Extract every `session.*`, `message.*`, `permission.*`, `question.*` and `file.*` event type. Then:
   - map each one in `normalize.ts`, or list it in a new exported `IGNORED_EVENT_TYPES: readonly string[]`;
   - a table-driven test fails if the spec has a type that is in neither;
   - unknown types (from a newer server) produce one `log` debug **per type per runner**, not one per event.

   This includes the tool-failure names Epic 40 guessed (`session.tool.failed|error`): confirm them against the spec.
3. **Permission and question prompts.** An agent waiting for approval currently sits until the engine's stall watchdog fires. Fix it:
   - pass a permissions ruleset when creating the session, if the spec's create body allows it (see the `permissions` objects around line 700 of `openapi.json`);
   - if a `permission.asked` or `question.asked` still arrives, answer it through the spec's permission route according to a new option `OpencodeRunnerOptions.onPermission?: (req: { sessionId: string; tool?: string; detail: string }) => 'allow' | 'reject'`, which defaults to `'reject'`;
   - also emit a `tool.result` with `{ error: 'permission rejected: …' }` so the transcript shows what happened;
   - if no reply route exists, abort the session and emit `session.error { name: 'PermissionAsked' }`, so the engine's fix loop runs instead of a stall.
4. **Session cleanup.**
   - Add `OpencodeRunner.release(sessionId): Promise<void>`. It goes on the runner's interface, **not** on core's port. It deletes the session on the server and forgets its local state, and calling it twice does nothing.
   - `abort()` releases too.
   - `close()` deletes every session this runner created when `OpencodeRunnerOptions.deleteSessions` is true. The default is `true` in spawn mode and `false` in attach mode, so a user's own server keeps its history.
   - Don't delete on `session.idle`: the engine's fix loop `send()`s to the same session.
   - File a FIX REQUEST so the flock `LocalNode.cleanup` calls `release` when it exists.
5. **Server pool** (`src/opencode/server-pool.ts`):
   - `createOpencodeServerPool(opts?: { command?: string; spawn?: typeof Bun.spawn; startupTimeoutMs?: number; hostname?: string }): OpencodeServerPool`, with `acquire(key = 'default'): Promise<OpencodeServerLease>` (`{ url: string; password: string; release(): Promise<void> }`) and `closeAll(): Promise<void>`;
   - reference-counted: one `opencode serve` per key, killed when its last lease is released;
   - it fixes Epic 15's free-port race by retrying up to 3 times on an early exit that mentions the address being in use;
   - `createOpencodeRunner` accepts `server?: OpencodeServerLease`: it attaches to the leased server and releases the lease on `close()`.

   With this, the CLI composition can share one server between the runner and `createOpencodeCompletionClient`. Put the exact wiring for Epic 203 / C3 in your handback.
6. **Log capture limits.** New options:
   - `maxTextChars` per text event (default 4 000);
   - `maxTranscriptChars` per session (default 200 000). Past it, text events stop, with one final `text` event `{ clipped: true, droppedChars }`;
   - `toolSummaryChars` (today the hard-coded `SUMMARY_LIMIT`).

   Expose `stats(sessionId): { events: number; textChars: number; clippedChars: number } | undefined`.
7. **Backoff without holding a slot.** Epic 49 found that `#promptWithBackoff` keeps the session's semaphore slot while it sleeps through a provider backoff. Release the slot before sleeping and re-acquire it afterwards. The test: a rate-limited provider's backoff must not block another provider's prompt (fake limiter + manual scheduler).
8. **Replay runner** (`src/replay.ts`):
   - `retime?: boolean`: emitted events get `ts = clock.now()` instead of the recorded timestamp (Epic 70's F4). The default stays `false`, so `starling replay` keeps its meaning (L33). Document when to turn it on (live demo agents, `tools/flock/replay-agent.ts`);
   - multi-session: when the recording holds several task keys, `start({ taskKey })` replays only that task's events, and an unknown key replays the whole recording, as today.
9. **Attach-mode version check.** When `serverInfo()` reports a major version below 2, `health()` and startup fail with `RUNNER_ERROR` and a message naming the required version.
10. **Tests: at least 40 new**, all against `test/fake-opencode.ts`, fake spawn and a `FakeClock` or manual scheduler. Never a real `opencode`.""",
oos="""- `packages/llm/**` belongs to Epic 200. It consumes `OpencodeClient`, so never rename or remove anything on it.
- `packages/core/**` belongs to Epic 202. New `AgentEventKind`s (reasoning, compaction) are a CONTRACT REQUEST; keep mapping them to existing kinds or ignoring them.
- `apps/cli/src/real/**` belongs to Epic 203: using the pool in the composition is C3/203 wiring.
- `packages/flock` (`LocalNode.cleanup` calling `release`) and `packages/engine` are FIX REQUESTS only.
- Real opencode sessions and real prompts.""",
dod=["`bun test packages/runner` → 0 fail, at least 40 new tests.",
     "`bunx tsc --noEmit -p packages/runner` clean.",
     "Paste the vocabulary-coverage test's output line, showing how many spec event types are mapped and how many are ignored, with 0 uncovered.",
     "Paste the names of the pool tests that prove (a) two `acquire()` calls share one spawned process, (b) the process is killed after the last `release()`, and (c) a simulated `EADDRINUSE` exit is retried."],
carryover="""- **Epic 40, CONTRACT REQUEST 3:** map `session.tool.error` and any other 2.1.x tool-failure names (the coverage test settles this for good).
- **Epic 40, Fix 2:** keep the stateless `generate` path on `OpencodeClient` and its tests (`packages/llm` depends on it).
- **Epic 70, F4:** `ReplayRunner` re-emits recorded timestamps, so a live replay's events are stale. Add `retime`.
- **Epic 49, limitation:** the runner's backoff holds the session's semaphore slot. Release it while waiting.
- **Epic 15, known limitations:** the free-port race (now the pool's retry), unanswered permission/question prompts, no attach-mode version check, and `ReplayRunner` serving only one session.""",
extra_locked=owner_3b("`packages/runner`", OWNERS["runner"]) + """
- **Consumers outside your lane:** `packages/llm` (Epic 200, in parallel), `packages/perch/src/compose-perch.ts`, `tools/load/runner.ts`, `tools/flock/replay-agent.ts` and Epic 40's `apps/cli/src/real/compose-real.ts`. Every change must be additive (new options default to today's behaviour), so all of them still compile and pass untouched.""",
))

# ── 202 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="202", slug="core-r2", title="Core round 2: contract consolidation", wave="3b", convention=None,
lane="`packages/core/**`",
budget="90–150 min",
goal="""Every wave has filed CONTRACT REQUESTS that nobody could make because core was locked. The result is local intersection types, payloads guessed among five shapes, `[code]` prefixes inside log messages, and feature detection everywhere. Be the one place where they all land: **additively**, with tests, and with migration notes that tell each consumer what to adopt. Great looks like this: every request from the Wave 2 and Wave 3a handbacks is either landed (optional or defaulted, tested, documented with who should adopt it) or declined with a reason; no existing test, fixture or consumer breaks; and C3 can delete the workarounds one lane at a time.""",
deliverables="""1. **Inventory first.**
   - `grep -n -i -A15 "CONTRACT REQUEST" .orchestrator/handbacks/*.md`, plus every FIX REQUEST naming `packages/core` in `.orchestrator/fix-requests-w2.md` and in the Wave 3a handbacks (`.orchestrator/handbacks/1[0-9][0-9]-*.md`, and any `.orchestrator/fix-requests-w3*.md`).
   - Your doc gets a table: source epic | request | decision (landed / declined / already on main) | file.
   - Expect Wave 3a requests from 100 (engine: diff, budget, warn verdicts), 103 (auditor: SEC-08), 104 (merger: queue port), 105 (workspace knobs), 107 (planner `maxTasks`), 110 (server auth config), 111 (insights types) and 112 (feature manifest type).
2. **Already on main from Epic 40; verify, don't redo:** `TaskRun.nodeName?`, the `run.status` event `{ from, to, run }`, `SkyViewProps.paused?` and `MergeQueueProps.selectedTask?`.
3. **Known requests to land.** Each one is optional or defaulted:
   - **a.** `log` payload `code?: string` (Epic 49).
   - **b.** Config gets `stallAfterMs: z.number().int().nonnegative().default(240_000)` and `budget.warnRatio: z.number().min(0).max(1).default(0.8)` (Epic 49). The `.default({...})` literals in `config.ts` must include the new keys. Test that an old YAML without them still loads and that `defaultConfig` has the new values.
   - **c.** `StartRunInput.budgetUsd?: number` (Epics 49 and 53).
   - **d.** `EngineApi.preview?(input: StartRunInput): Promise<{ plan: Plan; issues: PlanIssue[] }>` (Epic 53).
   - **e.** `TaskHandle.worktreePath?: string` (Epics 40, 49 and 70). `TaskRun.worktreePath` already exists.
   - **f.** A `task.diff` event, **exactly** `{ type: 'task.diff', runId, ts, payload: { taskKey: string; diff: DiffSummary } }`, also added to `StarlingEventTypeSchema` (Epics 41 and 100). Epic 204 codes against this exact shape. If Epic 100's handback publishes something else, keep this shape, and note the mapping as a FIX REQUEST to the engine.
   - **g.** An optional merge-queue port: `MergeQueuePort { enqueue(repo: string, integrationBranch: string, run: TaskRun, opts: { testCommand?: string }): Promise<MergeResult> }` and `Merger.queue?(): MergeQueuePort` (Epic 70 CR2, Epic 40 CR4). Also `MergeResult.resolved?: boolean` (Epic 45).
   - **h.** `LLMResponse.usageSource?: UsageSource` with `export type UsageSource = 'reported' | 'estimated' | 'unknown'` (Epic 200 codes against this exact name).
   - **i.** `ProviderConfig.capabilities?: { jsonSchema?: boolean; jsonObject?: boolean; tools?: boolean; contextTokens?: number }` (Epic 10's limitation; Epic 200 reads it).
   - **j.** Config gets an optional `worktree: { maxGitConcurrency?: number; pruneIntervalMs?: number }` (positive ints, Epic 57). Epic 203 plumbs it.
   - **k.** The SEC-08 core half:
     - `normalizeRepoPath(path: string): string | undefined` in `glob.ts` runs `normalizeGlobPath`, then posix-normalises, and returns `undefined` for absolute paths, `../` escapes and any leftover `..` segment;
     - `matchesGlob` and `matchesAny` return `false` for a path that escapes, so a traversal never matches a lane;
     - test `src/../secrets.txt` against `src/**`.

     If a `test.failing` probe in `tools/security/` now passes, flip it per L36.
4. **Leave alone:** don't change existing `PRICING` rows (L28: peak rates) or existing semantics, and don't rename anything (L33). A new error code or event is fine; changing an enum's meaning is not.
5. **Fixtures still parse.** Extend `fixtures.test.ts` so `fixtures/runs/*.jsonl` **and** `fixtures/real/*.jsonl` still parse against `StarlingEventSchema` after your changes, and add a round-trip test for each new arm and field.
6. **Mocks** in `@starling/core/testing`:
   - `MockMerger` gets a `queue()` returning a serial queue;
   - `MockNode` sets `TaskHandle.worktreePath`;
   - add or update a mock test for each change.

   `@starling/core/browser` re-exports any new type the web needs (`UsageSource`, `MergeQueuePort` types only), and `browser.test.ts` still proves the entry is free of `node:` imports.
7. **Migration notes** (a section in `docs/epic-202-core-r2.md`). For each addition, name the consumer that should adopt it and the workaround it replaces. Examples:
   - the engine's `[code]` message prefix and its five `run.status` candidate shapes;
   - the queue's `TaskRunWithNodeName`;
   - the server's three diff shapes in `latestTaskDiff`;
   - web's `run-status.ts`-style detection;
   - the CLI's merge-port decorator.

   Each becomes a one-line FIX REQUEST in your handback, addressed to the owning lane.
8. **Tests: at least 30 new.** Cover zod round-trips, type-level assignments (a value typed with the new optional field and one without), config defaults, glob traversal, and the mocks.""",
oos="""- **Implementing behaviour behind the new fields.** Publishing `task.diff`, honouring `warnRatio` and `preview()`, merging through `queue()`: these belong to the engine, server, web and CLI owners. Your handback tells them.
- **Root config** (`package.json`, `tsconfig*.json`, `biome.json`).
- **Other packages' code**, with the one exception in the rules above.
- **`packages/llm`, `packages/runner`, `apps/cli` and `apps/web/src/data`**: they belong to Epics 200, 201, 203 and 204.""",
dod=["`bun test packages/core` → 0 fail, at least 30 new tests.",
     "`bunx tsc --noEmit -p packages/core` clean, and once through the gate: `bash .orchestrator/bin/heavy.sh bash -c 'for d in packages/* apps/*; do bunx tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done'` clean, because every consumer must still compile with your additions.",
     "`bun test tools/security/auditor-lane.test.ts packages/core/src/fixtures.test.ts` → 0 fail (paste).",
     "Paste the inventory grep's hit count next to the number of rows in your doc's request table. Every hit must be accounted for."],
carryover="""From `fix-requests-w2.md` and the Wave 2 handbacks:
- **Epic 49, FIX REQUESTS 1–3:** `log.payload.code?`, `stallAfterMs`, `budget.warnRatio`, `StartRunInput.budgetUsd?`. (The `run.status` arm is already done by Epic 40.)
- **Epic 49, FIX REQUEST 4; Epic 70, CR1; Epic 40, CR1:** `TaskHandle.worktreePath?`.
- **Epic 53, CRs 1–2:** `StartRunInput.budgetUsd?`, `EngineApi.preview?`.
- **Epic 41, FIX REQUEST 2:** a `task.diff` event, so real runs populate the diff route.
- **Epic 70, CR2; Epic 40, CR4:** an optional `Merger.queue?()` / `MergeQueuePort`.
- **Epic 45:** `MergeResult.resolved?` (it chose `resolved` on `ResolveResult` and named this as the natural core change).
- **SEC-08 (Epic 69):** lane-path normalisation in `glob.ts`, the additive core half.
- **Epic 57, FIX REQUEST 4:** the `worktree.maxGitConcurrency` and `worktree.pruneIntervalMs` config knobs.
- **Epic 55, FIX REQUESTS 1–2 and Epic 47, FIX REQUEST 1:** already landed by Epic 40. Verify them and list them as done.""",
extra_locked=owner_3b("`packages/core`", OWNERS["core"]) + """
- **Core write rights for this wave.** AGENTS.md §1's "never edit `contracts.ts` / `ports.ts`" and L30 ("core is owned by Epic 40") pass to you for Wave 3b: you are the only writer of `packages/core`. **Additive only.** Every new field is optional or has a default, and every new union arm leaves old recordings valid.
- **New event arms vs exhaustive switches.** Only `apps/web/src/data/reducer.ts` and `apps/web/src/data/demo.ts` have a `const neverEvent: never` exhaustiveness check. Epic 204 (in parallel) is told to feature-detect `task.diff` with a local type so it compiles both ways. After rebasing, run `cd apps/web && bunx tsc --noEmit -p .`. If it fails **only** because of your new arm (204 not merged yet), you may make one cross-lane edit: a single no-op `case 'task.diff':` arm in each of those two files, mirroring how Epic 40 added `run.status`. List it in your handback.""",
))

# ── 203 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="203", slug="cli-r2", title="CLI round 2: wire the extensions, exit codes and JSON output", wave="3b", convention=None,
lane="`apps/cli/**` (including the merged Wave 3a extension folders `apps/cli/src/ext/*`; see the rules for how to treat them)",
budget="90–150 min",
goal="""Wave 3a built a whole flock of commands (watch, gc, explain, completions, report, config, logs, try) as self-contained modules in `apps/cli/src/ext/*`, and none of them is reachable from `starling` yet. Wire every merged extension into the program, give the CLI **one** exit-code table and strict JSON-on-stdout discipline, and close the CLI FIX REQUESTS from Waves 2 and 3a. Great looks like this: a judge types `starling --help` and sees every command; `starling try`, `starling report fixtures/real/quick-wins.jsonl` and `starling watch` work straight from the binary; and every `--json` command prints exactly one JSON document, even when it fails.""",
deliverables="""1. **Inventory at start.**
   - Run `ls apps/cli/src/ext`. For each folder, read the module that exports `extension` (the Wave 3a CLI extension convention: `export const extension = { name, summary, register(program: Command, io: ExtIo) }`) and the "C3 wiring" section of its handback (`.orchestrator/handbacks/14[2-9]-*.md`).
   - Wire **only** folders that exist on main and export `extension`. Never create stubs for missing ones.
   - Your handback lists wired / not present / broken.
2. **`apps/cli/src/ext/registry.ts`**:
   - `export interface ExtIo { out(line: string): void; err(line: string): void; cwd: string; env: Record<string, string | undefined> }`, structurally identical to the convention;
   - `export interface CliExtension { name: string; summary: string; register(program: Command, io: ExtIo): void }`;
   - `export const EXTENSIONS: readonly CliExtension[]`, alphabetical;
   - `registerExtensions(program, io, extensions = EXTENSIONS): { registered: string[]; skipped: { name: string; reason: string }[] }`.

   Rules for `registerExtensions`:
   - an extension whose name collides with a built-in command (`plan run replay dash perch flock status doctor init`) or with an earlier extension is skipped with one stderr warning;
   - a `register()` that throws is caught and prints `✘ extension <name> failed to load: …`, so one bad module can't kill the CLI.
3. **`createProgram`.**
   - Add `CreateProgramOptions.extensions?: readonly CliExtension[]`. It defaults to `EXTENSIONS`; tests pass `[]` or fakes.
   - Build `ExtIo` from `deps.io`: `out` → `write(line + '\\n')`, `err` → `writeErr`, plus `cwd` and `env`.
   - Extension actions report failure through `process.exitCode` or a thrown error. Normalise both into the `onExitCode` hook when it's given.
   - Document that `dispatch` covers built-in commands only.
4. **Exit codes** (`apps/cli/src/exit-codes.ts`): `export const EXIT = { ok: 0, failed: 1, usage: 2, interrupted: 130 } as const`. Mapping:
   - commander usage errors (unknown option, missing or invalid argument) and `StarlingError` `INVALID_ARGUMENT` / `CONFIG_INVALID` → `2`;
   - a run that finished with failed tasks, or any other error → `1`;
   - `--help` and `--version` → `0`;
   - SIGINT → `engine.cancel(runId)`. A **second** SIGINT does `process.exit(130)`, per Epic 49's request.

   Before turning usage errors from 1 into 2, grep `tools/ evals/ skills/ integrations/ examples/scripts .github/` for callers that check the old code. List them in your doc, and file a FIX REQUEST for any you'd break.
5. **JSON discipline** (`apps/cli/src/json-out.ts` with `printJson(context, value)` and `jsonError(err): { error: { code: string; message: string; hint?: string } }`).
   - For every `--json` command (`plan`, `status`, `flock`, `doctor`, and any extension that has one), stdout carries exactly one JSON document. Progress and warnings go to stderr.
   - On failure under `--json`, stdout gets the `jsonError` document and the exit code is non-zero.
   - Add `run --json`: a final summary `{ runId, status, branch, merged, failed, apiCostUsd, localCostUsd, elapsedMs, recording? }` and nothing else on stdout.
6. **Carryover flags.**
   - `starling flock --hub <url>` (Epic 42).
   - `starling run --profile <name>`, with choices from `LLM_PROFILES` in `@starling/llm`, mapped into the composition's `profile`. `--fully-open` stays as an alias for `local` (Epic 51).
   - `starling doctor` prints `describeProfile(resolveLLMProfile(...))` lines once `@starling/llm` exports them. Epic 200 adds those exports in parallel, so feature-detect: `const llm = await import('@starling/llm') as Record<string, unknown>` plus a `typeof … === 'function'` check, so it compiles either way.
7. **Composition fixes** (`real/compose-real.ts`). Check each package's signature on main first, and skip or feature-detect anything a sibling hasn't merged yet:
   - build the auditor as `createAuditor({ llm: 'auto', bus })` if its options accept that (Epic 44);
   - pass the engine `policies: { stallAfterMs, budgetUsd }` and `worktreePathFor` (Epic 49);
   - give `createWorkspace` `maxGitConcurrency` and `pruneIntervalMs` from `config.worktree` when present (Epic 57; Epic 202 adds the schema);
   - if Epic 201's `createOpencodeServerPool` is on main, share one lease between the runner and the LLM router. Otherwise leave it as a note.
8. **SEC-01, client side.** If Epic 110's server-hardening merged with a token requirement, every command that calls the server (`flock`, `perch`, and extensions such as `watch`/`logs`) sends the token the way 110's handback documents. If it hasn't merged, skip this and say so.
9. **Stale strings.** Grep `apps/cli/src` for user-facing "Wave 1", "Epic 40" and "mock composition" text and update it (Epic 60).
10. **Tests: at least 35 new.** Cover:
    - the registry: collision, throwing extension, empty list;
    - every wired extension's command name appearing in `--help` (assert names, not whole snapshots);
    - the exit-code table per command (mock mode + `onExitCode`);
    - JSON purity: `JSON.parse(stdout)` succeeds for each `--json` command in mock mode, success and failure;
    - `--hub` and `--profile` parsing;
    - the second-SIGINT path with an injected exit.""",
oos="""- Other packages: `packages/llm` (200), `packages/runner` (201), `packages/core` (202) and `apps/web/src/data` (204) are parallel owners. `apps/server` belongs to 110/111's successors. Cross-lane needs are FIX REQUESTS.
- New commands. Your job is wiring and consistency. The terminal QR code needs a dependency (L34): decline it, or render the join URL more clearly.
- Real runs. That's Epic 207, and it uses your CLI as it is on main.""",
dod=["`bun test apps/cli` → 0 fail, at least 35 new tests.",
     "`bunx tsc --noEmit -p apps/cli` clean.",
     "`bun run starling --help` lists every wired extension command (paste it). Then paste one read-only extension running on a fixture, e.g. `bun run starling report fixtures/real/quick-wins.jsonl --format md | head -15` (use whichever wired extension fits).",
     "`bun run starling status --file fixtures/real/quick-wins.jsonl --json | bun -e 'JSON.parse(await Bun.stdin.text()); console.log(\"one JSON document\")'` prints `one JSON document`, and `bun run starling run x --max-parallel 0; echo exit=$?` prints a usage error and `exit=2`. Paste both."],
carryover="""- **Epic 42, FIX REQUEST 4:** `starling flock --hub <url>`. **FIX REQUEST 5** (terminal QR): decline it (needs a dependency, L34) or improve the copy-paste join line.
- **Epic 44:** construct the auditor as `createAuditor({ llm: 'auto', bus })`, so the profile env decides the reviewer and fallback warnings reach the event stream.
- **Epic 49, FIX REQUEST 5:** engine `policies: { stallAfterMs, budgetUsd }`, `worktreePathFor`, and a second SIGINT → `process.exit(130)`.
- **Epic 51, FIX REQUEST 2:** `starling run --profile <name>`, plus `doctor` printing `describeProfile`.
- **Epic 57, FIX REQUEST 1:** `starling gc`, now Epic 143's extension: wire it if it's merged. **FIX REQUEST 4:** plumb the worktree knobs from config.
- **Epic 60, FIX REQUEST 2:** remove the remaining stale "Wave 1 / mock composition" strings.
- **Epic 43:** `--github` reaching `createGitHubTracker`. Verify Epic 40 did it and list it as done.
- **Wave 3a:** every **C3 wiring** section in `.orchestrator/handbacks/14[2-9]-*.md`, plus any CLI FIX REQUEST in the other 1xx handbacks.""",
extra_locked=owner_3b("`apps/cli`", OWNERS["cli"]) + """
- **`apps/cli/src/program.ts` is yours this wave.** L32 lists it among the files C3 wires later; that doesn't apply to you. You *are* the CLI's C3 wiring for the extensions.
- **The extension folders are other people's finished work.** In `apps/cli/src/ext/<name>/`, fix only what blocks wiring (an import from `apps/cli/src/*.ts` that broke, a name collision, a missing `exitOverride`-safe path). List every edit you make there.
- **Tests never reach the real composition.** Since Epic 40, `createProgram` defaults to `mode: 'real'`, which spawns `opencode serve` and writes to the repo. Every test passes `deps: { mode: 'mock', … }` or uses `dispatch`.
- **Epic 206 (QA: CLI) is bug-hunting this CLI in parallel** from `tools/qa/cli/`, against the main it started from. Don't wait for it. Its FIX REQUESTS go to the next round.""",
))

# ── 204 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="204", slug="web-data-r2", title="Web data round 2: diff events, seekable replays, insights clients, feature slices", wave="3b", convention=None,
lane="`apps/web/src/data/**`",
budget="90–150 min",
goal="""Wave 3a shipped around 25 dashboard features that read state only through `FeatureProps` and the selectors. Each one ended its handback with a **C3 wiring** note listing what the data layer must provide. You are the single data owner who makes those wires possible:
- `task.diff` and `run.status` in the reducer;
- seekable replays for the scrubber;
- clients for the insights, compare, launch and preview routes;
- token- and server-URL-aware fetch and SSE;
- the store slices the new panels asked for;
- the reducer's copy-per-event cost removed.

Great looks like this: C3 can wire every merged feature without touching `apps/web/src/data` again, and a replay can scrub to any event of a 1,000-event real run and land on exactly the state a straight replay produces.""",
deliverables="""1. **Inventory at start.** Read the **C3 wiring** and **FIX REQUESTS** sections of every merged Wave 3 web handback: `.orchestrator/handbacks/1[1-4][0-9]-*.md` (112–141), plus 191 (qa-web-core) and 141 (web-perf) if present. Your doc gets a table: feature | data need | decision (implemented / exists / declined → owner) | export name. Implement every need that lives in `apps/web/src/data`. Needs in the shell or the server become FIX REQUESTS.
2. **Events.**
   - `task.diff` sets `state.diffs[diffKey(runId, taskKey)]`. Put a new `task-diff.ts` next to `run-status.ts`, with `isTaskDiffEvent` and a local `TaskDiffEvent` type `{ type: 'task.diff'; runId: string; ts: number; payload: { taskKey: string; diff: DiffSummary } }`. Exclude that type from the exhaustive union the same way `KnownStarlingEvent` excludes `RunStatusEvent`, so the reducer and `demo.ts` compile both before and after Epic 202 adds the core arm.
   - A cached diff is dropped when that task starts a later fix attempt (deferred by Epic 41).
   - `run.status` is now a real core arm (Epic 40). Keep the `isRunStatusEvent` and `RunStatusEvent` exports (L33), and test it against `fixtures/real/*.jsonl`.
3. **Seek** (`data/seek.ts`).
   - `seekState(events: readonly StarlingEvent[], index: number, cache?: SeekCache): SkyState` gives the same result as `applyEvents(createInitialState(), events.slice(0, index + 1))`, using checkpoints every 500 events so a seek costs at most 500 applies after warm-up.
   - `DemoHandle` gains (additively) `seek(index)`, `pause()`, `resume()`, `setSpeed(speed)`, `readonly length` and `readonly paused`.
   - The store gets a `playback` slice: `{ index: number; length: number; playing: boolean; speed: number; markers: { index: number; kind: 'merge' | 'fail' | 'finish' }[] }`, plus actions `seekTo(index)` and `setPlayback({ playing?, speed? })`. These are what the scrubber (124) emits.
   - Tests are deterministic, with injected `DemoTimers`.
4. **API clients** (`api.ts`). Every client returns `undefined` on 404/501 (route not mounted yet) and validates the response shape:
   - `startRun(input: StartRunInput & { budgetUsd?: number })` → `POST /api/runs`;
   - `previewRun(input)` → `POST /api/runs/preview` (Epic 53);
   - `fetchRunReport(runId)`, `fetchRunTimeline(runId)` and `fetchRunCosts(runId)` → `/api/runs/:id/report|timeline|costs`;
   - `fetchCompare(a, b)` → `/api/compare?a=&b=` (Epic 111's routes).

   Response types: import them from Epic 111's module only if it's browser-safe; otherwise use documented local mirror types.
5. **Server settings and auth.**
   - `ApiOptions` gains `baseUrl?` and `token?`. SSE `connectEvents` / `connectRunEvents` take the same options.
   - `EventSource` can't send headers, so use whatever Epic 110's handback documents (e.g. `?token=`). If 110 isn't merged, implement the option with a no-token default and say so.
   - A `serverSettings` slice plus `setServerSettings({ baseUrl?, token? })`. Settings (118) supplies these.
6. **Perf** (Epic 70's F8). `appendCapped` copies the whole capped array on every event: 5,000 elements at saturation. Make it amortised: allow up to 10% overflow, then trim once. The public array semantics stay the same (oldest first, length ≤ cap after trimming).
   - Add an op-count test: ingesting 50,000 events copies fewer than 12 elements per event on average. Count copies with a wrapper, never wall clock.
7. **Feature slices from the inventory.** Expected examples; build what the handbacks actually ask for:
   - a monotonic `eventSeq` for toasts (121);
   - `connectionStats { retries: number; lastError?: string; lastEventTs?: number }` for health (129);
   - an unfiltered all-runs event ring for the console (117);
   - `pinnedRunId` plus `pinRun(runId?)`, so auto-follow stops replacing a pinned selection (deferred by Epic 41).

   New pure selectors go in a new `selectors-w3.ts`. Existing selectors keep their outputs byte-identical: about 25 features import them.
8. **Exports.** `data/index.ts` exports everything new (additive).
9. **Tests: at least 40 new**, run with `cd apps/web && bun test src/data`. Cover:
   - reducer arms;
   - seek equivalence (forward, backward, random order) on `fixtures/real/launch-day.jsonl`, read with `node:fs` in the test;
   - playback markers;
   - the API clients with a fake `fetch` (404/501 → `undefined`, malformed → `undefined`);
   - token propagation;
   - the ring op counts;
   - pinning.""",
oos="""- The shell: `apps/web/src/app/**`, `App.tsx`, the feature registry (Epic 112) and C3's wiring lines.
- Feature folders (`apps/web/src/features/**`).
- `apps/server/**`: the insights routes (111) and the preview endpoint are server work. File FIX REQUESTS if a route you need is missing.
- `packages/core/**`: Epic 202 is adding `task.diff`, `log.payload.code?`, `StartRunInput.budgetUsd?` and `EngineApi.preview?` in parallel. Code against local types.""",
dod=["`cd apps/web && bun test src/data` → 0 fail, at least 40 new tests.",
     "`cd apps/web && bunx tsc --noEmit -p .` clean.",
     "Paste the names of the seek-equivalence tests over `fixtures/real/launch-day.jsonl` (1,141 events): `seekState(events, i)` deep-equals the straight replay for the first, middle and last index, and for a backwards-then-forwards sequence.",
     "`cd apps/web && bash ../../.orchestrator/bin/heavy.sh bun run build` OK. Paste the bundle size line, plus the inventory table's row count and how many rows are implemented."],
carryover="""- **Epic 70, F8:** `appendCapped` copies on every event (89 ms GC pauses at saturation). Make it amortised.
- **Epic 41, deferred:** refresh a cached drawer diff after a later fix attempt; pin the selected run against "newest run wins".
- **Epic 41, FIX REQUEST 2 (consumer side):** handle a `task.diff` event, so live diffs arrive without a fetch.
- **Epic 53, FIX REQUESTS 1–2 (data side):** the `startRun` and `previewRun(input)` web clients. Persisting recent repos and the `?repo=` handling are shell work, so FIX REQUEST them to the shell's owner.
- **SEC-01 (Epic 69), client half:** teach the web data layer to send the server token.
- **Wave 3a:** every data need in the **C3 wiring** sections of the web handbacks (deliverable 1).""",
extra_locked=owner_3b("`apps/web/src/data`", OWNERS["web"]) + """
- **Web tests run in their own process (L26).** Use `cd apps/web && bun test src/data` and `cd apps/web && bunx tsc --noEmit -p .` while you iterate. Clients always take an explicit `fetch` in tests.
- **Additive only.** Many features import `SkyState`, the selectors and `skyActions`, so add fields and actions but never rename or reshape existing ones (L33).""",
))

# ── 205 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="205", slug="evals-e2e", title="Evals: end-to-end (plan → run → audit → merge) with scripted agents", wave="3b", convention=None,
lane="`evals/e2e/**`, `evals/run.ts`, `evals/lib/**`, `evals/real.ts`",
budget="90–150 min",
goal="""The planner and auditor evals score the parts. Judges will ask whether the whole thing works. Build an **offline end-to-end eval** that drives the genuine stack: Epic 40's real composition with the real engine, git worktrees, auditor, merge queue and SQLite. Use the reference plan and **scripted agents** that write known-good (or deliberately bad) code, on each demo target. Score **task success**, **lane safety** and **time saved versus serial**. It runs with `bun evals/run.ts e2e` and needs no model and no API key. Great looks like this: one command prints a table that says, per demo goal, whether the pipeline merged what it should, kept every change inside its lane, and how much parallelism it bought.""",
deliverables="""1. **Composition** (`evals/e2e/compose.ts`). Build the stack with Epic 40's `composeReal(config, options)` from `apps/cli/src/real/compose-real.ts`, imported by relative path the way `evals/lib/core.ts` imports core. Its documented test seams are `llm`, `runner`, `store`, `storePath` and `worktreeRoot`. Plug in:
   - a `MockLLM` from core testing whose planner returns the case's reference plan and whose auditor/reviewer passes unless the case scripts a failure. The deterministic audit checks (lane, tests) stay real;
   - an `OpencodeRunner` pointed at the runner's in-process fake server (`packages/runner/test/fake-opencode.ts`, imported exactly as Epic 40's `compose-real.test.ts` does). Its prompt handler copies the case's scripted solution files for that task into the session directory.
2. **Cases** (`evals/e2e/cases/<id>/case.json` plus `solutions/<taskKey>/**`). Fields: `{ id, target, goalFile, plan: { tasks: [{ key, lane, dependsOn }] }, expect: Record<taskKey, 'merged' | 'failed' | 'conflict'>, requires?: ('bun' | 'python3.12')[] }`. Plans come from the task tables in `examples/*/demo-goals/*.expected.md`. Ship at least:
   - `sky-todo-quick-wins`: 3 tasks, all merged;
   - `sky-todo-conflict-bait`: the expected conflict or serialisation outcome from its answer key;
   - `sky-todo-will-fail-audit`: one scripted lane escape that is audited out while the others merge;
   - `py-ledger-quick-wins`: skipped with a reason when Python 3.12+ isn't available;
   - `mini-two-lanes`: a synthetic tiny target with no dependencies, created in a temp dir, used by the unit tests.

   Keep the solutions minimal: they only have to pass the target's own tests. If `examples/birdwatch-api` is on main (Epic 168), add its quick goal too.
3. **Harness** (`evals/e2e/harness.ts`): `runE2ECase(c: E2ECase, opts?: { keepRepo?: boolean; log?: (line: string) => void }): Promise<E2EResult>`.
   - Demo targets come from `bash examples/scripts/make-demo-repo.sh <target> <tmp>`. Synthetic targets are written directly.
   - The run goes through `engine.start` → `waitForFinish`, with `close()` always called and temp dirs removed (`keepRepo` keeps them for debugging).
   - Cap each case with a 120 s timeout that fails the case rather than hanging.
4. **Scoring** (`evals/e2e/score.ts`, pure). From the event log and git:
   - `taskSuccess = merged / expected merged`;
   - `expectationMatch` = the share of tasks whose final status equals `expect`;
   - `laneSafety = 1 − (files changed on base..integration outside the union of merged tasks' lanes) / (files changed)`, using `git diff --name-only` and core's `matchesAny`;
   - `timeSaved = 1 − wallMs / serialMs`, where `serialMs` is the sum over tasks of first `working` → `merged | failed`, taken from `task.status` event timestamps;
   - export the thresholds `E2E_SUCCESS_THRESHOLD = 1`, `E2E_LANE_SAFETY_THRESHOLD = 1` and `E2E_EXPECTATION_THRESHOLD = 1`.

   Unit-test it on synthetic event lists **and** on `fixtures/real/quick-wins.jsonl`, which should score 5/5 merged.
5. **`evals/run.ts`.** Add suite `e2e`: `bun evals/run.ts e2e [--case <id>] [--out <path>]`. It prints a table (case, tasks, merged, expectation, lane safety, time saved, wall) and writes the JSON report under `evals/results/` like the other suites. `--impl` doesn't apply to e2e; say so in `--help`. Planner and auditor behaviour stays byte-identical, and the existing `run.test.ts` stays green.
6. **`evals/real.ts`** (Epic 44's carryover). Document next to `loadRealAuditor` that it needs `STARLING_LLM_PROFILE` (or `STARLING_AUDITOR_PROFILE`). If `evals/auditor/run-real.ts` exports a reusable entry, delegate to it to get its retry. That file belongs to Epic 162: read it, never edit it.
7. **Determinism and cost.**
   - `bun test evals/e2e` runs only the pure scoring tests plus **one** end-to-end case (`mini-two-lanes`, kept around 20 s at most) with no network.
   - The demo-target cases run only through `bun evals/run.ts e2e`, because `make-demo-repo.sh` may run `bun install`.
   - Time-based scores are asserted only loosely in tests (e.g. `timeSaved > 0` for a two-lane parallel case).
8. **Tests: at least 25.**
9. **`evals/e2e/README.md`:** how to add a case, what each score means, and how this differs from Epic 207's real-run matrix (scripted agents versus real models).""",
oos="""- `evals/planner/**` (Epic 161) and `evals/auditor/**` (Epic 162): read only.
- `apps/cli/**` (Epic 203, in parallel): import `composeReal` as it is. If its seams don't fit, write a local adapter and file a FIX REQUEST.
- `packages/**`: FIX REQUESTS only.
- Real models and opencode. Epic 207 does real runs. Your agents are scripted.
- Changing `examples/**`. Scripted solutions live in your lane, never in the demo targets.""",
dod=["`bun test evals/e2e evals/run.test.ts` → 0 fail, at least 25 new tests.",
     "`bunx tsc --noEmit -p evals/tsconfig.json` clean.",
     "`bun evals/run.ts e2e --case sky-todo-quick-wins` → the table shows 3/3 merged, lane safety 1.00 and time saved > 0 (paste it).",
     "`bun evals/run.ts e2e` → paste the full table, with every case passing or listed as skipped with a reason."],
carryover="""- **Epic 44, FIX REQUEST 1:** `evals/real.ts` must document the profile env requirement next to `loadRealAuditor`, and should delegate to `evals/auditor/run-real.ts` to get the provider-hiccup retry and per-check detail.""",
extra_locked=READ_ONLY_3B + """
- **`evals/` is not a Bun workspace.** Import packages and apps by relative path (see `evals/lib/core.ts`). The root typecheck loop doesn't cover `evals/`, so typecheck it with `-p evals/tsconfig.json` yourself.""",
))

# ── 206 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="206", slug="qa-cli", title="QA: CLI", wave="3b", convention="qa",
lane="`tools/qa/cli/**`",
budget="60–120 min",
goal="""A judge's first contact with Starling is `starling --help`, then `starling try` or `starling run`. Bug-hunt **every CLI command and flag**: the built-in commands, plus the Wave 3a extensions wherever they're wired. Drive them through `createProgram` with its `dispatch` and `deps` hooks and the mock composition. Pin down help text, flag parsing, exit codes, JSON purity and error messages against what the docs promise. Great looks like this: a harness any later epic can reuse, 40+ regression tests, and a short, precise bug table the CLI owner can fix in one sitting.""",
deliverables="""1. **Harness** (`tools/qa/cli/harness.ts`): `runCli(argv: string[], opts?: { deps?: Partial<CliDeps>; cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }>`.
   - It's built on `createProgram({ deps: { mode: 'mock', mockStepMs: 0, color: false, config: defaultConfig, env: {}, io: { write, writeErr, isTTY: false, columns: 100 }, … }, onExitCode })`.
   - Import `apps/cli/src/index.ts` by relative path; `tools/` is not a workspace (see `tools/security/support.ts`). Add `tools/qa/cli/tsconfig.json` like `tools/security/tsconfig.json`.
   - The harness **throws if `deps.mode` is anything other than `'mock'`**.
   - Temp dirs go under `os.tmpdir()` and are removed afterwards.
2. **Parsing, via `dispatch`.** Cover every built-in command (`plan run replay dash perch flock status doctor init`) and each flag from `program.ts`:
   - defaults;
   - required arguments;
   - invalid values (`--max-parallel 0`, `--speed -1`, `--budget abc`, `--port 0`, `init --profile nope`);
   - unknown flags;
   - per-command `--help` containing an `Examples:` block;
   - `--version`.
3. **Behaviour, in mock mode.**
   - `plan --json` purity: stdout parses as exactly one JSON document, and progress goes to stderr.
   - `run --mock --no-dash` → exit 0 with a summary.
   - `status --file fixtures/runs/sky-todo-launch-day.jsonl --json`, plus the same for `fixtures/real/quick-wins.jsonl`.
   - `replay <fixture> --speed 1000`.
   - `flock --json`.
   - `doctor --json`, with injected `execFn` / `fetchFn` so no real probe runs.
   - `init --dry-run` in a temp dir writes nothing.
   - Error paths: a missing file, malformed JSONL (does the message name the line?), an unknown run id, a bad config file. Check each one's exit code and that the message carries the `code` and `hint` lines from `formatCliError`.
4. **Extensions.** For every folder in `apps/cli/src/ext/*` that exports `extension`:
   - register it on a fresh `new Command().exitOverride()` with an in-memory `ExtIo`. That's the Wave 3a extension convention: `export const extension = { name, summary, register(program: Command, io: ExtIo) }`, where `ExtIo = { out(line), err(line), cwd, env }`;
   - test its documented flags and output against its `docs/epic-14[2-9]-*.md` and handback, using fixtures only (`fixtures/runs`, `fixtures/real`). `try` and `watch` run with injected fakes or `--help` only, never a real server, browser or long loop;
   - if `program.ts` already wires extensions when you start (Epic 203 may have merged), also test them through `createProgram`.
5. **Contract table** (`contract.test.ts`). One table-driven test pinning, per command: exit code on success, on usage error and on runtime error; whether `--json` exists; and stdout/stderr separation. Use only what Epic 22's, Epic 40's and Epic 61's docs promise. Where the docs are silent or contradict each other (e.g. a usage error exiting 1 or 2), write an **Open question**, not a bug.
6. **`REPORT.md`** in your folder (per L39), plus FIX REQUESTS addressed to `apps/cli` for the round after Epic 203.""",
oos="""- Editing `apps/cli/**`: it belongs to Epic 203, which runs in parallel.
- Real runs, real `opencode`, real network, real `doctor` probes.
- Server and web behaviour behind CLI commands (`dash` only to the extent of the CLI's own output).""",
dod=["`bun test tools/qa/cli` → 0 fail, at least 40 tests, plus any `test.todo('BUG …')`.",
     "`bunx tsc --noEmit -p tools/qa/cli` clean.",
     "Paste `grep -c \"test.todo('BUG\" tools/qa/cli/*.test.ts` next to the number of rows in REPORT.md's bug table. They must match."],
carryover="",
extra_locked=READ_ONLY_3B + """
- **Never reach the real composition.** Since Epic 40, `createProgram` defaults to `mode: 'real'`, which spawns `opencode serve` and writes into the repo. Always pass `deps.mode: 'mock'` or use `dispatch`; the harness guard in deliverable 1 enforces this.
- **Epic 203 owns `apps/cli` and is changing it in parallel:** it's wiring extensions, defining an exit-code table (`usage: 2`) and adding JSON error documents. Test against the main you started from. Before pushing, rebase. If 203 has merged and deliberately changed a behaviour you pinned (documented in `docs/epic-203-cli-r2.md`), update your test to the documented behaviour instead of filing a bug.""",
))

# ── 207 ──────────────────────────────────────────────────────────────────────────────────────────
SPECS.append(dict(
nn="207", slug="real-run-matrix", title="Real-run matrix: every demo target, for real", wave="3b", convention=None,
lane="`tools/realrun/**`, `fixtures/real/**` (new files only; see the rules)",
budget="90–150 min (most of it waiting on runs)",
goal="""Starling's headline claim is that a flock of open-weight agents ships real, tested work. Epic 40 proved it on sky-todo, with 5/5 merged on quick-wins and 6/6 on launch-day. Now prove it across **every demo target**: run each target's main goal **for real**, one run at a time, record it, check the integration branch's own test suite, and publish a matrix of success, wall time, speedup versus serial, cost and tokens. The README, blog and about page can quote it. **Honest numbers beat pretty numbers:** a failed run is a row, not a secret. Great looks like this: a `REPORT.md` with at least 3 real runs, their recordings in `fixtures/real/matrix/`, and a reusable `matrix.ts` that reproduces it on demo day.""",
deliverables="""1. **`tools/realrun/summarise.ts`** (pure). `summariseRecording(events: StarlingEvent[]): RunSummary`, where `RunSummary` is `{ runId, goal, tasksPlanned, merged, failed, conflicts, wallMs, serialMs, speedup, apiCostUsd, apiTokens: TokenUsage, localTokens: TokenUsage, auditFailures, fixAttempts }`. `serialMs` is the sum over tasks of first `working` → `merged | failed`. Test it on Epic 40's `fixtures/real/quick-wins.jsonl` and `launch-day.jsonl`; the summary must agree with Epic 40's handback (5 merged, $0.223; 6 merged, $0.517, within rounding).
2. **`tools/realrun/matrix.ts`**: `bun tools/realrun/matrix.ts [--only <target>:<goal>] [--dry-run] [--budget-per-run 1.50] [--total-budget 6]`. For each entry, strictly one at a time:
   - **Preflight.** `opencode --version` works; `bun run starling doctor --json` reports git, bun and opencode as OK; no other `starling run` is alive (`pgrep -f "starling run"`).
   - **Demo repo.** `bash examples/scripts/make-demo-repo.sh <target> <tmp>`.
   - **The run itself.** `bash .orchestrator/bin/heavy.sh bun run starling run "$(cat <goal file>)" --repo <tmp> --no-dash --budget <n> --record fixtures/real/matrix/<target>-<goal>.jsonl`, with a hard 25-minute timeout.
   - **Integration tests.** Check out the integration branch the run printed into a temp worktree and run the target's own tests: `bun test` for sky-todo, or `pytest` inside the target's `.venv` for py-ledger.
   - **Record.** Append a row to `tools/realrun/results/matrix.json` (`{ version: 1, rows: MatrixRow[] }`; export the TS type for Epics 154/137/180).
   - **Budget stop.** When cumulative API cost reaches `--total-budget`, stop.

   `--dry-run` prints the planned commands without executing anything. The unit tests drive it with an injected `exec`.
3. **Matrix order, smallest first.**
   1. sky-todo `quick-wins`
   2. py-ledger `quick-wins` (a "skipped: no Python 3.12+" row if the venv can't be made)
   3. `examples/birdwatch-api`'s quickest goal, only if Epic 168 merged (otherwise a skipped row)
   4. sky-todo `launch-day`
   5. sky-todo `conflict-bait`: it exercises the resolver if the engine wires it; record what happened

   Stretch, only if time and budget remain: sky-todo `will-fail-audit`. For each row, note the expected decomposition from the goal's `.expected.md` (planned versus expected task count; Epic 40 saw 6 planned where 7 were expected).
4. **Report.** `bun tools/realrun/report.ts` renders `tools/realrun/REPORT.md` from `matrix.json`. It contains:
   - one table row per run: target, goal, planned/merged/failed, wall, serial estimate, speedup, API cost, tokens, integration tests ✓/✗, recording;
   - totals;
   - a "what went wrong" note per failed or partial run, drawn from its `log` and `audit.verdict` events;
   - a reproduce section.
5. **Recording hygiene.**
   - New recordings go only to `fixtures/real/matrix/`, at most 5 MB each.
   - **Never overwrite or delete** Epic 40's `fixtures/real/quick-wins.jsonl` or `launch-day.jsonl`: other epics' tests and docs read them.
   - `secrets.test.ts` scans every committed recording for `OPENCODE_SERVER_PASSWORD`, `password`, `sk-`, `ghp_`, `Bearer ` and the user's home path, and must pass before you commit.
6. **Failures are data.** A failed, partial or timed-out run is a row with its reason. Retry a run at most once, and only for an infrastructure failure (opencode didn't start). Never edit goals or targets to make the matrix green. Every real-run problem with an owner becomes a FIX REQUEST (llm 200, runner 201, core 202, cli 203, engine and the others to their next owner).
7. **Tests: at least 20.** Cover summarise (both Epic 40 fixtures plus synthetic edge cases: no tasks, all failed, a missing `run.finished`), dry-run planning, the budget stop, skip logic, report rendering (assert rows, no snapshots) and the secret scan.""",
oos="""- Editing any package or app. Real-run bugs are FIX REQUESTS to their owners (Epics 200–204 are changing llm, runner, core, cli and web data in parallel).
- `--github` runs: no GitHub side effects. `--fully-open` and local models (L23/L31).
- Two-laptop flock runs (that's the demo kit, Epic 158). Editing `examples/**`.""",
dod=["`bun test tools/realrun` → 0 fail, at least 20 tests (no real runs inside tests).",
     "`bunx tsc --noEmit -p tools/realrun` clean (add `tools/realrun/tsconfig.json` like `tools/security/tsconfig.json`).",
     "`bun tools/realrun/matrix.ts --dry-run` prints the planned matrix (paste it).",
     "The real matrix ran: `tools/realrun/results/matrix.json` has at least 3 rows, including sky-todo quick-wins with its integration tests green. Paste REPORT.md's table and the total API cost (at most $6)."],
carryover="""- **Epic 42, FIX REQUEST 6:** a real flock smoke (hub + one perch on this Mac, `maxSessions: 1` on the hub, quick-wins goal) recorded to `fixtures/real/flock-loopback.jsonl`. Stretch: only after the matrix, only within budget, using `tools/flock`'s loopback docs. Otherwise decline it with the reason.
- **Epic 40, open question:** the launch-day goal planned 6 tasks, not 7. Record planned versus expected task counts for every row, so the demo script quotes the model's real behaviour.""",
extra_locked=READ_ONLY_3B + """
- **L37 override (this epic only): real runs are allowed.** You may run real Starling runs through the `opencode` profile (L29):
  - **one at a time**, never two at once, smallest goal first;
  - each with `--budget` ≤ 1.50, and the whole matrix ≤ $6;
  - every real run wrapped in `bash .orchestrator/bin/heavy.sh`, so it never overlaps another agent's full-suite run.

  Still forbidden: Ollama and local models (L23/L31), `--fully-open`, and `--github`.
- **`fixtures/real/**` is yours for new files only.** Epic 40's two recordings stay byte-identical.
- **If `starling run` is broken on main,** record the failure as a matrix row with the error, file a FIX REQUEST to the owning Wave 3b epic, and continue with the next target. Don't patch other lanes.""",
))
