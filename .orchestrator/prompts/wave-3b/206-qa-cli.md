# Epic 206: QA: CLI

**Wave 3b · Branch `epic/206-qa-cli` · Issue: `gh issue list --search "Epic 206 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-206-qa-cli.md` and `.orchestrator/handbacks/206-qa-cli.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **L39 QA epics.** You are a bug hunter, not a fixer. Read the code and docs of your area, then write **behaviour tests** that pin down what the docs/contracts promise, importing only public exports (`packages/<x>/src/index.ts` by relative path, or the app's exported factories). Tests that pass are kept as regression tests. A confirmed bug becomes `test.todo('BUG <area>: …', () => { …real assertions… })` plus a FIX REQUEST in your handback with file, line, a minimal repro, and a suggested fix. Aim for 40+ meaningful tests and every bug you can find. Don't invent behaviour the docs don't promise: if the contract is ambiguous, write it up as an **Open question** instead. Also write `REPORT.md` in your folder: what you covered, a bug table (id, severity, file:line, one-line repro), and what you'd test next.
- **Wave 3b context.** Your `main` includes Epic 40 (the real `starling run`, `fixtures/real/*.jsonl`) and the Wave 3a epics merged so far (`git log --oneline origin/main | head -40`; Wave 3a handbacks are `.orchestrator/handbacks/1[0-9][0-9]-*.md`). `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` now belong to Epics 200–204, which run **in parallel** with you: import from them, never edit them, and never wait for them.
- **Never reach the real composition.** Since Epic 40, `createProgram` defaults to `mode: 'real'`, which spawns `opencode serve` and writes into the repo. Always pass `deps.mode: 'mock'` or use `dispatch`; the harness guard in deliverable 1 enforces this.
- **Epic 203 owns `apps/cli` and is changing it in parallel:** it's wiring extensions, defining an exit-code table (`usage: 2`) and adding JSON error documents. Test against the main you started from. Before pushing, rebase. If 203 has merged and deliberately changed a behaviour you pinned (documented in `docs/epic-203-cli-r2.md`), update your test to the documented behaviour instead of filing a bug.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`tools/qa/cli/**`
plus `docs/epic-206-qa-cli.md` and `.orchestrator/handbacks/206-qa-cli.md`. Read anything.

## Goal
A judge's first contact with Starling is `starling --help`, then `starling try` or `starling run`. Bug-hunt **every CLI command and flag**: the built-in commands, plus the Wave 3a extensions wherever they're wired. Drive them through `createProgram` with its `dispatch` and `deps` hooks and the mock composition. Pin down help text, flag parsing, exit codes, JSON purity and error messages against what the docs promise. Great looks like this: a harness any later epic can reuse, 40+ regression tests, and a short, precise bug table the CLI owner can fix in one sitting.

## Deliverables
1. **Harness** (`tools/qa/cli/harness.ts`): `runCli(argv: string[], opts?: { deps?: Partial<CliDeps>; cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }>`.
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
6. **`REPORT.md`** in your folder (per L39), plus FIX REQUESTS addressed to `apps/cli` for the round after Epic 203.

## Explicitly out of scope
- Editing `apps/cli/**`: it belongs to Epic 203, which runs in parallel.
- Real runs, real `opencode`, real network, real `doctor` probes.
- Server and web behaviour behind CLI commands (`dash` only to the extent of the CLI's own output).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/qa/cli` → 0 fail, at least 40 tests, plus any `test.todo('BUG …')`.
3. `bunx tsc --noEmit -p tools/qa/cli` clean.
4. Paste `grep -c "test.todo('BUG" tools/qa/cli/*.test.ts` next to the number of rows in REPORT.md's bug table. They must match.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-206-qa-cli.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/206-qa-cli.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/206-qa-cli`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
