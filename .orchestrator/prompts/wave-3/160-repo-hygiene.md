# Epic 160: Repo hygiene checker

**Wave 3 · Branch `epic/160-repo-hygiene` · Issue: `gh issue list --search "Epic 160 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-160-repo-hygiene.md` and `.orchestrator/handbacks/160-repo-hygiene.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Your folder is outside the Bun workspace.** `tools/`, `evals/` and `integrations/` are not workspace members, so bare `@starling/*` and `zod` specifiers do not resolve there. Import other packages by relative path to their public entry (`../../packages/core/src/index.ts`, exactly like `tools/stress/harness.ts` and `evals/lib/core.ts`). Validate with core's exported zod schemas (`StarlingEventSchema`, `PlanSchema`, `RunSchema`, …) instead of importing `zod`. The root `typecheck` loop only covers `packages/* apps/*`, so give every new folder its own `tsconfig.json` (copy `tools/flock/tsconfig.json`, widen `include` if you add subfolders) and typecheck it yourself.
- **Root `bun run test` runs every `*.test.ts` under `tools`, `integrations` and `evals` in one process**, next to everyone else's. Your tests must be offline, deterministic and quick (budget given below), restore any env var they set, stop every server they start and delete every temp dir.
- **Read-only on the repo.** The checker never writes outside `--out`, never runs a git command that changes refs, the index or the worktree (`log`, `diff`, `ls-files`, `tag --list`, `for-each-ref`, `show` only), and never needs the network.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.

Also, specifically for this epic:
- Epic 68 FIX REQUEST 3 (`tools/` is outside the workspace and outside the root typecheck): implemented as a report-only check (deliverable 8). The config change itself stays with the integrator.
- Epic 56 FIX REQUEST 2 (stale statements in `docs/epic-11`/`epic-13`): out of lane to fix; `links`/`epics` findings should surface stale cross-references where they are mechanical.

## Your lane (you may write ONLY here)
`tools/hygiene/**`
plus `docs/epic-160-repo-hygiene.md` and `.orchestrator/handbacks/160-repo-hygiene.md`. Read anything.

## Goal
About 100 branches merge in Wave 3. The integrator needs one command that answers "did everyone follow the rules?": every finished epic has its doc and handback with the required sections, no merged branch wrote outside its lane, Markdown links still resolve after the docs epics move things, exports nobody uses are visible, and TODOs and oversized files are inventoried. It reports and never fails the build, so it's safe to run any time. Great looks like: `bun tools/hygiene/check.ts` takes under 20 s on the real repo and writes a Markdown report with counts per check and file:line findings, sorted by severity.

## Deliverables
1. **Framework** `tools/hygiene/types.ts` + `run.ts`: `export type CheckId = 'epics' | 'lanes' | 'links' | 'dead-exports' | 'todos' | 'size' | 'tsconfig'`; `export interface Finding { check: CheckId; severity: 'info' | 'warn' | 'error'; file?: string; line?: number; message: string; hint?: string }`; `export interface HygieneContext { root: string; git(argv: string[]): Promise<string>; listFiles(): Promise<string[]> /* git ls-files */; readFile(path: string): Promise<string> }`; `export interface HygieneCheck { id: CheckId; title: string; run(ctx: HygieneContext): Promise<Finding[]> }`; `runHygiene(ctx, { only?: CheckId[] }): Promise<HygieneReport>` (a crashing check becomes one `error` finding and the others still run).
2. **epics:** epic list from `.orchestrator/epics.tsv`, plus prompt files `.orchestrator/prompts/wave-*/NN-slug.md` (ignore `*.fixN.md`), plus `epic-NN-complete` tags and merged `epic/NN-slug` branches. For every finished epic: `docs/epic-NN-slug.md` exists with the six AGENTS.md §6 headings (Goal · How it works · Key decisions & reasoning · Interfaces for future epics · Deviations from plan · Known limitations / deferred; fuzzy, case-insensitive); `.orchestrator/handbacks/NN-slug.md` exists; for wave 3+, it has **Carryover done**, **C3 wiring** and **FIX REQUESTS** sections. Write your own small TSV parser (don't import `tools/stats`, Epic 154 is changing it).
3. **lanes:** for each merge of an `epic/NN-slug` branch (`git log --merges`, both "Merge branch 'epic/…'" and "Merge pull request #… from …/epic/…"), list changed files with `git diff --name-only <M>^1...<M>^2` and match them against the lane parsed from that epic's prompt (`## Your lane` section: backticked globs, brace expansion like `apps/cli/src/commands/{perch,flock}.ts`, "except …" clauses), always allowing the epic's own doc and handback. Use `matchesAny` from `packages/core/src/index.ts`. Unparseable lanes are an `info` finding, never a guess.
4. **links:** every tracked `*.md` (skip `node_modules`, `fixtures`, `examples/*/node_modules`): relative links and images resolve; `#anchors` match a heading in the target (GitHub slug rules); ignore code fences, inline code and absolute URLs.
5. **dead-exports:** names exported from each `packages/*/src/index.ts` (follow `export *` one level into local files) that no file outside that package mentions (word-boundary search over tracked `*.ts`/`*.tsx`). These are candidates, so `info`, and the message says so.
6. **todos:** `TODO|FIXME|HACK|XXX` inventory with file:line and text, grouped by top-level folder (`warn` only for FIXME/HACK).
7. **size:** source files over 600 lines (`warn`) and any tracked file over 1 MB (`error`, except an allowlist: lockfiles, `fixtures/**`, `*.jsonl`); thresholds configurable.
8. **tsconfig:** folders under `tools/`, `evals/`, `integrations/` that have a `tsconfig.json` the root `typecheck` loop doesn't cover (`info`, cites Epic 68's FIX REQUEST 3), and those with TS sources but no tsconfig (`warn`).
9. **Report + CLI** `tools/hygiene/check.ts [--only lanes,links] [--json] [--out tools/hygiene/out] [--strict] [--since <ref>]`: writes `report.md` (summary counts per check, then findings by severity, capped at 200 per check with "+N more") and `report.json`; prints the summary. Exit 0 unless `--strict` and there are `error`s. Add `tools/hygiene/out/.gitignore` (ignore everything except itself) so reports never get committed.
10. **Tests** on a synthetic temp git repo built in the test (two epics with prompts, docs and handbacks; one merge that writes outside its lane; a broken link and a broken anchor; TODOs; a big file), plus pure-parser tests: lane section parser (braces, excepts, multiple globs), link extractor (fences, inline code, URLs, titles), heading slugger, TSV parser. Never scan the real repo in a test. At least 35 tests; `bun test tools/hygiene` under 5 s.

## Explicitly out of scope
- Fixing anything the checker finds (FIX REQUESTS or the report itself), editing `.orchestrator/**` (only your handback), `tools/stats/**` (Epic 154), `tools/qa/docs/**` (Epic 195 checks docs against code; you check links and structure).
- Failing CI: wiring this into `.github/workflows` is Epic 150's call (describe it in C3 wiring).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/hygiene` → 0 fail, ≥ 35 tests, under 5 s.
3. `bunx tsc --noEmit -p tools/hygiene/tsconfig.json` and `bunx biome check tools/hygiene` clean.
4. `bun tools/hygiene/check.ts --out /tmp/hygiene` on the real repo under 20 s: paste the summary counts per check and the top 10 findings by severity into the handback.
5. `bun tools/hygiene/check.ts --only lanes --json` prints valid JSON (pipe through `bun -e 'JSON.parse(await Bun.stdin.text())'`).
6. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
7. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
8. `docs/epic-160-repo-hygiene.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/160-repo-hygiene.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/160-repo-hygiene`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
