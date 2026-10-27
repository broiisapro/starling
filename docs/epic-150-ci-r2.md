# Epic 150 — CI round 2: split jobs, e2e, site, Pages, nightly, PR size, links

## Goal

With roughly 100 PRs landing in a day, CI is the gate everyone hits. Round 2 makes it faster (the
packages and web test halves run in parallel), wider (tools/evals/site/scripts typechecked, the
landing site tested and deployed, the Playwright suite actually run), and more informative (PR size
labels, a docs link check, a nightly job that keeps the mock evals, the quick load suite and the
stats collector's JSON as an artifact). The checks other epics already depend on — file names, job
display names, Bun pinning, action majors, permissions — keep working.

## How it works

### `ci.yml` (still the README badge target, still the required-check owner)

| Job key | Display name | Runner | What it does |
|---|---|---|---|
| `check` | `lint + typecheck` | ubuntu-latest | `bun run check`, then `tsc --noEmit -p` for `tools/*/tsconfig.json`, `evals`, `site`, `.github/workflows/scripts`, and `apps/web/e2e` **if present**; then `bun test ./.github/workflows/scripts` |
| `test-packages` | `test packages` | ubuntu-latest | `bun run test:packages` |
| `test-web` | `test web` | ubuntu-latest | `bun run test:web` |
| `test` | `test (ubuntu-latest)` | ubuntu-latest | aggregator: `needs: [test-packages, test-web]`, `if: always()`, fails unless both succeeded |
| `test-macos` | `test (macos-latest)` | macos-latest | the three OS-sensitive packages, unchanged |
| `site` | `site` | ubuntu-latest | `bun run --cwd site typecheck`, `test`, `build` |
| `docs-links` | `docs links` | ubuntu-latest | `lycheeverse/lychee-action@v2` offline over README/CONTRIBUTING/docs/skills, `continue-on-error: true` |

Every job keeps `actions/checkout@v7`, `oven-sh/setup-bun@v2`, `actions/cache@v6`,
`actions/upload-artifact@v7`, `BUN_VERSION: "1.4.4"`, the `.bun-version`/`packageManager` guard,
`bun install --frozen-lockfile`, `permissions: contents: read` at the top level and a
`timeout-minutes`.

The aggregator is the trick that keeps `test (ubuntu-latest)` meaningful for branch protection while
the real work happens in two parallel jobs with different names. It is deliberately tiny (two
`echo`s and a shell comparison), so it costs seconds and cannot itself hide a failure: `if: always()`
means it runs even when a half is red, and it exits non-zero in that case.

### `pages.yml`

Push to `main` touching `site/**` (or the workflow itself) and `workflow_dispatch`. Build job:
install, `site` typecheck/test/build, `actions/configure-pages@v5`,
`actions/upload-pages-artifact@v3` from `site/dist`. Deploy job: `actions/deploy-pages@v4` in the
`github-pages` environment. Permissions are `contents: read`, `pages: write`, `id-token: write`;
concurrency group `pages` with `cancel-in-progress`.

### `e2e.yml`

`pull_request` with `paths: apps/web/**, fixtures/runs/**, .github/workflows/e2e.yml`, a nightly
cron, and `workflow_dispatch`. Runs on `macos-latest` because the committed visual baselines are
macOS-rendered. Installs Chromium with `bunx playwright install --with-deps chromium` (hoisted to the
root `node_modules/.bin`, verified locally), runs `bun run --cwd apps/web e2e` with
`STARLING_E2E_PORT=4777` and `TMPDIR=${{ runner.temp }}`, so the config's
`os.tmpdir()/starling-web-e2e/4777` is a known path. Traces/screenshots upload only when the suite
step failed (`steps.e2e.outcome == 'failure'`). The suite step has `continue-on-error: true` until
Epic 140 settles per-platform snapshot directories; the run summary says so.

### `nightly.yml`

Cron `23 6 * * *` (jittered off the hour), `workflow_dispatch`, and `pull_request` limited to this
workflow and its summary script — `workflow_dispatch` does not exist until the file is on `main`, so
this is how the PR that changes it proves it. `fetch-depth: 0` + `fetch-tags: true` because the stats
collector derives its timeline from `epic-NN-complete` tags. Runs `bun evals/run.ts planner|auditor
--impl mock`, `bun tools/load/index.ts --quick`, `bun tools/stats/collect.ts --no-gh --logs none
--out stats.json`, writes a Markdown table to the step summary via
`.github/workflows/scripts/nightly-summary.ts`, and uploads every JSON as `nightly-<UTC date>` with
14-day retention. No secrets, no `STARLING_LIVE`.

### `pr-size.yml` + `scripts/pr-size.ts`

`pull_request` (opened, synchronize, reopened), permissions `contents: read`, `issues: write`,
`pull-requests: write`, skipped for forks (`head.repo.full_name == github.repository`). The script
paginates `repos/{owner}/{repo}/pulls/{n}/files`, feeds the files to the pure `sizeLabel`, creates
the five labels with `gh label create --force`, then removes stale `size/*` labels and adds the new
one. Thresholds are changed **lines** (additions + deletions) across non-ignored files: ≤10 XS, ≤100
S, ≤500 M, ≤1000 L, else XL. Ignored: `bun.lock`, `fixtures/**`, `**/__snapshots__/**`,
`**/__screenshots__/**`, `*.jsonl`, `tools/*/results/**`, `tools/stats/out/**`.

### `scripts/workflows.test.ts` (static, run in `lint + typecheck`)

Parses every workflow with `Bun.YAML.parse` and asserts: jobs all have a numeric timeout; every
workflow's `BUN_VERSION` equals `.bun-version`; every `bun install` uses `--frozen-lockfile`; the
only `secrets.*` reference allowed is `GITHUB_TOKEN` (there are none — the size job uses
`github.token`); permissions are top-level only; the required display names exist; no workflow sets
`STARLING_LIVE`; every `uses:` is pinned to a major or a full SHA; the README badge still points at
`ci.yml`; the split/aggregator shape, the site job, the typecheck loop, the link job, and each new
workflow's triggers are as specified. `pr-size.test.ts` covers thresholds and boundaries (10/100/500/
1000), every ignore rule, TSV parsing of the `gh` output, and the label swap against a fake runner
(including "already correct", "two stale labels"). `nightly-summary.test.ts` covers the table, a
missing artifact, a failing eval, and reading real files from a temp directory.

## Key decisions & reasoning

- **Keep the required names, add an aggregator instead of renaming.** Renaming `test (ubuntu-latest)`
  to a split job would silently change the meaning of the branch-protection entry (and drop it from
  the list of checks GitHub requires). The aggregator keeps the name, keeps `if: always()`, and
  encodes the real invariant ("both halves succeeded") in one place.
- **`continue-on-error` on the e2e suite step, not the job.** Install failures (Chromium, deps) should
  still be red; only snapshot drift is advisory while the platform baseline story is open.
- **The docs link check is a separate job, not a step.** It is non-blocking today, so it must not
  add minutes to `lint + typecheck`. A job also gives it its own log and summary.
- **`tools/*/tsconfig.json` discovery instead of a hardcoded list.** It automatically covers the next
  tool directory and skips `tools/fully-open` (no tsconfig). `apps/web/e2e/tsconfig.json` is the only
  conditional entry: Epic 140 owns that file.
- **macOS job not widened (Epic 52's open question).** At 10× billed minutes across ~100 PRs, adding
  `apps/cli`, `apps/server` and `packages/flock` is not "cheap"; those packages are pure TypeScript
  with full Linux coverage. The code path for widening is one line, documented in the workflow.
- **Nightly runs on a PR only when the workflow itself changes.** A scheduled-only workflow is
  unprovable in the PR that introduces it (`workflow_dispatch` requires the file on the default
  branch); the narrow `paths` filter is the smallest trigger that proves it.
- **PR size is additions + deletions of counted files, not file count.** A 300-line type change and a
  300-file rename should not read as the same review effort; line churn is the metric humans quote.
- **Basename rules for slashless ignore patterns (`*.jsonl`, `bun.lock`).** Recordings and lockfiles
  appear at any depth; treating the pattern as root-only would let `examples/x/lock.jsonl` creep in.
- **Only `GITHUB_TOKEN`/`github.token`.** `gh label create` needs no personal token; the workflow is
  fork-safe because of the skip, not because of a privileged pull_request_target.

## Interfaces for future epics

- **Required checks (for the Orchestrator's branch protection):** `lint + typecheck`,
  `test (ubuntu-latest)`, `test (macos-latest)`, `build apps/web`. The `site` job is green today and
  is a good fifth required check once Epic 179's site work settles.
- **Filenames are API:** `ci.yml` (README badge, Epic 60) and `web-build.yml`. Do not rename.
- **Job display names are API:** `lint + typecheck`, `test (ubuntu-latest)`, `test (macos-latest)`,
  `build apps/web`.
- **`sizeLabel` / `changedLines` / `isIgnored`** are exported from
  `.github/workflows/scripts/pr-size.ts`; other tooling may import them. The ignore list is a single
  exported array.
- **Nightly artifacts:** `nightly-<YYYY-MM-DD>` contains `evals/results/nightly/{planner,auditor}.json`,
  `tools/load/results/*-quick.json`, `stats.json`. `nightly-summary.ts` reads the same paths and can
  be reused by any future reporting job.
- **Epic 68's stats collector** now runs nightly in CI without `gh`; the `site/data/stats.json` file
  in the landing site is still written outside CI (there is no push step here).
- **Epic 160's hygiene checker** can replace/extend the `docs-links` job; keep the job name and the
  offline defaults, or flip `continue-on-error` off in the same change.

## Deviations from plan

- **`bun test ./.github/workflows/scripts`, not `bun test .github/workflows/scripts`.** Bun's test
  discovery skips dot-directories when the argument has no `./` prefix (verified locally: "1277 files
  searched", no matches). The `./` form is what CI runs; the same 48 tests pass. Nothing else about
  the file layout changed.
- **`pages.yml` is Epic 59's YAML aligned to this repo**, not copied verbatim: `checkout@v7`,
  `setup-bun@v2` with `BUN_VERSION`, the Bun install cache, job names and `timeout-minutes` were
  added; `configure-pages@v5`, `upload-pages-artifact@v3` and `deploy-pages@v4` are as given.
- **A small `nightly-summary.ts`** (with tests) instead of inline shell parsing. It keeps the table
  deterministic and makes the "missing artifact" path explicit.
- **The PR-size script is TypeScript run by Bun** rather than a shell/`jq` pipeline, for the same
  testability reason; it imports `StarlingError` from core by relative path (the `@starling/core`
  workspace link does not exist outside the workspace, same as `tools/stats`).
- **`nightly.yml` adds `.github/workflows/scripts/nightly-summary.ts` to its PR paths** so a change
  to the renderer is also proven by the workflow.

## Known limitations / deferred

- **Visual baselines remain macOS-only**; the e2e suite is advisory until Epic 140 adds per-platform
  snapshot dirs (`FIX REQUEST`).
- **Branch protection is a repository setting**, not a file in this lane. Recommended required checks
  are listed above.
- **The docs link check is offline and advisory.** It catches broken relative links/fragments, not
  external URL rot; that needs a network-enabled run and a budget for flaky hosts.
- **PR size does not detect renames or generated code inside a non-ignored path.** The ignore list is
  the escape hatch; adding a pattern is a one-line change plus a test.
- **Nightly is not a performance budget.** The load JSON is kept, but no threshold fails the job;
  thresholds belong with Epic 70/72 once numbers are re-baselined on a quiet machine.
- **No release/publish workflow, CodeQL, Dependabot or PR/issue templates** — out of scope by the
  assignment (Epics 151/173 own parts of that).
- **`site/data/stats.json` is not regenerated in CI**; the nightly artifact has fresh stats, but
  writing them back needs a push (and an owner for that write).
