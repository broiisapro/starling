# Epic 201: Runner round 2: opencode 2.x edge cases, session cleanup, server pool, log limits

**Wave 3b · Branch `epic/201-runner-r2` · Issue: `gh issue list --search "Epic 201 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-201-runner-r2.md` and `.orchestrator/handbacks/201-runner-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Wave 3b ownership.** You are the **single owner of `packages/runner`** in Wave 3b. The header's line saying `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are off limits was written for Wave 3a and **does not apply to your lane**. The other areas in that list stay off limits to you: Epics 200 (`packages/llm`), 202 (`packages/core`), 203 (`apps/cli`) and 204 (`apps/web/src/data`) own them and run **in parallel** with you, so never wait for them and never edit their lanes.
- **Where main is now.** Your `main` includes Epic 40 (the real `starling run`: `apps/cli/src/real/compose-real.ts`, real recordings in `fixtures/real/*.jsonl`, its core additions) and the Wave 3a epics merged so far. Start with `git log --oneline origin/main | head -40`, `docs/epic-40-integration-captain.md` and `.orchestrator/handbacks/40-integration-captain.md`. The Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md` (careful: `1*.md` also matches the Wave 1 handbacks 10–19). Read the ones that mention your area: their **FIX REQUESTS**, **CONTRACT REQUESTS** and **C3 wiring** sections are carryover for you too, exactly like `fix-requests-w2.md`.
- **Consumers outside your lane:** `packages/llm` (Epic 200, in parallel), `packages/perch/src/compose-perch.ts`, `tools/load/runner.ts`, `tools/flock/replay-agent.ts` and Epic 40's `apps/cli/src/real/compose-real.ts`. Every change must be additive (new options default to today's behaviour), so all of them still compile and pass untouched.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- **Epic 40, CONTRACT REQUEST 3:** map `session.tool.error` and any other 2.1.x tool-failure names (the coverage test settles this for good).
- **Epic 40, Fix 2:** keep the stateless `generate` path on `OpencodeClient` and its tests (`packages/llm` depends on it).
- **Epic 70, F4:** `ReplayRunner` re-emits recorded timestamps, so a live replay's events are stale. Add `retime`.
- **Epic 49, limitation:** the runner's backoff holds the session's semaphore slot. Release it while waiting.
- **Epic 15, known limitations:** the free-port race (now the pool's retry), unanswered permission/question prompts, no attach-mode version check, and `ReplayRunner` serving only one session.

## Your lane (you may write ONLY here)
`packages/runner/**`
plus `docs/epic-201-runner-r2.md` and `.orchestrator/handbacks/201-runner-r2.md`. Read anything.

## Goal
The runner is the bridge between Starling and real agents. Epic 40 learned opencode 2.1.2's streaming vocabulary the hard way, with a live run that emitted nothing but `session.started` and `session.idle`. Make the runner boringly reliable for a 30-bird run on demo day:
- every event type in the server's spec is either mapped or deliberately ignored;
- permission prompts never leave a task hanging for four minutes;
- agent sessions get deleted;
- one spawned `opencode serve` can be leased by the runner and the LLM router together;
- transcripts are bounded, and replays can be re-timed for live demos.

Great looks like this: a test table proves coverage of the whole opencode vocabulary, and nothing in the runner can grow without bound.

## Deliverables
1. **Read first.** Read `src/opencode/normalize.ts` after Epic 40, plus the stateless generate method Fix 2 added to `OpencodeClient` (Epic 200 depends on it: keep it, L33). Put the current mapping table (opencode event type → `AgentEvent` kind) in your doc as the reference.
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
10. **Tests: at least 40 new**, all against `test/fake-opencode.ts`, fake spawn and a `FakeClock` or manual scheduler. Never a real `opencode`.

## Explicitly out of scope
- `packages/llm/**` belongs to Epic 200. It consumes `OpencodeClient`, so never rename or remove anything on it.
- `packages/core/**` belongs to Epic 202. New `AgentEventKind`s (reasoning, compaction) are a CONTRACT REQUEST; keep mapping them to existing kinds or ignoring them.
- `apps/cli/src/real/**` belongs to Epic 203: using the pool in the composition is C3/203 wiring.
- `packages/flock` (`LocalNode.cleanup` calling `release`) and `packages/engine` are FIX REQUESTS only.
- Real opencode sessions and real prompts.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test packages/runner` → 0 fail, at least 40 new tests.
3. `bunx tsc --noEmit -p packages/runner` clean.
4. Paste the vocabulary-coverage test's output line, showing how many spec event types are mapped and how many are ignored, with 0 uncovered.
5. Paste the names of the pool tests that prove (a) two `acquire()` calls share one spawned process, (b) the process is killed after the last `release()`, and (c) a simulated `EADDRINUSE` exit is retried.
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-201-runner-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/201-runner-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/201-runner-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
