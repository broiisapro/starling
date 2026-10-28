# `tools/docker` — Starling in a box

The whole dashboard — murmuration, task DAG, agent drawer, merge queue, metrics, flock panel — with
the golden launch-day recording replaying on a loop. **No engine, no agents, no API keys**: this is a
thirty-second look at what Starling does on a machine that has nothing but Docker.

```
docker build -t starling .
docker run --rm -p 7777:7777 starling
# open http://localhost:7777
```

The container serves the built dashboard (`apps/web/dist`) and the recorded run
`fixtures/runs/sky-todo-launch-day.jsonl` at 8× real time, looping with a four-second pause. Every
REST route and both SSE streams are the real Hono app; the store is a `MemoryStore`, so restarts are
free and nothing is written to disk.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `7777` | HTTP port **inside** the container. Wins over `STARLING_PORT`; the healthcheck follows it. |
| `STARLING_PORT` | `7777` | Fallback port, used by the rest of Starling. |
| `STARLING_DEMO_SPEED` | `8` | Replay multiplier. `2` is a slow, readable demo; `50` shows the whole run in seconds. |
| `STARLING_DEMO_FIXTURE` | `/app/fixtures/runs/sky-todo-launch-day.jsonl` | Any recorded JSONL event log. |

```sh
# a slower demo on another host port
docker run --rm -p 8080:8080 -e PORT=8080 -e STARLING_DEMO_SPEED=2 starling

# your own recording (mount it read-only; `POST /api/replay` only accepts paths under fixtures/)
docker run --rm -p 7777:7777 \
  -v "$PWD/fixtures/runs":/app/fixtures/runs:ro \
  -e STARLING_DEMO_FIXTURE=/app/fixtures/runs/quick-wins.jsonl \
  starling
```

`docker stop` (or Ctrl-C) stops the replay and the listener, and the container exits **0** — the
`HEALTHCHECK` and that clean shutdown are both part of `smoke.sh`.

## Devcontainer / Codespaces

`.devcontainer/` is the contributor path, not the demo path:

- base `oven/bun:1.4.4` (the tag from `.bun-version`) plus `git`, `gh`, `bash`, `jq`;
- `postCreateCommand: bun install --frozen-lockfile`;
- forwarded `7777` (dashboard) and `5173` (Vite), with labels;
- Biome + Bun VS Code extensions, format on save;
- `STARLING_LIVE` is explicitly empty, so the `*.live.test.ts` files stay skipped: no keys, no
  Ollama, no opencode in the box;
- on attach it prints the three commands worth knowing: `bun run test`, `bun run dev:web`,
  `starling try` (the last one lands with Epic 149 at C3).

Open the repo in VS Code → **Dev Containers: Reopen in Container**, or in Codespaces via
**Code → Codespaces → Create codespace**. The container runs as **root** on purpose: bind-mounted
workspaces carry the host uid on Linux/WSL, and a fixed non-root user makes `bun install` fail for
some contributors. The *image* in the repository root is the one that runs unprivileged.

## How the image is built

Two stages, both on the pinned Bun tag (`.bun-version`):

| Stage | Base | Work |
| --- | --- | --- |
| `build` | `oven/bun:1.4.4` | copy the workspace manifests → `bun install --frozen-lockfile` → copy sources → `bun run --cwd apps/web build` |
| `runtime` | `oven/bun:1.4.4-slim` | copy `node_modules`, `packages/core`, `apps/server`, `apps/web/dist`, `fixtures/runs`, `tools/docker`; `USER bun`; `EXPOSE 7777`; `HEALTHCHECK`; `ENTRYPOINT ["bun", "tools/docker/demo.ts"]` |

The manifest-first layer means a source-only change reuses the install layer. `node_modules` is
copied from the build stage *as installed* so the Bun workspace symlinks (`apps/server/node_modules` →
`packages/core`, `node_modules/.bun/*`) keep resolving. That is where most of the image size comes
from; see *Known limitations*.

## Security note

The demo intentionally binds `0.0.0.0` inside the container — a server on `127.0.0.1` inside a
container is unreachable from the host, which would make `-p 7777:7777` pointless. Publish it to the
host loopback or trust your LAN; **do not expose this port to the internet**.

There is no engine in the image, so there is nothing dangerous to reach:

- `POST /api/runs`, `/cancel` and `/abort` answer **501** (read-only `EngineApi`);
- no opencode, no Ollama, no GitHub token, no `DEEPSEEK_API_KEY`, no repo mounts unless you add one;
- the run is a replay from a fixture; the only writes are in-memory;
- `POST /api/replay` still uses the server's path allow-list (under `fixtures/`), mounted read-only
  above.

## Tests

```sh
bun test tools/docker        # 40 tests, no Docker, no network beyond 127.0.0.1:0
bash tools/docker/smoke.sh   # builds and runs the image where a Docker daemon exists
```

`static.test.ts` parses the Dockerfile into stages and asserts the things a build box without Docker
cannot: both `FROM` tags equal `.bun-version`, `--frozen-lockfile` is present, every workspace
manifest is copied before the install, every `COPY` source exists and is **not** excluded by
`.dockerignore` (matched with `matchesGlob` from `@starling/core`), the runtime runs as `bun`, exposes
7777, answers `/api/health`, and never installs anything. `devcontainer.test.ts` checks
`devcontainer.json` (JSONC, ports, labels, extensions, live-test posture, the welcome text) and
`bash -n` on `smoke.sh`; the parsing and matching helpers live in `static-support.ts`.

`demo.test.ts` runs the same server the image runs: health, `/api/runs`, an SSE backlog frame,
`index.html`/assets with the SPA fallback, the 501 on `POST /api/runs`, and an idempotent stop.

## Known limitations / deferred

- **Image size.** `node_modules` as installed is ~320 MB, so the image is a few hundred MB. A
  `bun prune --production` (or a manifests-only production install) in the build stage would shrink
  it; the change is deferred until a machine with a Docker daemon can verify the workspace symlinks
  still resolve. See `docs/epic-153-devcontainer.md`.
- **No engine.** Deliberate: a demo image should not be able to start agents. Real runs are
  `starling run` on a laptop (Wave 3b/Epic 40).
- **One recorded run.** `fixtures/runs/sky-todo-launch-day.jsonl` is the golden demo; mount your own
  to show something else.
- **No registry publish and no CI job.** Epic 150 can add
  `docker build -t starling . && bash tools/docker/smoke.sh` as a job once a runner has Docker.
- **AMD64/ARM64** both build from the same Dockerfile; only ARM64 was exercised through the static
  checks here, because the build laptop has no running daemon.
