# Epic 153 — Devcontainer and Docker demo image

## Goal

Two ways into Starling without installing anything locally:

- **`.devcontainer/`** — a Hacktoberfest contributor opens the repo in VS Code or GitHub Codespaces
  and gets Bun 1.4.4, git, `gh`, and a passing test suite after `bun install --frozen-lockfile`.
- **`Dockerfile` + `tools/docker/`** — `docker run -p 7777:7777 starling` serves the built dashboard
  with the recorded launch-day run replaying on a loop, on any machine with a Docker daemon.

Neither path may install a model, talk to a provider, or start an agent. The image is a shop window;
the devcontainer is a workshop.

## How it works

### The image (`Dockerfile`, `.dockerignore`)

Two stages, both pinned to the Bun tag in `.bun-version` (1.4.4):

| Stage | Base | Steps |
| --- | --- | --- |
| `build` | `oven/bun:1.4.4` | copy `package.json`, `bun.lock` and **every** workspace `package.json` → `bun install --frozen-lockfile` → copy `tsconfig.base.json`, `packages/`, `apps/` → `bun run --cwd apps/web build` |
| `runtime` | `oven/bun:1.4.4-slim` | copy `node_modules`, `packages/core`, `apps/server`, `apps/web/dist`, `fixtures/runs`, `tools/docker` → `USER bun` → `EXPOSE 7777` → `HEALTHCHECK` → `ENTRYPOINT ["bun", "tools/docker/demo.ts"]` |

The manifest-first install is what makes a source-only change cheap: Bun resolves `workspace:*`
against every member manifest, and the lockfile pins everything else, so the install layer only
invalidates when a dependency changes.

`node_modules` is copied from the build stage **as installed** because the Bun workspace layout is a
web of relative symlinks: `apps/server/node_modules/@starling/core → ../../../../packages/core`,
`apps/server/node_modules/hono → ../../../node_modules/.bun/hono@4.13.14/node_modules/hono`, and so
on. Copying the three trees together (`node_modules`, `packages/core`, `apps/server`) keeps those
links resolving without an image-time install. The cost is size; see *Known limitations*.

`.dockerignore` excludes version control, orchestrator state, installed/generated trees, databases,
logs, env files and benchmark/release artifacts. The devcontainer's `.devcontainer/` and the demo's
`tools/docker/` are deliberately **not** excluded.

### The demo server (`tools/docker/demo.ts`)

`startDockerDemo(options)` is a thin, container-shaped wrapper around the server's own replay
composition:

1. `loadReplayFile(fixture)` validates every line against `StarlingEventSchema`.
2. `startReplay({ store: new MemoryStore(), bus: createEventBus(), speed, loop: true })` publishes the
   recording at 8× real time, with a four-second pause between loops (re-timed, payload timestamps
   untouched).
3. `startServer({ ...deps, webDist }, { port, hostname: '0.0.0.0' })` serves REST + SSE + the built
   dashboard. `webDist` is `apps/web/dist`; `POST /api/runs` answers 501 via a copied read-only
   `EngineApi` (the 10-line `createDemoEngine`, which `apps/server/src/dev.ts` does not re-export).
4. `stop()` stops the replay and the listener. The CLI entry point wires `SIGTERM`/`SIGINT` to it and
   exits 0, which is what makes `docker stop` clean.

Port resolution is `PORT` → `STARLING_PORT` → 7777; speed is `STARLING_DEMO_SPEED` → 8; fixture is
`STARLING_DEMO_FIXTURE` → the launch-day recording. Invalid numbers fall back to the default instead of
crash-looping a container.

### Verification without a daemon

The build laptops have no running Docker daemon, so the image is guarded by static tests that would
catch the boring-but-fatal drift:

- `tools/docker/static.test.ts` parses the Dockerfile into stages and instructions and asserts both
  `FROM` tags equal `.bun-version`, `--frozen-lockfile`, the full manifest list before the install,
  sources only after it, the dashboard build command, the exact runtime copy surface, `USER bun`,
  `EXPOSE 7777`, the healthcheck, the entrypoint, and `ENV` defaults. It walks every build-context
  `COPY` source, checks it exists, and matches every file against `.dockerignore` using
  `matchesGlob` from `@starling/core` (Docker-style: ancestors count, ignored directories are pruned).
  `devcontainer.test.ts` parses `devcontainer.json` as JSONC and checks the image tag, tool installs,
  ports, labels, extensions, live-test posture and welcome text, and runs
  `bash -n tools/docker/smoke.sh`. The parsing/matching helpers are shared in `static-support.ts`.
- `tools/docker/smoke.sh` is the live check: build, run on a random host port, poll `/api/health` for
  up to 60 s, assert `/api/runs` lists the run, assert `/` contains the app root, `docker stop`, assert
  exit code 0, and always remove the container and image (`trap cleanup EXIT`). Without a daemon it
  prints one line and exits 0.

### The devcontainer

`oven/bun:1.4.4` + apt `git`, `gh`, `bash`, `jq`, `less`, `curl`, `ca-certificates`; the lockfile
install on create; ports 7777 (dashboard) and 5173 (Vite) with labels; Biome + Bun extensions; format
on save; `STARLING_LIVE` explicitly empty so the live suites stay skipped; a three-command welcome on
attach.

## Key decisions & reasoning

- **`oven/bun:1.4.4` for the devcontainer, not `devcontainers/base` + a Bun installer script.** The
  tag *is* the pin: the devcontainer, the image and `.bun-version` cannot disagree, and there is no
  second URL/checksum/PATH setup to maintain. `oven/bun` is Debian, so apt has `git` and `gh`.
  Verified against the registry: the image's default user is root, it creates `bun` (uid/gid 1000) and
  `1.4.4-slim` exists on Docker Hub (tag API HTTP 200, ~85 MB compressed, Debian trixie).
- **The devcontainer runs as root; the image runs as `bun`.** Bind-mounted workspaces arrive with the
  host uid on Linux/WSL; a fixed non-root devcontainer user makes `bun install` fail for some
  contributors, and there is no privileged tooling to protect inside a dev sandbox. The demo image is
  the opposite: a fixed, unprivileged `bun` user is cheap because the base image already creates it
  and the demo writes nothing.
- **`HEALTHCHECK` uses `bun -e` instead of `curl`.** The slim image has no HTTP client, and Bun is the
  runtime already present. It resolves `PORT`/`STARLING_PORT` the same way the demo does, so
  `-e PORT=8080` does not silently break health.
- **`0.0.0.0` is set explicitly.** A container's loopback is not the host's; this is a property of the
  image, not a server default, so it keeps working when Epic 110 flips `startServer`'s default to
  loopback.
- **The static matcher reuses core's `matchesGlob`.** One glob dialect for lanes, the auditor and now
  `.dockerignore`, with directory semantics already tested in `packages/core/src/glob.test.ts`. The
  matcher deliberately does not implement `!` re-includes (the file uses none, and a test enforces
  that) rather than pretending to model Docker's last-match-wins in 30 lines.
- **`STARLING_LIVE: ""` in `remoteEnv`, not an absent key.** An explicitly empty value overrides any
  stray container env and is falsy, so `process.env.STARLING_LIVE === '1'` stays false. Truly unsetting
  is not expressible in the devcontainer schema.
- **`smoke.sh` checks the daemon, not just the CLI.** `docker` exists on machines where Docker Desktop
  is not running (including this one); checking only `command -v docker` would turn a skip into a red
  build. Both skip messages are distinct, so the reader knows which one they hit.
- **Manifest-first install with an explicit per-package list.** `COPY packages ./packages` would work
  but invalidates the install layer on every source edit. The list is 17 lines and a test compares it
  to the actual `packages/*`/`apps/*` directories, so adding a workspace without updating the
  Dockerfile fails the suite.

## Interfaces for future epics

- `tools/docker/demo.ts` exports `startDockerDemo(options): Promise<DockerDemo>`,
  `demoOptionsFromEnv(env)`, `createDemoEngine(store)` and the default constants
  (`DEFAULT_DEMO_SPEED`, `DEFAULT_FIXTURE_PATH`, `DEFAULT_WEB_DIST`, `DEFAULT_HOSTNAME`,
  `DEFAULT_PORT`). Epic 149's `starling try` can reuse the composition if it wants the same
  "replay + built dashboard" server, or keep its own; nothing here is wired into the CLI.
- Environment contract for the image: `PORT` > `STARLING_PORT` > 7777, `STARLING_DEMO_SPEED` > 8,
  `STARLING_DEMO_FIXTURE` > the launch-day recording. Documented in `tools/docker/README.md`.
- The runtime copy surface is exactly `node_modules`, `packages/core`, `apps/server`, `apps/web/dist`,
  `fixtures/runs`, `tools/docker`; `static.test.ts` pins it. Adding a runtime dependency of the demo
  means touching that list and the test intentionally fails first.
- `tools/docker/*.ts` are typechecked by `bunx tsc --noEmit -p tools/docker`; the root `typecheck`
  script only loops over `packages/*` and `apps/*` (see FIX REQUESTS in the handback).
- CI: `.github/workflows/ci.yml` needs no change for the static tests (root `bun run test` already
  runs `tools`). A future job that has Docker can literally run `bash tools/docker/smoke.sh`.

## Deviations from plan

- **`smoke.sh` skips when the daemon is unreachable**, not only when the binary is missing.
  `docker` exists on this laptop but the daemon does not; the skip line says which case. This is the
  only way to satisfy "only runs where Docker exists" without failing on a stopped Docker Desktop.
- **The healthcheck resolves `PORT`/`STARLING_PORT`** instead of hardcoding 7777. Same command and
  semantics as specified, one env lookup wider.
- **`.dockerignore` uses `**/*.db*` and `**/.env*`** (in addition to root-level coverage), because
  Docker's pattern matching is not gitignore's: a bare `*.db*` only covers the context root. Both
  forms are asserted by the tests for nested and root paths.
- **`createDemoEngine` is copied** (with a comment) from `apps/server/src/dev.ts`, which does not
  export it from the package entry. A FIX REQUEST asks the server owner to export it; editing
  `apps/server` is out of scope.
- **`postAttachCommand` mentions `starling try`** as the brief asks, although the command arrives with
  Epic 149 / C3; the welcome line says so.
- **No image was built here.** The Docker CLI is installed but no daemon is running (this is the build
  laptop described in the brief), so `smoke.sh` was verified in its skip path; everything else is
  covered by the 40 hermetic tests, a real local run of `demo.ts`, and the root suite.

## Known limitations / deferred

- **Image size.** `node_modules` as installed is ~320 MB, so the runtime image is a few hundred MB on
  top of the ~85 MB slim base. `bun prune --production` (or a manifests-only production install in the
  runtime stage) would cut most of it, but it cannot be verified without a daemon and a broken
  workspace symlink would only show up at container start. Deferred deliberately, with the comment in
  the Dockerfile.
- **No engine, by design.** `POST /api/runs` is 501; the image cannot start agents. Real runs are
  `starling run` (Epic 40 / Wave 3b).
- **One fixture.** The image ships the launch-day recording; other recordings are a read-only mount.
- **No registry publish, no CI image job** (Epic 150 may add one; the suggested step is
  `docker build -t starling . && bash tools/docker/smoke.sh` on a runner with Docker).
- **No `linux/amd64` build was exercised** (no daemon). The Dockerfile has no architecture-specific
  instruction, and both base tags publish `amd64` and `arm64` manifests.
- **The devcontainer was not opened in VS Code/Codespaces here.** Its JSONC, image pin, tool installs,
  ports and post-create command are asserted statically; the remaining risk is host-specific
  (bind-mount ownership, Docker Desktop version), which is what `remoteUser: root` is there to absorb.
- **No devcontainer feature for opencode/ollama.** Deliberate: the box is for unit tests and the
  dashboard, not live model runs (L23/L29).
