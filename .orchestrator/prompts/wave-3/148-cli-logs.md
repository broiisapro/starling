# Epic 148: CLI: `starling logs`, per-task agent transcripts

**Wave 3 · Branch `epic/148-cli-logs` · Issue: `gh issue list --search "Epic 148 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-148-cli-logs.md` and `.orchestrator/handbacks/148-cli-logs.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **L39 CLI extension module.** `apps/cli/src/program.ts` and everything else in `apps/cli/src` belong to Epic 40 right now. You build a self-contained module in your own folder `apps/cli/src/ext/<name>/` that C3 registers with one line:
  ```ts
  import type { Command } from 'commander';
  export interface ExtIo { out(line: string): void; err(line: string): void; cwd: string; env: Record<string, string | undefined> }
  export const extension = {
    name: '<command name>', summary: 'one line for --help',
    register(program: Command, io: ExtIo): void { /* program.command(...).option(...).action(...) */ },
  } as const;
  ```
  Depend only on `commander`, `@starling/core` and other packages' public `index.ts` exports, plus `node:*`/`bun` built-ins. Don't import from `apps/cli/src/*.ts` (it's changing under Epic 40), except types re-exported by core. Tests register your extension on a fresh `new Command()` with `exitOverride()` and an in-memory `ExtIo`. Add a tiny `apps/cli/src/ext/<name>/try.ts` entry (`bun apps/cli/src/ext/<name>/try.ts <args>`) so the command can be used before C3 wires it, and paste a real invocation's output in the handback.
- **Imports from other packages (C1 CLI rule).** On the base you branch from, `apps/cli/package.json` lists only `@starling/core`, `@starling/perch`, `commander` and `picocolors` (Epic 40 adds the rest, but may not be merged when you start, and you must not touch `package.json`). So import any other workspace package **by relative path to its public entry**, exactly like `tools/load` does: `../../../../../packages/<pkg>/src/index.ts` and `../../../../server/src/index.ts`. Never import `apps/cli/src/*.ts` (Epic 40 is rewriting `commands/*`, `context.ts`, `compose.ts`, `program.ts`). If you need a pure helper from there (`render/format.ts`'s `fmtDuration`, `fmtUsd`, `fmtTokens`, `renderTable`, `stripAnsi`, `truncate`; `render/palette.ts`'s NO_COLOR/FORCE_COLOR rule), **copy** it into your folder with a one-line `// copied from apps/cli/src/render/format.ts (Epic 22)` comment. `picocolors` (already a CLI dependency) is fine for colour. In the handback, list the relative imports so Epic 203 can switch them to `@starling/<pkg>` later.
- **Read events leniently.** `readEventsJsonl` (CLI) and `@starling/store`'s `parseJsonl` both throw on any event type they don't know, and newer recordings will carry types this base doesn't have (Epic 40 adds `run.status`, Epic 100 may add `task.diff`). Write your own small reader: per line `JSON.parse`, then `StarlingEventSchema.safeParse` from `@starling/core`; an object whose `type` isn't in `StarlingEventTypeSchema.options` is **skipped and counted** (report "skipped N unknown events" in dim text), a malformed *known* event is a `StarlingError('INVALID_ARGUMENT', '<file>:<line>: …')`. Blank lines are fine.
- **Server facts** (from `apps/server/src`): SSE frames are `data: <StarlingEvent JSON>\n\n`, with `: connected` and `: keep-alive` comment lines; `GET /api/runs` (array of `Run`), `GET /api/runs/:id/events?since=<ts>` (backlog then live), `GET /api/events` (all runs plus `runId: '*'` node events), `GET /api/health`. Default URL `http://127.0.0.1:7777`, overridable by `--url` or `STARLING_URL`. Epic 110 may add an auth token in parallel: accept `--token` / `STARLING_TOKEN` and, when set, send it as both `x-flock-token` and `authorization: Bearer <token>`.
- **Testable shape.** Put the logic in `run<Name>(options, deps): Promise<number>` (returns the exit code) where `deps` injects `out`, `err`, `now`, `sleep`, `fetch`, `exec` (core `exec` signature), `isTTY`, `columns`, `env`, `cwd`. `register()` only parses flags, builds real deps from `ExtIo` + `process`, calls `run<Name>`, and sets `process.exitCode` when the code is non-zero. Unit tests call `run<Name>` with fakes; a few tests go through commander to pin flag parsing and `--help` text. Your folder's `index.ts` exports `extension` (and your public functions/types).
- **Test data.** `fixtures/runs/sky-todo-launch-day.jsonl` (252 events, 7 tasks, 3 nodes, an `air` node that drops and a `search` task that migrates back to the hub, one audit fail on `theme` fixed on attempt 2, final `metrics` with `apiCostUsd`/`estSavedUsd`) and `fixtures/plans/sky-todo-launch-day.json` (a raw `Plan`) exist on your base. `fixtures/real/*.jsonl` arrive with Epic 40: use them if present, never require them.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/cli/src/ext/logs/**`
plus `docs/epic-148-cli-logs.md` and `.orchestrator/handbacks/148-cli-logs.md`. Read anything.

## Goal
When a bird misbehaves, you want its transcript: what it read, which tools it called, which files it edited, how many tokens it burned, what the auditor said, and how the merge went, in order, in colour, filterable. `starling logs [task]` is the `kubectl logs` of Starling: from a recording or live from the hub (`--follow`). Great looks like: `starling logs theme` tells the story of the theme task's two attempts at a glance, `--follow` streams new lines as they happen, and `--json` pipes cleanly into `jq`.

## Deliverables
1. `index.ts` exporting `extension` (`name: 'logs'`) registering `starling logs [task]` with `--file <run.jsonl>`, `--url <url>`, `--token <t>`, `--run <id>`, `--follow` (`-f`), `--kind <kinds>` (comma list of agent event kinds and/or `status,audit,merge,log,node`), `--level <debug|info|warn|error>` (minimum for `log` events, default `info`), `--since <duration>` (`30s`, `5m`, `1h`, relative to the last event for files and to now for live), `--tail <n>` (last n lines, default all), `--json` and `--no-color`.
2. Sources: `--file` reads the recording leniently (C1 rule); with `--follow` it tails the file as it grows (poll size, buffer partial lines). Without `--file`, fetch the backlog and follow from `GET /api/runs/:id/events` (run = `--run` or newest from `GET /api/runs`); without `--follow` it prints the backlog and exits when the backlog is drained (close the stream after the first keep-alive or after an idle window, injectable). Reconnect with `?since=<lastTs>` on a dropped stream (copy a small SSE reader; don't import from Epic 142).
3. Task matching: exact key, else unique prefix, else unique substring; ambiguous → exit 2 listing candidates; no task arg → all tasks, each line prefixed with a coloured, padded task key (stable colour per key from a hash).
4. `format.ts`: `formatLogLine(event, { palette, width, showTask, now? }): string | null`, one line per event, with an elapsed time column (`m:ss` from run start): `session.started` (`▶ session on hub · deepseek-v4.1-flash`), `text` (wrapped, first 3 lines unless `--full`), `tool.call` (`⚙ read src/lib/dates.ts`), `tool.result` (`✓ 1.2 KB` / `✗ error…`), `file.edited` (`✎ src/lib/dates.ts +34 −18`), `usage` (`Σ 12.4k in / 1.8k out (3.2k cached)`), `session.idle`, `session.error` (red); plus `task.status` (`theme running → auditing`), `audit.verdict` (pass/fail + summary + first line of `fixInstructions`), `merge.result`, `task.migrated`, `node.left`, and `log` events at or above `--level`. Unknown `data` shapes fall back to compact JSON, truncated to the width.
5. Attempt separators: when a task re-enters `running` after `fixing`, print a dim `── attempt 2 ──` rule.
6. `--json`: one compact `StarlingEvent` JSON per line (the filtered events, unchanged), so `starling logs theme --json | jq` works; nothing else on stdout.
7. Footer (non-JSON, non-follow): `N events · M tasks · K skipped (unknown types)` in dim text on stderr.
8. Exit codes: 0, 1 (source unreachable / unreadable), 2 (bad arguments or unknown task).
9. `try.ts`: `bun apps/cli/src/ext/logs/try.ts theme --file fixtures/runs/sky-todo-launch-day.jsonl`.
10. Tests (≥ 30): formatting of every agent event kind with the fixture's real `data` shapes (`{ text }`, `{ tool, path }`, `{ ok, bytes }`, `{ path, added, removed }`, usage fields); task matching (exact, prefix, ambiguous); `--kind`, `--level`, `--since`, `--tail` filters; attempt separator for `theme`; `--json` purity and round-trip through `StarlingEventSchema`; colour off → no escapes; `--follow` on a file appended in steps (with an `AbortSignal` to stop); live backlog from a `Bun.serve` fake on `127.0.0.1:0` including a reconnect with `since`; unknown task exit 2.

## Explicitly out of scope
- `starling watch` (Epic 142) and the web event console (Epic 117): similar sources, different views; don't share code across lanes.
- Reading opencode's own log files or the SQLite store directly (use the recording or the server).
- Any server change (FIX REQUEST to Epic 110 if an endpoint is missing).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test apps/cli/src/ext/logs` → 0 fail, ≥ 30 tests.
3. `bunx tsc --noEmit -p apps/cli` clean.
4. `bun apps/cli/src/ext/logs/try.ts theme --file fixtures/runs/sky-todo-launch-day.jsonl --no-color` (paste: both attempts with the separator and the failed audit) and `bun apps/cli/src/ext/logs/try.ts --file fixtures/runs/sky-todo-launch-day.jsonl --kind file.edited --json | wc -l` (paste the count).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-148-cli-logs.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/148-cli-logs.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/148-cli-logs`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
