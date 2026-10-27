# Epic 153: Devcontainer and Docker demo image

**Wave 3 · Branch `epic/153-devcontainer` · Issue: `gh issue list --search "Epic 153 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–90 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-153-devcontainer.md` and `.orchestrator/handbacks/153-devcontainer.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.


## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`.devcontainer/**`, `Dockerfile`, `.dockerignore`, `tools/docker/**`
plus `docs/epic-153-devcontainer.md` and `.orchestrator/handbacks/153-devcontainer.md`. Read anything.

## Goal
Two ways in without installing anything locally: a **devcontainer** so a Hacktoberfest contributor opens the repo in VS Code or Codespaces and has Bun 1.4.4, git and the test suite ready, and a **Docker image** that serves the dashboard with the golden recording replaying on a loop, so `docker run -p 7777:7777 starling` shows the murmuration on any machine. Docker isn't installed on the build laptops, so everything is verified by static checks and a smoke script that only runs where Docker exists. Great looks like: small image, non-root user, healthcheck, pinned versions that match the repo, and static tests that would catch drift.

## Deliverables
1. `Dockerfile` (multi-stage): `FROM oven/bun:1.4.4 AS build` (the tag must equal `.bun-version`), `WORKDIR /app`, copy the manifests first (`package.json`, `bun.lock`, every `packages/*/package.json` and `apps/*/package.json` — check how `bun install --frozen-lockfile` needs workspace manifests) for a cacheable `bun install --frozen-lockfile`, then the sources, then `bun run --cwd apps/web build`. Runtime stage `FROM oven/bun:1.4.4-slim` (verify the tag exists on Docker Hub with `curl -s https://hub.docker.com/v2/repositories/oven/bun/tags/1.4.4-slim`; fall back to the full image and say so), copies only what the demo server needs (`apps/server`, `packages/core`, `apps/web/dist`, `fixtures/runs`, `tools/docker`, `node_modules` as installed), runs as a non-root user, `EXPOSE 7777`, `HEALTHCHECK` using `bun -e "fetch('http://127.0.0.1:7777/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` (no curl in the image), `ENTRYPOINT ["bun", "tools/docker/demo.ts"]`.
2. `tools/docker/demo.ts`: starts the dashboard the same way `apps/server/src/dev.ts` does (import `startServer`, `loadReplayFile`, `startReplay`, `VERSION` from `apps/server/src/index.ts` by relative path; copy the 10-line read-only demo engine since `createDemoEngine` isn't exported) **plus** `webDist` pointing at `apps/web/dist`, `hostname: '0.0.0.0'` (required inside a container: set explicitly, Epic 110 is changing the default to loopback), port from `PORT`/`STARLING_PORT` (default 7777), fixture from `STARLING_DEMO_FIXTURE`, speed from `STARLING_DEMO_SPEED` (default 8), looping. Graceful `SIGTERM` (Docker stop) → stop replay and server, exit 0. Export `startDockerDemo(options)` for tests.
3. `.dockerignore`: excludes `.git`, `**/node_modules`, `**/dist`, `.starling`, `*.db*`, `.orchestrator`, `Claude outputs`, `tools/*/results`, `tools/release/dist`, `site/dist`, `apps/web/e2e/__screenshots__`, `*.log`, `.env*`; must **not** exclude anything the Dockerfile copies (tested).
4. `.devcontainer/devcontainer.json` (+ `.devcontainer/Dockerfile` if needed): based on `oven/bun:1.4.4` (or `mcr.microsoft.com/devcontainers/base:bookworm` + Bun 1.4.4 installed by a pinned script: choose one and justify), with `git`, `gh` and `bash`; `postCreateCommand: "bun install --frozen-lockfile"`, `forwardPorts: [7777, 5173]` with labels (dashboard, Vite), recommended extensions (`biomejs.biome`, `oven.bun-vscode`), and `remoteEnv` that leaves `STARLING_LIVE` unset. A `postAttachCommand` that prints a 3-line welcome ("bun run test", "bun run dev:web", "starling try").
5. `tools/docker/smoke.sh` (bash, only runs when `docker` exists, else prints "docker not installed, skipping" and exits 0): builds the image, runs it on a random host port, polls `/api/health` (≤ 60 s), checks `/api/runs` lists a run and `/` serves HTML containing the app root, then stops and removes the container and image.
6. `tools/docker/static.test.ts` (≥ 20 tests, no Docker needed): parse the Dockerfile into instructions and assert the `FROM` tags equal `.bun-version`, a non-root `USER`, `EXPOSE 7777`, a `HEALTHCHECK`, `--frozen-lockfile`, every `COPY` source exists in the repo and is **not** excluded by `.dockerignore` (write a small `.dockerignore` matcher using core's `matchesGlob` imported from `packages/core/src/index.ts` by relative path); `devcontainer.json` parses (strip `//` comments) and has the fields above; `smoke.sh` passes `bash -n`.
7. `tools/docker/demo.test.ts` (≥ 5 tests): `startDockerDemo({ port: 0, hostname: '127.0.0.1' })` serves `/api/health`, lists the replayed run, streams an SSE frame, and serves `index.html` from a temp fake `webDist`; stop is clean.
8. `tools/docker/README.md`: build/run commands (`docker build -t starling .`, `docker run --rm -p 7777:7777 starling`), env vars, devcontainer/Codespaces usage, and the security note that the image binds `0.0.0.0` on purpose and has no engine (no agents, no keys).

## Explicitly out of scope
- Running real agents in Docker, opencode or Ollama in the image, publishing images to a registry, docker-compose for flocks.
- CI jobs that build the image (Epic 150 may add one later: suggest the step in your handback).
- Editing `apps/server` (copy what you need; FIX REQUEST to Epic 110 if an export would help).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/docker` → 0 fail, ≥ 25 tests; `bunx tsc --noEmit -p tools/docker` clean (add a `tsconfig.json` like `tools/load`'s).
3. `bun tools/docker/demo.ts` with `PORT=0` locally: paste the startup line and `curl -s localhost:<port>/api/health`.
4. `bash tools/docker/smoke.sh` → either the full smoke output (if Docker is installed) or the skip line. Paste it, and say in the handback which one you saw.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-153-devcontainer.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/153-devcontainer.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/153-devcontainer`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
