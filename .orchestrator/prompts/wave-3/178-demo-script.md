# Epic 178: Demo script (3 and 5 minutes), backup plans, judge Q&A, pre-demo checklist

**Wave 3 · Branch `epic/178-demo-script` · Issue: `gh issue list --search "Epic 178 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-178-demo-script.md` and `.orchestrator/handbacks/178-demo-script.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **D1 docs convention (shared by Epics 172–183, all writing in parallel).**
  - **Entry points:** every docs area has its index at `docs/<area>/README.md`. Link siblings by these planned paths even if they don't exist yet: `docs/guide/` (175), `docs/api/` (176), `docs/architecture/` (177), `docs/demo/` (178), `docs/blog/` (180), `docs/troubleshooting/` (181), `docs/models/` (182), `docs/flock/` (183), `docs/release/` + `CHANGELOG.md` (174), `CONTRIBUTING.md`, `SECURITY.md`, `docs/good-first-issues.md` (173), `examples/README.md` (171), `examples/birdwatch-api/` (168), `site/` (179).
  - **The pending marker:** anything not merged on `main` yet gets `⏳ Epic NN` (or `⏳ C3` for wiring) on the same line or table row. Checkers skip existence checks on marked lines but require the marker to name an epic. Never present unmerged behaviour as working.
  - **The real-run flow (Epic 40, branch `epic/40-integration-captain`, merging in parallel with you; read `git show epic/40-integration-captain:docs/epic-40-integration-captain.md`):** `starling run` is **real by default**: one private `opencode serve` on a free port, git worktrees under `worktreeRoot`, SQLite at `<repo>/.starling/starling.db`, the flock hub and the merge queue. It starts the dashboard server and prints its URL unless `--no-dash`, then prints a summary such as `✔ 5 merged · ✘ 0 failed · 0 conflicts / api $0.223 · local $0 / branch starling/3rcdzr/integration (7m 11s)`. Flags new in Epic 40 (all `⏳ Epic 40` until merged): `run --mock` (the old no-process demo stack), `run --budget <usd>` (overrides `budget.maxUsd`) and `status --repo <path>`. `plan --json` prints only `{ plan, issues }` on stdout. `starling dash` serves the repo's store read-only (`POST /api/runs` → 501, "use `starling run`"). The default LLM profile for real runs is `opencode` (`STARLING_LLM_PROFILE` overrides it; the library default stays `deepseek`). Recordings over 5 MB keep lifecycle events only. Real recordings: `fixtures/real/quick-wins.jsonl`, `fixtures/real/launch-day.jsonl`. Known limits: the auditor runs tests in the hub repo, opencode completions report `$0` for planner/auditor turns, a single machine only (perches come from Epic 42's `starling perch`), and no conflict-resolver wiring.
  - **Wave 3 CLI extensions** (built in `apps/cli/src/ext/*`, registered by C3/Epic 203, so mark them `⏳ C3`): `watch` (142), `gc` (143), `explain` (144), `completions` + `version --json` (145), `report` (146), `config` (147), `logs` (148), `try` (149).
  - **Verify against code, not memory.** The CLI surface is `createProgram()` in `apps/cli/src/program.ts`. Import it read-only (`import { createProgram } from '../../apps/cli/src/program.ts'`) and walk `program.commands` / `command.options` (`.long`, `.short`, `.negate`, `.required`, `.defaultValue`). It works from `docs/` today (verified). Core schemas: `../../packages/core/src/index.ts` (`StarlingEventTypeSchema.options`, `TaskStatusSchema.options`, `RunStatusSchema.options`, `defaultConfig`, `StarlingConfigSchema`). Never spawn the CLI binary, start servers or touch the network in a checker.
  - **Checker layout:** `docs/<area>/check.ts` (pure exported functions plus an `import.meta.main` CLI with `--check` (exit 1 on problems) and, where it generates content, `--write`), `docs/<area>/check.test.ts` beside it, and `docs/<area>/tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["*.ts"] }`. Generated blocks sit between `<!-- generated:<name>:start -->` / `<!-- generated:<name>:end -->` markers. Tests are offline, deterministic and finish in under 2 s.
  - **Root `bun run test` does not cover `docs/`** (its filters are `packages apps/server apps/cli skills integrations tools evals`; keep those words out of your file paths). Run `bun test docs/<area>` and `bunx tsc --noEmit -p docs/<area>` yourself. Biome **does** lint `docs/**/*.ts`, so `bun run check` must stay clean. C3 wiring for every docs epic: "add `bun test docs` and the `docs/*/tsconfig.json` typechecks to the CI docs job (Epic 150) / root scripts".
  - Mermaid fenced blocks are fine (GitHub renders them). Reuse images from `docs/assets/**` (Epic 172 owns that folder; link, don't copy).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`docs/demo/**`
plus `docs/epic-178-demo-script.md` and `.orchestrator/handbacks/178-demo-script.md`. Read anything.

## Goal
The live demo is where Starling wins or loses. Write the exact **3-minute and 5-minute scripts**, with timings, the words to say, the commands to type, and what appears on which laptop's screen. Add a backup plan for every failure (wifi down, API slow, laptop dies, auth expired), a judge Q&A that anticipates hard questions with honest, specific answers, and a checklist for T-24h / T-1h / T-10min. Great looks like this: someone who has never seen Starling could run the demo from these pages, and every command in them is verified to exist.

## Deliverables
1. **`docs/demo/README.md`:** which script to use when (3 minutes for the pitch slot, 5 minutes for the expo table), the setup diagram (Laptop A = hub MacBook Pro + projector, Laptop B = MacBook Air perch) and the page index.
2. **`three-minute.md`:** start from PRD §7 and update it to the real flow (Epic 40). A timing table (`| 0:00–0:20 | Hook | …`), then per beat:
   - the talk track (short sentences, ≤ 35 words per beat);
   - the exact command in its own block (e.g. `starling run "$(cat demo-goals/stage.md)" --repo $REPO --max-parallel 6 --record demo.jsonl`);
   - what the audience sees (Sky, lanes, the amber bird and the audit verdict, the merge queue, the cost meter);
   - what to click and on which laptop.
   Use the `stage` goal (6 tasks, one designed audit failure: `examples/sky-todo/.starling-answers/stage.expected.md`), and say why.
3. **`five-minute.md`:** the 3-minute flow plus a live perch join on Laptop B (`starling perch --hub … --code …`), killing the perch mid-run to show rescheduling, `starling status`, the Agent Skill `/swarm` in opencode, and "built by the flock" stats. Mark Wave 3 extras `⏳` (`?page=stage` presenter mode 127, `?page=report` 113, `starling watch` 142, `starling try` 149).
4. **`backup-plans.md`:** a failure matrix (symptom → detect → switch in ≤ 15 s → what to say). Cover:
   - venue wifi down or client isolation (phone hotspot, `--hub` with an IP, the Thunderbolt bridge);
   - API slow or rate-limited (`--max-parallel 3`, the smaller `quick-wins` goal, then replay);
   - total model outage (`starling replay fixtures/real/launch-day.jsonl` `⏳ Epic 40`, else `fixtures/runs/sky-todo-launch-day.jsonl`, plus the dashboard `?demo=1`);
   - opencode auth expired (`opencode auth login`, `starling doctor`);
   - port 7777 busy (`starling dash --port`, `lsof -i :7777`);
   - dashboard blank (build `apps/web`, then the dev server);
   - perch won't join (the `docs/flock/` troubleshooting, the `tools/flock` preflight `⏳ Epic 158`);
   - demo repo dirty from a rehearsal (`examples/scripts/reset-demo.sh` `⏳ Epic 171`, else rebuild with `make-demo-repo.sh`);
   - a laptop dies (single-laptop script);
   - the projector is 720p (browser zoom, `?page=stage` `⏳ Epic 127`).
5. **`judge-qa.md`: ≥ 25 questions** grouped (product, technical, open-weight, safety, process, Hacktoberfest). Each answer is ≤ 4 sentences, specific, honest about limits, with a pointer path. Examples:
   - "What stops two agents editing the same file?"
   - "What if the planner gets lanes wrong?"
   - "Is the auditor just the same model grading itself?"
   - "What does a run cost?"
   - "Is the flock secure?" (L18 + the SEC table)
   - "How much of this did a human write?"
   - "Why opencode?"
   - "What happens when a merge conflicts?"
   - "Does it work on Python?" (py-ledger)
   - "What broke when you wired it for real?" (Epic 40's list)
   No claims about competitors' internals.
6. **`checklist.md`:** T-24h (re-record a fresh real run, `bun run --cwd apps/web build`, charge, a second copy of recordings on a USB stick), T-1h (`starling doctor` on both laptops, `opencode auth` status, fresh `make-demo-repo.sh`, `init`, open dashboard tabs, notifications off, font size, hotspot ready), T-10min (wifi check, perch preflight, terminal history cleared, `REPO` env var exported), and after the demo (`reset-demo.sh`).
7. **Checker `docs/demo/check.ts`:**
   - every `starling …` invocation validates against `createProgram()` (a small local copy of the extraction logic is fine; don't import other docs epics' code);
   - every repo path (`examples/…`, `fixtures/…`, `apps/…`, `tools/…`) exists or is marked `⏳`;
   - the timing tables parse (`m:ss–m:ss` rows contiguous, starting at 0:00) and total ≤ 3:00 / ≤ 5:00;
   - every Q&A entry has a non-empty answer and an existing pointer.
   `--check` exits 1.
8. **Tests** `docs/demo/check.test.ts` (≥ 15): the timing parser (gaps, overlaps, over-time), invocation extraction (`$REPO`, `$(cat …)`, continuations), Q&A parsing, and the real docs pass.

## Explicitly out of scope
- Recording real runs (Epic 207, Wave 3b), editing `tools/flock/**` (Epic 158), the web stage page (127), and `examples/scripts` (171). Link with `⏳` markers instead.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test docs/demo` → 0 fail, ≥ 15 tests, and `bunx tsc --noEmit -p docs/demo` → clean.
3. `bun docs/demo/check.ts --check; echo exit=$?` → `exit=0`. Paste the timing totals for both scripts.
4. A dry rehearsal of the offline fallback path was actually run: `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 50` and `bun run starling status --file fixtures/runs/sky-todo-launch-day.jsonl`. Paste the output.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-178-demo-script.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/178-demo-script.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/178-demo-script`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
