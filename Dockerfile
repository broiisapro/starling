# syntax=docker/dockerfile:1
#
# Starling in a box: the murmuration dashboard, the golden recording on a loop, no engine.
#
#   docker build -t starling .
#   docker run --rm -p 7777:7777 starling      # http://localhost:7777
#
# Two stages, both on the Bun tag from `.bun-version`. `tools/docker/static.test.ts` fails if either
# FROM drifts from that file, if the install loses `--frozen-lockfile`, or if a COPY source is missing
# or hidden by `.dockerignore` — the checks that would otherwise need a Docker daemon on the build box.
# `oven/bun:1.4.4-slim` exists on Docker Hub (tag API: HTTP 200) and is ~85 MB compressed.

# ── build ───────────────────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.4 AS build
WORKDIR /app

# Manifests first. `bun install --frozen-lockfile` resolves `workspace:*` against every member's
# package.json, so all of them must be here even though the install only needs the lockfile: copying
# just the manifests keeps this layer warm while sources change. Keep this list in sync with the
# workspaces in the root package.json (static.test.ts enforces exactly that).
COPY package.json bun.lock ./
COPY packages/auditor/package.json packages/auditor/
COPY packages/core/package.json packages/core/
COPY packages/engine/package.json packages/engine/
COPY packages/flock/package.json packages/flock/
COPY packages/github/package.json packages/github/
COPY packages/llm/package.json packages/llm/
COPY packages/merger/package.json packages/merger/
COPY packages/perch/package.json packages/perch/
COPY packages/planner/package.json packages/planner/
COPY packages/prompts/package.json packages/prompts/
COPY packages/repomap/package.json packages/repomap/
COPY packages/runner/package.json packages/runner/
COPY packages/store/package.json packages/store/
COPY packages/workspace/package.json packages/workspace/
COPY apps/cli/package.json apps/cli/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# Sources, then the dashboard build: Vite 8 + Tailwind v4 → `apps/web/dist`.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun run --cwd apps/web build

# ── runtime ─────────────────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app

# `PORT` (the container convention) wins over `STARLING_PORT`; the demo reads both, and the
# healthcheck below resolves the same pair so `-e PORT=8080` keeps working.
ENV NODE_ENV=production \
    STARLING_PORT=7777 \
    STARLING_DEMO_SPEED=8 \
    STARLING_DEMO_FIXTURE=/app/fixtures/runs/sky-todo-launch-day.jsonl

# Only what the demo needs. `node_modules` comes from the build stage as installed: the workspace
# symlinks in `apps/server/node_modules` and `packages/core/node_modules` reach into `/app/node_modules/.bun`,
# so the three layers move together. (`bun prune --production` would shrink the image further; it is
# deferred until a machine with a Docker daemon can verify it — see docs/epic-153-devcontainer.md.)
COPY --chown=bun:bun --from=build /app/node_modules ./node_modules
COPY --chown=bun:bun --from=build /app/packages/core ./packages/core
COPY --chown=bun:bun --from=build /app/apps/server ./apps/server
COPY --chown=bun:bun --from=build /app/apps/web/dist ./apps/web/dist
COPY --chown=bun:bun fixtures/runs ./fixtures/runs
COPY --chown=bun:bun tools/docker ./tools/docker

# The oven/bun images already create the unprivileged `bun` user (uid/gid 1000). The demo writes
# nothing (MemoryStore), so there is no volume or chown dance; it only needs to read its files.
USER bun

EXPOSE 7777
STOPSIGNAL SIGTERM

# No curl in the slim image, and Bun is already here: one fetch, 0 or 1 as the exit code.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const p=process.env.PORT??process.env.STARLING_PORT??'7777';fetch('http://127.0.0.1:'+p+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["bun", "tools/docker/demo.ts"]
