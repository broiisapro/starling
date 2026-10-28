# Starling: handoff after Hacktoberfest Queen's 2026 (we won 🏆)

**Date:** 2026-10-27, evening · **Repo:** `github.com/broiisapro/starling` (private) · local `~/Code/hacktoberfest-q-26` on the MacBook Pro · worktrees in `~/Code/starling-wt/`
**Goal of the next chat:** turn Starling from "won the hackathon" into a working, polished, real product. Two laptops really working on one goal, then a v0.1.0 release.

---

## 1. What Starling is (one paragraph)
An open-weight swarm-of-coding-agents harness:
- One goal → repo map → a lane-safe task DAG (planner).
- A flock of opencode agents, each in its own git worktree, on this laptop and on other laptops ("perches", joined with a code).
- Each result is audited (tests, lane check, LLM verdict), then merged through a serial merge queue.
- Everything shows live in a "murmuration" dashboard (birds = agents, roosts = laptops).

Stack:
- Bun 1.4.4 workspaces (`packages/*`, `apps/*`), TS 5.9.3, zod 4, Biome 2.6.3.
- React 19 + Vite + Tailwind v4 + zustand + xyflow.
- Hono server on port 7777; perch on port 7778; bun:sqlite.
- opencode 2.1.2 (`opencode run`/`serve`), with real model calls through the `opencode` LLM profile.

Docs:
- `.orchestrator/PRD.md` and `ARCHITECTURE.md` (§6 contracts, §7 locked decisions L1–L31; Wave 3 adds L32–L39 in the prompt headers).
- `ROADMAP.md`, `epics.tsv`, `fix-requests-w2.md`.
- `docs/epic-*.md` (every package's design) and `.orchestrator/handbacks/*.md`.

## 2. State of `main` right now
- **Merged and tagged:**
  - Wave 0 (00–02), Wave 1 (10–32), C1 (33, 34).
  - All of Wave 2 except 46/50/54: 40–45, 47–49, 51–53, 55–61, 68–71 (tags `epic-NN-complete`).
  - About 2,550 tests green at the last full run (1,974 packages + 581 web).
- **Epic 40 (integration captain) made it real.** `starling run "<goal>" --repo <repo>` composes the real stack (opencode runner, planner, auditor, merger, flock hub, dashboard on :7777).
  - Real runs recorded in `fixtures/real/{quick-wins,launch-day}.jsonl`: quick-wins 5/5, launch-day 6/6 merged.
  - `--mock` keeps the fake stack.
- **Demo-day commits on main (not epics):**
  - `b493778 fix(cli)`: `starling run` now gives perches a LAN-reachable hub URL (`STARLING_HUB_URL` or the detected LAN IPv4 + port) instead of `localhost`. **Untested end-to-end.**
  - Four `style(web): …` commits by a Claude Code session: night-sky tokens, star field, glass panels, glowing birds, top-bar counters, glass queue, amber join card.
- **Uncommitted on the MBP** (commit first thing):
  - `apps/server/src/dev.ts` now serves `apps/web/dist`, so the demo hub works from other laptops.
  - `.orchestrator/prompts/demo/ui-glowup.md`.

  To commit them: `git add -A apps/server .orchestrator && git commit -m "demo: serve dashboard from demo hub" && git push`

## 3. What the winning demo actually was (be honest with ourselves)
- The hackathon demo was the **demo hub** (`STARLING_DEMO_SPEED=3 bun apps/server/src/dev.ts`) replaying `fixtures/runs/sky-todo-launch-day.jsonl`. That file is a **scripted two-laptop fixture** (MacBook Pro + MacBook Air roosts, a migration).
- Both laptops opened `http://<pro-ip>:7777` and watched the same synced stream.
- **Never done for real:** a live run where a second laptop actually executes tasks. Perch join, bundle fetch and remote execution were only tested in loopback (Epic 42) and with fakes.
- **Real single-laptop runs work** (Epic 40). The last one under heavy load went 2/3 because of a planner definition-of-done defect.

## 4. Hard lessons from the 100-agent wave
- **Quota is the real ceiling.** 100 parallel DeepSeek V4.1 Flash agents exhausted the first OpenCode Go subscription in about 25–30 minutes (`503 "Go usage limit exceeded"`).
  - A **second OpenCode subscription** is now logged into the opencode CLI (100% left at the time).
  - Starling and the dev agents use whatever account the CLI is logged into.
- **CPU and RAM:** 100 `opencode run --standalone` servers plus test suites pinned the M5 Pro (load ~60, sluggish).
- **Recommendation: ≤ 25–30 concurrent dev agents.** Always run full suites through `bash .orchestrator/bin/heavy.sh …` (10-slot gate).
- **Epic 40's agent nearly killed the Wave 3 agents' opencode servers**, thinking they were orphans. Future prompts should say: never kill processes you didn't start.
- **Wi-Fi drops** cause `ECONNRESET` errors; agents survived. Auto-retry has 10 attempts with linear backoff capped at 300 s (`spawn-wave.sh`).

## 5. Wave 3 status (100 epics, stopped mid-flight at 18:20 on 2026-10-27)
- Prompts are in `.orchestrator/prompts/wave-3/` (100–199). **Wave 3b** is in `prompts/wave-3b/` (200–207 + 46/50/54, to launch after 3a).
- Every agent ran for about 20–30 minutes and was then stopped. Worktrees are intact in `~/Code/starling-wt/NNN-slug`. Many have uncommitted work ("d" = dirty files).
- **Finished, with a handback (18) — audit and merge these first:**
  - 102 perch-hardening, 103 auditor-r2, 107 planner-r2, 109 prompts-r2
  - 113 web-report, 115 web-lanes, 118 web-settings, 119 web-tour, 120 web-palette, 121 web-toasts, 122 web-compare, 124 web-scrubber, 126 web-leaderboard
  - 150 ci-r2, 151 packaging, 152 installer, 153 devcontainer, 167 shell-prompt
  - Check which actually opened PRs: `gh pr list --search "head:epic/1"`.
- **Partway, with commits but no handback (about 25):** 105, 111, 114, 116, 117, 123, 127, 128, 132, 143, 145, 149, 163, 168, 171, 173, 174, 179, 182, and others.
- **Barely started or dirty-only (about 55):** the rest, including most QA (184–199) and docs (175–183).
- **Conflict risks:**
  - The demo-day web glow-up commits touched `apps/web/src/index.css`, `app/*`, `components/*` and feature styling, so they will conflict with 112 (web-shell-r2) and 130–137 (feature round 2s).
  - Have those agents rebase and keep the new visual language.
- **GitHub issues for 100–207 were never created.** `gh-bootstrap` failed silently during spawn. Run `bash .orchestrator/bin/gh-bootstrap.sh 2>&1 | tee ~/Code/starling-wt/_logs/commands/gh-bootstrap.log` to see why.
- Resume command: `spawn-wave.sh 3 --continue --only <list>` (or `--range A-B`). It reuses worktrees and tells each agent to continue.
- Asana project gid `1219939468988405` has tasks for 100–207 + C3.

## 6. Known gaps / bugs to fix for "real"
1. **Two-laptop live run.**
   - Verify the `b493778` LAN hub URL fix.
   - Perch on the Air needs its own opencode login, plus repo deps for tests in a bundle-fetched worktree.
   - Scheduler picks the node with most free slots (hub has 8), so set `flock.hubMaxSessions` low (e.g. 2) to force migration.
   - Config is loaded from the **cwd**, not `--repo`.
2. **Auditor runs tests in the hub repo, not the task worktree** (`TaskRun.worktreePath` never set; engine FIX REQUEST). A worktree without dependencies fails its own suite.
3. **Planner definition-of-done defect** caused a 2/3 run (see Epic 40 handback).
4. **Usage/cost metering** is unknown/zero on the opencode profile (contract request: `LLMResponse.usageSource?`).
5. `starling replay` is terminal-only.
   - The browser replay is `starling dash` + `?demo=1`, or the demo hub.
   - Consider making `starling replay --dash` serve the dashboard.
6. `make-demo-repo.sh` takes one argument (`[target-dir]`). Older prompts say otherwise.
7. Fresh clones need `bun install` at the root before `apps/web` builds (vite missing otherwise).
8. **Security findings SEC-01…11** (`fix-requests-w2.md`, `tools/security`). Several are fixed in Wave 3 epics that haven't merged yet (101, 102, 103, 110).
9. The CLI `ext/*` modules, new web feature manifests and the server insights routes need **C3 wiring** after merge (each handback has a "C3 wiring" section).

## 7. Suggested plan for the next chat
1. **Stabilise** (30 min): commit the uncommitted demo files; run the full suite on main; fix anything the UI glow-up broke (`cd apps/web && bun test`).
2. **Harvest Wave 3:**
   - Audit and merge the 18 finished epics. Use the tar-and-stage trial-merge audit (from the container), then `close-epic.sh`.
   - Resume the ~25 partial ones in **batches of ≤ 25** with `--continue`.
   - Re-decide whether the ~55 barely-started epics are worth it. QA and docs are cheap; trim the fluff (leaderboard, shell prompt …) if quota is tight.
3. **Wave 3b** (core/llm/runner/cli/web-data owners + 46 golden demo, 50 skill e2e, 54 dogfood, 207 real-run matrix).
4. **C3 checkpoint:** wire features, CLI extensions and insights routes; flip fixed `test.todo`s; re-record e2e baselines.
5. **Real two-laptop field test:** one batched 25–30 check sheet (Moksh's preference), Pro hub + Air perch, real `launch-day` run.
6. **Product:** release v0.1.0 (CHANGELOG, binaries from 151, installer 152), README/site, good-first-issues. Then decide on selling/positioning.

## 8. Working style that worked
- **Orchestrator method:** I write epic prompts into files; agents run headless (`opencode run`) in git worktrees via `.orchestrator/bin/spawn-wave.sh`; `watch-wave.sh` keeps a scoreboard (`_logs/scoreboard-w<wave>.txt`); `close-epic.sh [--rebase] NN…` merges and tags.
- **Command logs:** command output mirrors to `~/Code/starling-wt/_logs/commands/`, so Moksh never has to copy-paste output.
- **What Moksh wants:**
  - plain step-by-step instructions saying which laptop does what
  - tests batched (20–30 checks per session)
  - no local models during build waves
  - massive parallelism, but now capped by quota
- **Device bridge quirks:**
  - The Claude VM can read and write the repo, but **can't run bun or gh** and can't see Mac processes.
  - Git in the VM can't delete its own `.lock` files (move them aside).
  - `device_commit_files` occasionally writes stale content, so verify with md5.
  - Audit by tarring the repo to `_audit/` and staging it to the container (Bun is installed there at `~/.bun/bin/bun`).
- **Prompt generators:** saved in the repo at `.orchestrator/gen/`:
  - `w3_common.py`: header with L32–L39 and the web/CLI/QA conventions.
  - `w3_list.py`: master list.
  - `specs_*.py`, `BRIEF.md`: the sub-agent brief used to write grounded specs in parallel.
  - The Wave 1/2 generators.

## 9. Opening message for the new chat
> Read the project doc `starling/HANDOFF.md` (and `starling/ORCHESTRATOR-STATE.md`). We won the hackathon; now let's make Starling real. Start with §7 step 1 (stabilise main), then audit and merge the 18 finished Wave 3 epics. Use the second OpenCode subscription and keep dev agents ≤ 25 at a time.
