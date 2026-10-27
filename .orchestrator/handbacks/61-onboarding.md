## Epic 61 Handback — Onboarding: init, doctor, first-run magic
**Status:** Complete. Branch `epic/61-onboarding` @ 20dc40c (10 commits).

**Delivered:**
- `starling doctor` runs 13 checks, each with a ✔/✘/! and a pasteable `fix:` line: `bun`, `git` (≥ 2.38), `opencode`, **`opencode server`** (real start/stop of a private `opencode serve` on a free loopback port + authenticated `GET /api/info`), `deepseek` (**every** DeepSeek V4.1 Flash id across providers, `(+N more)` beyond two), `deepseek key` (optional → warn), `gh` (optional → warn), `config`, `ollama` (+ recommended local models from `tools/local-models/results/recommendation.json` when present), `ram` (macOS-aware), `disk`, `network` (LAN IPv4 + `server.port`/`perch.port` free), `ulimit`.
- `starling doctor --json` prints exactly one JSON object on stdout (`ok`, `host`, `counts`, `suggestedMaxParallel`, `checks[]` with `hint`s). Exit 1 when a required check fails.
- `apps/cli/src/doctor-probes.ts` (new): pure parsers (`parseFlashModelIds`, `parseLanAddress`, `parseDfAvailableGb`, `parseOpenFiles`, `parseVmStatAvailableGb`, `parseRecommendation`, `parseOllamaModelNames`, `hasOllamaModel`, `profileForRam`) plus overridable probes (`defaultDoctorSpawn`, `freeLoopbackPort`, `defaultPortFree`, `measureAvailableMemGb`). No imports from `doctor.ts`.
- `suggestMaxParallel` + `AGENT_MEMORY_GB`/`MAX_SUGGESTED_PARALLEL`/`PARALLELISM_RULE` exported and documented: `min(floor(availableGb/2), cores-1, 8)`, floor 1.
- `starling init` is interactive on a TTY (three questions: profile / maxParallel / flock, each with the detected default) and `--yes` for defaults; non-TTY stdin behaves like `--yes`. Also `--dry-run`, `--force`, `--profile`, `--max-parallel`, `--no-flock`.
- **Carryover (Epic 40):** `init` now defaults to the **`opencode` LLM profile** — `provider: opencode`, `model: <providerID>/<modelID>` from `opencode models` (any provider prefix), all six roles — then `deepseek` if `DEEPSEEK_API_KEY` is set, else `local`. Verified against `@starling/llm`: every role resolves through the opencode client and splits to `{providerID:'opencode-go', modelID:'deepseek-v4.1-flash'}`, and `applyProfile(config,'opencode').models` is byte-identical to the generated `models:` block.
- Generated `starling.config.yaml`: comments on **every** field, `Model profile:` block, `Hardware:` block (cores / available RAM / resulting agents), `maxParallel` **and** `flock.hubMaxSessions` from the same suggestion, full flock + perch settings. Refuses to overwrite without `--force`; prints the four next steps (`doctor`, `plan`, `run`, `dash`).
- Tests: 46 doctor/probe tests + 24 init tests (every check branch, both sides of every hint, profile detection order, the three prompts, nonsense answers, dry-run, force guard, YAML round-trips through `loadConfig` for 3 profiles × 2 flock settings) with injected exec/spawn/fetch/fs/port/memory fakes. No network, no real `opencode`, no real `ollama` in unit tests.

**Key design decisions:**
- **`--standalone` is deliberately not passed** to the probe: on the installed opencode 2.1.2 `serve` already *is* a private standalone server and `--standalone` is a root flag the subcommand rejects (`docs/epic-15-runner.md`, captured CLI output). The deliverable's intent — a real start/stop with no prompts — is met; the deviation is documented in the epic doc.
- **macOS RAM via `vm_stat` (free+inactive+speculative), not `os.freemem()`.** `freemem()` reported 0.1 GB on a healthy 32 GB Mac and made the first real doctor suggest `maxParallel: 1`. Shared `measureAvailableMemGb` keeps `doctor` and `init` printing the same number (~7–9 GB here).
- **Optional tools warn, required ones fail.** `gh`, `DEEPSEEK_API_KEY`, Ollama and a missing local benchmark are warnings (`starling run` works without them); bun/git/opencode/`opencode server`/a Flash model id/config are failures.
- **Flock ports probed on loopback only** — binding `0.0.0.0` in a first run can make macOS pop an "accept incoming connections?" firewall dialog, which is the opposite of onboarding. Starling's own server/perch are the realistic squatters.
- **`deepseek key` split out of the model check** so "no key" reads as the intended state on the opencode profile rather than as a failure.
- **`init`'s interactive layer lives in `commands/init.ts`**; `init.ts` stays a pure function of (profile, hardware, choices), which is what makes the three-prompt flow testable with an injected `ask`.
- **Renderer says `fix:` instead of `hint:`** and prints the `maxParallel` suggestion line. Snapshot regenerated (`render/__snapshots__/doctor.test.ts.snap`).

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 162 installs across 221 packages (no changes)`.
- `bun run test` (root, both halves):
  - packages: ` 1420 pass` / ` 0 fail` / `Ran 1424 tests across 163 files. [41.90s]`
  - web: ` 425 pass` / ` 1 fail` on the first full run, then ` 426 pass` / ` 0 fail` on two clean re-runs
    (`Ran 426 tests across 39 files`). The single failure is the wall-clock perf test
    `performance > 360 birds × 600 steps in under 250 ms` in `apps/web/src/features/sky/sim.test.ts`
    (Epic 24/32's lane, untouched by me) — it trips when ~20 parallel agents are hammering this
    machine, and passes on an idle re-run. Not introduced by this epic; flagged, not fixed (out of lane).
- `bun run check`: `Checked 707 files in 224ms. No fixes applied.` + the per-workspace `tsc --noEmit` loop with no output (clean).
- Real `bun run starling doctor` on this machine (while ~20 other agents were building, hence the honest low RAM figure):
```
Starling doctor  ·  darwin/arm64 · bun 1.4.4

✔ bun              1.4.4 (needs ≥ 1.3)
✔ git              2.54.0 (needs ≥ 2.38)
✔ opencode         opencode v2.1.2
✔ opencode server  opencode v2.1.2 answered /api/info in 765 ms · stopped
✔ deepseek         opencode-go/deepseek-v4.1-flash, opencode/deepseek-v4.1-flash (+1 more)
! deepseek key     DEEPSEEK_API_KEY not set — optional: the opencode profile needs no key
                   fix: export DEEPSEEK_API_KEY=…  (only for the direct `deepseek` profile)
✔ gh               authenticated
✔ config           defaults (no starling.config.yaml yet — run `starling init`)
✔ ollama           reachable · 1 local model · no local benchmark yet
✔ ram              7.8 GB available of 32 GB · room for ≈ 3 parallel agents
✔ disk             139.1 GB free (each worktree is a full copy of the repo)
✔ network          LAN 10.200.194.58 · ports 7777 & 7778 free
✔ ulimit           1048576 open files (needs ≥ 1024)

✔ 12 ok  ·  ✘ 0 failed  ·  ! 1 warning
maxParallel 3 suggested (one worker ≈ 2 GB RAM and one core, hub keeps one)
Ready to fly. 🐦  Try `starling plan "<goal>"`.
```
- Real `bun run starling init --yes --dry-run` on this machine (head; the full YAML was inspected field by field):
```
✔ would write starling.config.yaml  profile opencode-go (no API key needed)
  maxParallel 3   flock on   path /Users/moksh/Code/starling-wt/61-onboarding/starling.config.yaml

── dry run: nothing written ─────────────────────────────
# Starling config — generated by `starling init`.
…
# Model profile: opencode
#   every role goes through your local opencode server and the model you are already
#   logged in to, so Starling reads no API keys. The provider *name* must stay
#   `opencode` (it selects the opencode client); the model is `providerID/modelID`.
#   Equivalent one-liner: STARLING_LLM_PROFILE=opencode starling run "…"
# Hardware: 10 cores, 7.8 GB RAM available of 32 GB
# → 3 parallel agents (≈2 GB and one core each; the hub keeps one core).
…
  planner:     { provider: opencode, model: opencode-go/deepseek-v4.1-flash }
  …
providers:
  opencode: { baseUrl: http://127.0.0.1:4096, apiKeyEnv: OPENCODE_SERVER_PASSWORD }
```
- Real generated file in `/tmp/starling-init-check` loaded back through `loadConfig` **and** `@starling/llm`'s `resolveModel`: all six roles → `kind=opencode`, `local=false`, `splitOpencodeModel → {providerID:'opencode-go', modelID:'deepseek-v4.1-flash'}`; `applyProfile(cfg,'opencode').models === cfg.models`.
- Live negative paths: with a dummy listener on 7777 the `network` line flipped to `! network  LAN 10.200.194.58 · port 7777 already in use` (hint `lsof -nP -iTCP:7777 -sTCP:LISTEN`); pressing enter on all three prompts produced the detected defaults; the busy-port and force-guard branches are also unit-tested.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none (nothing needed from `packages/core`).

**FIX REQUESTS** (changes I needed in files outside the literal lane list — both already made, minimal, and both are "unowned" shared CLI files rather than another epic's lane):
1. `apps/cli/src/program.ts` — registered `doctor --json` and `init --yes/--dry-run/--max-parallel/--no-flock`. Reason: commander rejects unregistered flags, so DoD items 2 and the `--json` deliverable are impossible without it; no prompt in Wave 2 lists `program.ts` as anyone's lane. Diff is confined to the `doctor`/`init` registrations, their examples and the help text.
2. `apps/cli/src/program.test.ts` — four parse assertions for those flags (`--json`, `--yes`/`--dry-run`/`--max-parallel`, `--no-flock`). Reason: a flag change without a parse test would be untested; same file ownership situation as (1).

Integrator note: Epic 40 adds `run --budget` and `plan --json` to the same `program.ts` region, so expect a small, additive conflict there.

Also touched, inside the feature but not named in the lane list (call it out for the lane audit): new `apps/cli/src/doctor-probes.ts` + `doctor-probes.test.ts` (the probe split), and the regenerated `apps/cli/src/render/__snapshots__/doctor.test.ts.snap` (owned by `render/**` = Epic 40, but it is the snapshot of *my* renderer).

**Deliberately deferred / out of scope:**
- `run`/`plan`/`status`/`dash`/compose and the `perch`/`flock` commands (Epic 40/42) — untouched.
- No `--fast`/`--no-server-probe` CLI flag (a dependency-level switch exists for tests).
- No auto-`ollama pull`, no `opencode auth login` automation: doctor prints the command, it does not run interactive logins.
- No verification that the chosen profile can actually complete a model call (that is `starling run`; `init` points at it).

**Open questions / flagged tradeoffs:**
- The `opencode` profile routes **all six** roles through opencode (matching `applyProfile`), not just planner/worker/resolver. Cheapest-to-start (no pulled local model needed) but a local auditor would be free; if the product wants ARCHITECTURE's mixed default in the generated file, it is a one-line change in `modelRefs`.
- `suggestMaxParallel` counts RAM only in 2 GB units and knows nothing about model size; `--fully-open` with a 20 GB local model needs a much smaller number. The rule-of-thumb line is printed so a user can correct it.
- `tools/local-models/results/recommendation.json` does not exist on this machine (Epic 28 never ran a real benchmark), so the recommended-model branch is exercised only by fixtures here.
- `hostIdentity()` gained a `bun` field (`{platform, arch, bun}`); it is CLI-internal, but anyone importing it should know the shape changed.
- Pre-existing flake to watch on `main` (not mine, not fixed — outside my lane): the 250 ms boids
  budget in `apps/web/src/features/sky/sim.test.ts` fails under heavy machine load.
