# Epic 183: Flock guide: laptops as a cluster, join codes, security model, networking, runbook

**Wave 3 · Branch `epic/183-flock-guide` · Issue: `gh issue list --search "Epic 183 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-183-flock-guide.md` and `.orchestrator/handbacks/183-flock-guide.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
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

Also, specifically for this epic:
- No FIX REQUEST targets `docs/flock/**`. The SEC-01…SEC-11 findings (`.orchestrator/fix-requests-w2.md` §69) are being fixed in code by Epics 101/102/103/104/110. **Document their current status and today's mitigations** (deliverable 4) and keep the `⏳` markers accurate.

## Your lane (you may write ONLY here)
`docs/flock/**`
plus `docs/epic-183-flock-guide.md` and `.orchestrator/handbacks/183-flock-guide.md`. Read anything.

## Goal
Flock mode is the "wow" of the demo: a second laptop opens its lid, runs one command, and birds migrate to its roost. This guide makes it reliable for anyone: quickstart, how join codes and `x-flock-token` work, an honest security model (LAN-only, shared secret, the SEC findings and their mitigations), networking on hostile venue wifi, troubleshooting, and the two-laptop demo runbook. Great looks like this: the defaults and commands are machine-checked against the code, and the security page tells users exactly what's protected and what isn't today.

## Deliverables
1. **`docs/flock/README.md`:** what a hub, perch, roost and bundle are (one diagram: link `docs/assets/diagrams/flock-topology.svg`), what runs where (audit and merge only on the hub: L20), and the page index.
2. **`quickstart.md`:**
   - **Laptop A (hub):** `starling run …` with `flock.enabled` (default true), then `starling flock` / `starling flock --json` for the join command and code.
   - **Laptop B (perch):** clone + `bun install` + opencode login, then `starling perch --hub http://<ip>:7777 --code <CODE> --name "M2 Air" --max-sessions 5`.
   Say what you should see (the second roost, `node.joined`, tasks migrating). Base it on `docs/epic-42-flock-e2e.md` (it has the two-laptop runbook and six checks) and the real perch daemon in `packages/perch/src/perch-daemon.ts`. Where the real `run` composition (Epic 40) still lacks something on a remote node (e.g. `setHubUrl` with a LAN URL), say so with `⏳`.
3. **`join-codes.md`:**
   - how the code is generated and verified (read `packages/perch/src/join-code.ts`, `packages/flock/src` and the `FlockHub.verifyToken` usage in `apps/server/src/routes/flock.ts`);
   - where it travels (`x-flock-token` on every hub ↔ perch call, `/api/flock/join` → `{ code, hubUrl, command }`, the dashboard QR);
   - rotation (restart the hub);
   - why mDNS TXT currently carries the code (SEC-07; the `--mdns-code` opt-in is `⏳ Epic 102`).
4. **`security.md`:** the threat model (L18: LAN, shared secret, no TLS; perches execute agent sessions with shell access; the hub runs repo test commands, per SEC-11). Then "safe defaults for demo day" (a trusted network or phone hotspot, a fresh code per event, firewall prompts, stopping perches after the demo). Then a **SEC table**: id, finding (one line), status (SEC-04 fixed by Epic 41; SEC-01/05/06/09 `⏳ Epic 110`; SEC-02/03 `⏳ Epic 101`; SEC-05/07/10 `⏳ Epic 102`; SEC-08/11 `⏳ Epic 103`/`104`), today's mitigation, and the probe file in `tools/security/` (e.g. `node-impersonation.test.ts`, `bundle-ref.test.ts`, `unauth-routes.test.ts`). Link `SECURITY.md` (Epic 173).
5. **`networking.md`:**
   - ports (hub/server 7777 = `server.port`, perch 7778 = `perch.port`);
   - mDNS `_starling._tcp` and when multicast is blocked (client isolation);
   - finding your IP (`ipconfig getifaddr en0`, `ip -4 addr`);
   - reachability checks (`curl http://<hub>:7777/api/health`, `curl -H "x-flock-token: <CODE>" http://<perch>:7778/perch/info`);
   - macOS firewall prompts;
   - a phone hotspot or a Thunderbolt bridge as the fallback;
   - bandwidth (bundle sizes).
6. **`troubleshooting.md`:** Epic 42's six checks, expanded with: offline after 15 s (`flock.offlineAfterMs`), heartbeats (`flock.heartbeatMs` 3000), auth failures (`NODE_AUTH`), bundle errors, a perch that has no opencode login, clock skew, and two perches on one laptop (ports). Link `docs/troubleshooting/` (181).
7. **`runbook.md`:** the two-laptop demo runbook. T-1h checks on both laptops, the join, the kill-the-perch reschedule moment, and teardown. Rehearse on one laptop with `bun tools/flock/loopback.ts` (exists today), and use the preflight checker plus the printable 1-page runbook `⏳ Epic 158` (`tools/flock/`). Link `docs/demo/` (178).
8. **Checker `docs/flock/check.ts`:**
   - `defaultsTable()`: generated from `defaultConfig.flock` and `defaultConfig.perch` + `server.port` (`--write` between markers);
   - command validation of `starling flock|perch|run …` flags via `createProgram()`;
   - `checkRoutes(md)`: every `/api/flock/...`, `/api/nodes` and `/perch/...` path exists in a route scan of `apps/server/src` and `packages/perch/src`;
   - `checkSecTable(md)`: SEC-01…SEC-11 all present, each probe file exists in `tools/security/`, and each status is `fixed` or `⏳ Epic NN`.
   `--check` exits 1.
9. **Tests** `docs/flock/check.test.ts` (≥ 14): the defaults table, an unknown flag, an unknown route, a missing SEC row, a missing probe file, and the real docs pass.

## Explicitly out of scope
- `packages/flock/**`, `packages/perch/**`, `apps/server/**` (Epics 101, 102, 110 are fixing the SEC findings in parallel), `tools/flock/**` (Epic 158), `tools/security/**` (read-only).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test docs/flock` → 0 fail, ≥ 14 tests, and `bunx tsc --noEmit -p docs/flock` → clean.
3. `bun docs/flock/check.ts --write && bun docs/flock/check.ts --check; echo exit=$?` → `exit=0`. Paste the defaults table.
4. `bun run starling perch --help` and `bun run starling flock --help` were run and their flags match the guide (paste).
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-183-flock-guide.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/183-flock-guide.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/183-flock-guide`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
