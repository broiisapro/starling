## Epic 153 Handback — Devcontainer and Docker demo image

**Status:** Complete. Branch `epic/153-devcontainer` @ `1c5c3a9` (docs and this handback land on top). One documented deviation: `smoke.sh` skips on an unreachable daemon as well as a missing binary — see below.

**Delivered:**
- `Dockerfile` — two stages, `oven/bun:1.4.4` → `oven/bun:1.4.4-slim` (both equal `.bun-version`), manifest-first `bun install --frozen-lockfile`, `bun run --cwd apps/web build`, runtime copies only `node_modules` + `packages/core` + `apps/server` + `apps/web/dist` + `fixtures/runs` + `tools/docker`, `USER bun`, `EXPOSE 7777`, `STOPSIGNAL SIGTERM`, `HEALTHCHECK` via `bun -e` against `/api/health` (honours `PORT`/`STARLING_PORT`), `ENTRYPOINT ["bun", "tools/docker/demo.ts"]`.
- `tools/docker/demo.ts` — `startDockerDemo(options)` and `demoOptionsFromEnv(env)`: replays the launch-day fixture on a loop at `STARLING_DEMO_SPEED` (default 8) into a `MemoryStore` + `createEventBus()`, serves the built dashboard via `webDist`, binds `0.0.0.0`, port `PORT` → `STARLING_PORT` → 7777, and stops replay + listener on `SIGTERM`/`SIGINT` with exit 0. Exports `createDemoEngine` (copied read-only `EngineApi`, 501s on start/cancel/abort) and the default constants.
- `.dockerignore` — `.git`, `.orchestrator`, `**/node_modules`, `**/dist`, `.starling`, `**/*.db*`, `**/*.log`, `.env*`/`**/.env*`, `Claude outputs`, `tools/*/results`, `tools/release/dist`, `site/dist`, `apps/web/e2e/__screenshots__`; nothing the Dockerfile copies is excluded.
- `.devcontainer/Dockerfile` + `.devcontainer/devcontainer.json` — `oven/bun:1.4.4` + apt `git gh bash jq less curl ca-certificates`, `postCreateCommand: bun install --frozen-lockfile`, `forwardPorts [7777, 5173]` with `portsAttributes` labels (Starling dashboard / Vite dev server), Biome + Bun extensions, format on save, `STARLING_LIVE: ""`, three-line `postAttachCommand` (`bun run test`, `bun run dev:web`, `starling try`), `remoteUser: root` (justified in the doc).
- `tools/docker/smoke.sh` — daemon-aware skip, build, `docker run --publish 127.0.0.1::7777`, `docker port`, 60 s health poll, `/api/runs` + `/` + startup-log assertions, `docker stop` exit-code-0 check, `trap cleanup EXIT` for container and image removal.
- `tools/docker/static.test.ts` (19 tests), `devcontainer.test.ts` (11) and `demo.test.ts` (10), with
  the parsing/matching harness in `static-support.ts` — 40 hermetic tests, no Docker and no network
  beyond `127.0.0.1:0`.
- `tools/docker/tsconfig.json`, `tools/docker/README.md`, `docs/epic-153-devcontainer.md`.

**Key design decisions:**
- **Devcontainer on `oven/bun:1.4.4`, not `devcontainers/base` + a Bun installer.** The tag is the pin, so the box and `.bun-version` cannot disagree; no second install script to maintain. Verified the base creates the `bun` user (uid/gid 1000), defaults to root and is Debian trixie (gh is in apt).
- **Devcontainer as root, image as `bun`.** Bind-mounted workspaces carry the host uid on Linux/WSL, so a fixed non-root devcontainer user breaks `bun install` for some contributors; the demo image is unprivileged because the base already provides the user and the process writes nothing.
- **Copy `node_modules` as installed** (per the brief) so the Bun workspace symlink web resolves without an image-time install. The size tradeoff is documented; `bun prune --production` is deferred until a daemon can verify it, because a broken link would fail only at container start.
- **Static drift tests instead of a build.** The Dockerfile is parsed into stages/instructions; every build-context `COPY` source is walked and matched against `.dockerignore` with core's `matchesGlob` (directories pruned, ancestors counted). The manifest list is compared to the real `packages/*`/`apps/*` directories, so a new workspace without a Dockerfile line fails the suite.
- **`0.0.0.0` and the `PORT`-aware healthcheck are image concerns**, not server defaults, so they survive Epic 110 flipping `startServer`'s default to loopback and `-e PORT=8080`.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 172 installs across 225 packages (no changes) [13.00ms]`; `git status` clean apart from new docs, `bun.lock` untouched.
- `bun test tools/docker`: `40 pass, 0 fail, 997 expect() calls, Ran 40 tests across 3 files. [623.00ms]`
- `bunx tsc --noEmit -p tools/docker`: exit 0, no output.
- `bash -n tools/docker/smoke.sh`: exit 0.
- `cd apps/web && bun run build` (through `heavy.sh`): `✓ built in 483ms`, `dist/assets/index-BjsOblSz.js 878.16 kB`.
- `PORT=0 bun tools/docker/demo.ts` (real run, real `apps/web/dist`):
  ```
  Starling demo v0.0.0 listening on http://0.0.0.0:51669 🐦
  health: {"ok":true,"version":"0.0.0"}
  index has root div: 1
  asset status: 200 text/javascript; charset=utf-8
  exit after SIGTERM: 0
  ```
  (`/api/runs` also returned the replayed run `01jd2k7m3p4q5r6s7t8v9w0x1y`.)
- `bash tools/docker/smoke.sh`:
  ```
  docker is installed but the daemon is not reachable, skipping
  exit=0
  ```
  **This is the skip path** — Docker 29.6.1 is installed but Docker Desktop is not running, so the image was not built here. The build itself is covered by the static tests plus the real `apps/web` build above.
- `bash .orchestrator/bin/heavy.sh bun run test` (root): packages half `1978 pass, 4 skip, 0 fail, 29 snapshots, 9608 expect() calls, Ran 1982 tests across 225 files. [61.55s]`; web half `581 pass, 0 fail, 4164 expect() calls, Ran 581 tests across 60 files. [5.82s]`.
- `bash .orchestrator/bin/heavy.sh bun run check`: `Checked 981 files in 345ms. No fixes applied.` and the per-workspace `tsc --noEmit` loop exited 0.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. No core contract, port, event or config change was needed; the demo composes the existing server entry and a local copy of the read-only `EngineApi`.

**Carryover done:** reviewed `.orchestrator/fix-requests-w2.md` end to end (all 720 lines). **No request targets `.devcontainer/**`, `Dockerfile`, `.dockerignore` or `tools/docker/**`**, so there was nothing to implement and nothing to decline. Adjacent, deliberately left with their owners: SEC-01 (server `hostname` default) is `apps/server`; this image sets `0.0.0.0` explicitly so it is unaffected either way, and its security note says so. The `tools/*` typecheck gap is filed below.

**C3 wiring:** none. Every file is self-contained: the Dockerfile, `.dockerignore` and `.devcontainer/` are read by Docker/VS Code, `tools/docker/**` is run by the root `bun test` glob (`tools`) without any registration, and no shared `index.ts`, `app.ts`, `program.ts`, `App.tsx` or `Layout.tsx` was touched. Nothing needs adding to a shared file for this PR to take effect.

**FIX REQUESTS:**
1. **Root `package.json` — typecheck `tools/*` (owner: integrator / Epic 40 root config).** `"typecheck": "for d in packages/* apps/*; do tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done"` silently skips every tool harness, including `tools/docker` (this PR) and `tools/security` / `tools/load` (Wave 2). Suggested:
   ```json
   "typecheck": "for d in packages/* apps/* tools/*; do [ -f \"$d/tsconfig.json\" ] || continue; tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done"
   ```
   Why: `tools/docker` is typechecked in this handback by hand (`bunx tsc --noEmit -p tools/docker`, clean); without the loop a future edit can rot it while `bun run check` stays green. The `[ -f ]` guard keeps `tools/` directories without a tsconfig (e.g. `tools/local-models`) harmless.
2. **`apps/server` — export the demo composition (owner: apps/server, Epic 110 follow-up).** `apps/server/src/dev.ts` defines `createDemoEngine` and `runDemoServer` but `src/index.ts` re-exports neither, so this lane copies 10 lines into `tools/docker/demo.ts`. Suggested additive change: `export * from './dev';` in `apps/server/src/index.ts`, or a `runDemoServer` option `{ webDist?: string; hostname?: string }` so the Docker demo and `bun run dev` share one implementation. Also worth doing in the same pass: Epic 110's switch of `startServer`'s default `hostname` to loopback must keep an explicit override (the demo passes `0.0.0.0` and will be fine).

**Deliberately deferred / out of scope:**
- Real agents, opencode, Ollama or GitHub inside the image; image publishing; docker-compose for flocks (all excluded by the brief).
- A CI job that builds the image (Epic 150 may add one; the suggested step is `docker build -t starling . && bash tools/docker/smoke.sh` on a runner with Docker).
- `bun prune --production` / a manifests-only production install to shrink the image (documented in the doc and the Dockerfile).
- Actually opening the devcontainer in VS Code/Codespaces; its configuration is asserted statically. Bind-mount ownership and Docker Desktop version are the host-dependent risks.
- A `linux/amd64` build and multi-arch manifest; both base tags publish amd64 and arm64, but nothing here could run a build.
- Editing `apps/server`, including exporting `createDemoEngine` (FIX REQUEST 2).

**Open questions / flagged tradeoffs:**
- **Image size is the one number this lane could not measure.** `node_modules` as installed is ~320 MB and the slim base ~85 MB, so expect a few hundred MB. If a demo-night download matters, the prune is a one-line build change, but it needs a daemon to prove the workspace symlinks survive; shipping an unverified prune felt worse than a big image.
- **The devcontainer's `STARLING_LIVE` is explicitly `""`, not absent.** The devcontainer schema cannot unset a variable, and an explicit empty value both overrides a stray container env and keeps `=== '1'` false. Flagging in case the orchestrator wanted a truly absent key.
- **`postAttachCommand` tells contributors to run `starling try` before Epic 149 lands** (the brief asked for that line). It will be true at C3; until then it exits with commander's unknown-command error.
- **The smoke script treats "daemon down" as a skip.** On a machine where Docker is expected to be running, that is a silent pass; the distinct message is the mitigation. A `STARLING_REQUIRE_DOCKER=1` strict mode would be the next step if CI starts calling it.
- **`docker run -p 127.0.0.1::7777` assumes a Docker that supports ephemeral host ports** (it has since 1.5, but some alternative runtimes are pickier); the fallback is a fixed port in the script if that ever bites.
