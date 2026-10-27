# Epic 52 — CI: GitHub Actions

## Goal

Put the same gate the integrator runs locally in front of every PR: Biome, a strict typecheck of every
workspace, both halves of the test suite, and a macOS pass over the packages whose behaviour depends on
git worktrees and OS probing. Build `apps/web` as a separate artifact so a broken Vite/Tailwind build is
caught before merge.

Fast and green were both requirements: Linux is the blocking gate, macOS is a second opinion on the
three OS-sensitive packages, and neither job repeats work the other does.

## How it works

### `.github/workflows/ci.yml` — `CI`

Triggers on every `pull_request`, on `push` to `main`, and on `workflow_dispatch` (retry a flaky red run
without an empty commit). `concurrency` groups by workflow + ref with `cancel-in-progress: true`, so a
new push supersedes the previous run on the same PR. `permissions: contents: read` keeps the token
least-privileged.

| Job | Runner | What it runs |
|---|---|---|
| `lint + typecheck` | `ubuntu-latest` | `bun run check` → `biome check .` + per-workspace `tsc --noEmit -p` |
| `test (ubuntu-latest)` | `ubuntu-latest` | `bun run test` → packages/server/CLI/skills/integrations/tools/evals, then `apps/web` in its own process |
| `test (macos-latest)` | `macos-latest` | `bun test packages/workspace packages/merger packages/perch` |

Every job: `actions/checkout@v7`, `oven-sh/setup-bun@v2` pinned to **Bun 1.4.4**, a cache of
`~/.bun/install/cache` keyed on `bun.lock`, `bun install --frozen-lockfile`, then the job's command.
Each job has a 15–20 minute timeout.

### `.github/workflows/web-build.yml` — `Web build`

Same triggers and setup, then `bun run build` in `apps/web` (Vite 8 + Tailwind v4) and
`actions/upload-artifact@v7` of `apps/web/dist` as artifact `web-dist` with `if-no-files-found: error`
and seven-day retention.

### Why no test guards were needed

The brief called out tests that assume macOS (`scutil`, `vm_stat`). An audit of the tree found none
that shell out to those commands in a test:

- `packages/perch/src/perch-info.ts` probes `scutil` only when `platform === 'darwin'`, and
  `probeOs({ platform })` lets the tests exercise both the macOS and Linux branches on any host.
- `tools/local-models/probes.ts` exposes `hostProbes(run)` with an injectable `ShellFn`; its tests feed
  canned `sysctl` / `memory_pressure` output. `vm_stat` lives only in `host.ts`, which is used by the
  benchmark CLI (`smoke.ts`, `bench.ts`), not by tests.
- Everything else that shells out runs `git`, `sh`, `bash`, `cat`, `pwd` or `sleep`, all available on
  the Ubuntu runner. Git helpers create `main` explicitly (`git init -b main`) and set a repo-local
  identity, so the runner's default branch and missing global git config do not matter.

The first Linux run passed all 1,359 package/app tests and all 426 web tests unchanged, and the macOS
job passed its 174, which is the empirical confirmation of that audit. No file outside this lane was
touched. If a future test starts calling `scutil`/`vm_stat` directly, the one-line guard is:

```ts
test.skipIf(process.platform !== 'darwin')('reads ComputerName', async () => { ... });
```

### README-ready badge snippet

Put these under the `# Starling 🐦` heading (Epic 60 owns `README.md`; this snippet is the handoff):

```markdown
[![CI](https://github.com/broiisapro/starling/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/broiisapro/starling/actions/workflows/ci.yml)
[![Web build](https://github.com/broiisapro/starling/actions/workflows/web-build.yml/badge.svg?branch=main)](https://github.com/broiisapro/starling/actions/workflows/web-build.yml)
```

## Key decisions & reasoning

- **Check and tests are separate jobs, not sequential steps.** They run concurrently on separate
  runners, so the wall clock is `max(check, test)` instead of their sum. The extra install is cheap
  once the cache is warm and is the price of that parallelism.
- **Linux is the only required gate; macOS is scoped.** The full suite already runs on Linux, and
  TypeScript typechecking is platform-independent, so the macOS job runs only the three packages whose
  tests create worktrees, merge refs or probe the host OS. That keeps the expensive macOS runner to
  ~20 s of tests.
- **Cache `~/.bun/install/cache`, keyed on `bun.lock`.** Bun's global package cache is the expensive
  part. Keying on the lockfile means a dependency bump misses once and restores on every PR until the
  next bump. `restore-keys` gives a partial warm cache on a miss.
- **`--frozen-lockfile`.** CI must never silently rewrite `bun.lock`; a lockfile that disagrees with a
  `package.json` should fail the PR so the integrator resolves it deliberately (AGENTS.md §2).
- **`workflow_dispatch` on both workflows.** A flaky test or a transient runner failure should not
  require an empty commit to retry.
- **`cancel-in-progress` keyed on `github.ref`.** For PRs that is `refs/pull/N/merge`, so pushes to
  different PRs never cancel each other; two pushes to one PR cancel the stale run.
- **No `paths:` filters.** The test suite exercises packages through workspace imports, so a change
  anywhere can break a test anywhere. A path filter would trade correctness for a few seconds.
- **No live tests.** `*.live.test.ts` already self-skips unless `STARLING_LIVE=1`; CI never sets it, so
  no model, opencode server or GitHub call happens in CI (L23/L29).
- **Current action majors (`checkout@v7`, `cache@v6`, `upload-artifact@v7`).** The v4 line targets
  deprecated Node 20 and GitHub emits a warning on every run; the current majors run on Node 24 and
  keep the same inputs we use.
- **Bun version is an env var (`BUN_VERSION`) in each workflow.** Both files pin 1.4.4 exactly; the
  variable exists so the two occurrences cannot drift within a file. The `check` job also asserts that
  `.bun-version` and `package.json#packageManager` agree with it, so an edit to one pin cannot silently
  leave CI testing a different Bun than the one developers install (L21).

## Interfaces for future epics

- **Workflow handles**: `CI` (`.github/workflows/ci.yml`) and `Web build`
  (`.github/workflows/web-build.yml`) are the stable names for badges and branch protection.
- **Job names** for required checks: `lint + typecheck`, `test (ubuntu-latest)`, `test (macos-latest)`
  and `build apps/web`.
- **Artifact**: `web-dist` contains the production `apps/web/dist` (seven days). Epic 60/61 can consume
  it for deploy demos without rebuilding, or replace this job with a deploy step.
- **Adding a workspace** needs no workflow change: `bun run check`'s `for d in packages/* apps/*`
  loop and the root test script already pick it up, as long as the new package has a `tsconfig.json`
  and the root test script includes its path (root `package.json` is an Epic 00 file).
- **Release automation (Wave 3)** can reuse the setup block (`checkout` → `setup-bun` → cache →
  `--frozen-lockfile`) and gate publishing on both workflows via `workflow_run` or a `needs:` graph.

## Deviations from plan

- The brief asked for `bun run check` and `bun run test`; they are split into two jobs for concurrency
  rather than one sequential job. Same commands, same scripts.
- Added `workflow_dispatch` and a small `Toolchain` step (`bun --version`, `git --version`) that is not
  in the brief. Both are for triage: the retry path and knowing which git a red run used (the workspace
  requires ≥ 2.38).
- The macOS job runs only tests, not `bun run check`, because typechecking is OS-independent and the
  Ubuntu `check` job already covers every workspace.
- No test guards were needed (see above); the brief expected at least one `scutil`/`vm_stat` guard.

## Known limitations / deferred

- **Branch protection is not configured here.** The workflows exist, but making `lint + typecheck` and
  the two test jobs required checks is a repository-settings change (`gh api`), not a file change in
  this lane. The Orchestrator/integrator should enable it on `main`.
- **No coverage reporting or dependency scanning.** Coverage needs a baseline before it is meaningful;
  Dependabot/CodeQL are a separate decision. Both are Wave 3 polish.
- **The macOS job is three packages by design.** `apps/cli`, `apps/server`, `packages/flock` and the
  rest are tested on Linux only. If a macOS-only regression appears there, widen the list deliberately.
- **First run has a cold cache.** `actions/cache` saves only after a successful job, so the first CI
  run installs from the network (~30–60 s). Later runs restore.
- **No matrix over Bun versions.** L21 pins one toolchain; testing a range would contradict the lock.
- **Cancelled runs still occupy a runner briefly.** `cancel-in-progress` stops work, it does not
  un-bill the started minutes.
