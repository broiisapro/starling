#!/usr/bin/env bash
#
# End-to-end smoke test for the Docker demo image (Epic 153).
#
# Runs only where a Docker daemon is reachable; everywhere else it prints one line and exits 0, so it
# is safe to call from any machine or script. What it proves, in order:
#   1. the image builds from the repo root (the same command the README shows),
#   2. the container comes up on a random host port and answers /api/health within 60 s,
#   3. /api/runs lists the replayed run and / serves the built dashboard,
#   4. `docker stop` (SIGTERM) exits the demo cleanly with code 0,
#   5. the container and the image are gone afterwards, whatever happened.
#
# Usage: bash tools/docker/smoke.sh
set -euo pipefail

say() { printf '%s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  say "docker not installed, skipping"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  say "docker is installed but the daemon is not reachable, skipping"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

IMAGE="starling-demo-smoke:$$"
CONTAINER="starling-demo-smoke-$$"

cleanup() {
  docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
  docker rmi --force "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

say "building $IMAGE (this is the slow part)…"
docker build --tag "$IMAGE" .

say "starting the container on a random host port…"
docker run --detach --name "$CONTAINER" --publish 127.0.0.1::7777 "$IMAGE" >/dev/null

PORT="$(docker port "$CONTAINER" 7777/tcp | head -n 1 | sed 's/.*://')"
if [ -z "$PORT" ]; then
  say "could not determine the published port"
  docker logs "$CONTAINER" || true
  exit 1
fi
BASE="http://127.0.0.1:$PORT"
say "waiting for $BASE/api/health (up to 60 s)…"

HEALTH=""
for _ in $(seq 1 60); do
  if HEALTH="$(curl --fail --silent --show-error "$BASE/api/health" 2>/dev/null)"; then
    break
  fi
  HEALTH=""
  sleep 1
done

if [ -z "$HEALTH" ]; then
  say "health check never came up; container logs:"
  docker logs "$CONTAINER" || true
  exit 1
fi
say "health: $HEALTH"
case "$HEALTH" in
  *'"ok":true'*) ;;
  *)
    say "unexpected health payload"
    exit 1
    ;;
esac

RUNS="$(curl --fail --silent --show-error "$BASE/api/runs")"
case "$RUNS" in
  *'"id"'*) say "runs: $(printf '%s' "$RUNS" | head -c 120)…" ;;
  *)
    say "GET /api/runs did not list a run: $RUNS"
    exit 1
    ;;
esac

PAGE="$(curl --fail --silent --show-error "$BASE/")"
case "$PAGE" in
  *'id="root"'*) say "dashboard: index.html served with the app root" ;;
  *)
    say "GET / did not serve the dashboard HTML"
    exit 1
    ;;
esac

case "$(docker logs "$CONTAINER" 2>&1)" in
  *"Starling demo"*) say "startup line found in the container logs" ;;
  *)
    say "container logs do not show the demo startup line"
    docker logs "$CONTAINER" || true
    exit 1
    ;;
esac

say "stopping the container (SIGTERM)…"
docker stop "$CONTAINER" >/dev/null
EXIT_CODE="$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER")"
if [ "$EXIT_CODE" != "0" ]; then
  say "container exited $EXIT_CODE after SIGTERM (expected 0)"
  exit 1
fi

say "smoke passed: build, health, runs, dashboard, clean SIGTERM shutdown"
