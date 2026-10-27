# Epic 02 — Repo ops: GitHub bootstrap + local model bring-up

**Wave 0 · branch `epic/02-repo-ops` · machine: mbp**

## Goal

Two things every other epic depends on, both of which are *dev infrastructure*, not product code:

1. **The GitHub side of the swarm workflow.** 35 agents across two laptops need one issue per epic,
   the labels the Orchestrator filters on, wave milestones, and a repo configured for
   squash-merge-only so the PR history stays readable. This had to land first: every other epic's
   PR references one of these issues.
2. **A working local open-weight model on this machine**, plus a script Moksh can re-run on the
   MacBook Air. Starling's auditor, summarizer and writer roles run on a local model
   (ARCHITECTURE §2), so "can this laptop judge a diff in JSON, and how much RAM does that cost"
   is a Wave 0 question, not a Wave 1 one.

## How it works

### Part A — GitHub bootstrap

`gh-bootstrap.sh` is one idempotent script that does five things in order, and prints a summary:

| Step | What it does |
|---|---|
| 0. preflight | `gh auth status`, resolves `OWNER/NAME` via `gh repo view` (or `--repo`), refuses to continue unauthenticated |
| 1. labels | 12 fixed labels + one `lane:<top-level>` per distinct lane in `epics.tsv`, created or **updated in place** (`gh label create --force`) |
| 2. milestones | `Wave 0` … `Wave 3`, created only if missing |
| 3. issues | one issue per row of `.orchestrator/epics.tsv`, titled exactly `Epic NN: <title>`; skipped if that title already exists |
| 4. index | writes `.orchestrator/issues.tsv` (`nn ⇥ number ⇥ url`, sorted by `nn`) — the epic→issue map other epics and the Orchestrator read |
| 5. settings | description, 8 topics, squash-merge only, delete-branch-on-merge, issues enabled |

Flags: `--repo OWNER/NAME`, `--dry-run`, `--quiet`, `--refresh`, `--help`.
Bash 3.2 compatible (macOS's `/bin/bash`), so it runs from a clean checkout with no Homebrew bash.

**Lane labels.** A lane cell like `packages/planner, evals/planner` becomes `lane:packages` and
`lane:evals`; `apps/web/src/features/sky` becomes `lane:apps`; `README.md` becomes `lane:root`;
`.github/` becomes `lane:github`. Free-text extras in the sheet (`per sheet`, `agents`, `GitHub`)
are not paths and are dropped rather than turned into junk labels. Result: 11 lane labels
(`apps docs evals examples fixtures github integrations packages root skills tools`).

**Issue body.** A field table (lane, machine, depends-on, prompt path, branch, worktree, doc,
handback), the six-item checklist from the brief, and a collapsed "Lane rules" block. Depends-on
renders as real links (`#1`) because the script keeps a `nn → number` index as it goes, and
`C1`/`C2` render as `checkpoint C1`. A prompt that does not exist yet says
"prompt written when the wave is scheduled".

**Re-running.** Every step is a no-op the second time. `--refresh` is the escape hatch: it rewrites
the *body* of issues that already exist, without touching their numbers — added after the first
real run emitted `depends on: epic -` for every dependency-free epic. Issue numbers are stable
API surface (PRs say `Closes #12`), so fixing formatting must never mean re-creating issues.

**Templates.** `.github/PULL_REQUEST_TEMPLATE.md` is literally the AGENTS.md §6 handback, so every
epic PR arrives in the shape the Orchestrator audits, plus a five-item pre-flight checklist.
Issue forms: `epic.yml` (for epics not yet in the sheet — bug-bash sheets, follow-ups),
`bug.yml` (area, version, machine, repro, severity), `contract-request.yml` (surface, exact
proposed diff, why, blast radius, two confirmations that the frozen file was *not* edited), and
`config.yml` (blank issues off, links to ARCHITECTURE/PROCESS/Discussions).

**No CI workflows** — that is Epic 52, and a workflow that runs `bun run check` before `packages/*`
exist would be red on every PR.

### Part B — Local model bring-up

`tools/local-models/setup.sh [--profile mbp|air] [--pull] [--host URL] [--json]`

1. Hardware facts: chip, cores, RAM (`hw.memsize`), free disk, macOS version, hostname.
2. Ollama: present? running? If missing → `brew install ollama`; if down → `brew services start ollama`
   when the formula is installed, else the `Ollama.app` menu-bar app, else `nohup ollama serve`;
   then poll `/api/version` for 30 s and fail loudly if it never comes up.
3. Candidates for the profile, read from `candidates.json` (tag, params, download size, context,
   license, tools / json-schema support) and the reason the primary was chosen.
4. `--pull`: fetch the profile's one primary model. Skipped if the tag is already in `ollama list`,
   so the script is safe to re-run and safe to run while a pull is in flight.

The profile defaults from real RAM (≥ 24 GB → `mbp`), and warns if the flag disagrees with the
hardware. On an 8 GB Air it drops to the 4B fallback automatically.

`tools/local-models/smoke.ts` is the measuring instrument — a Bun script with no dependencies:

1. **Cold call** on `/v1/chat/completions` (the OpenAI-compatible surface `@starling/llm` will use),
   streamed, with `response_format: {type: "json_schema", json_schema: {..., strict: true}}` and an
   audit-verdict schema `{pass: boolean, summary: string, fixInstructions?: string}`. The diff under
   audit is six lines that change date formatting and add no test, so a strict auditor must say
   `pass: false`. This call pays the model load.
2. **Warm call** on `/api/chat` with `format: <schema>`, streamed, which returns exact
   `eval_count`/`eval_duration` — the honest tokens/s, and a load-free TTFT.
3. **Checks**: JSON parses, `pass` is boolean, `summary` non-empty, `fixInstructions` optional,
   no extra keys, and the verdict is *sane* (it must fail the seeded diff). Exit code 1 if any
   check fails, so it can gate a demo rehearsal.
4. **Footprint** before and after the model is resident: `ollama ps` resident size, summed RSS of
   ollama processes, `vm_stat` wired pages, `memory_pressure` free %.
5. Writes `tools/local-models/results/smoke-<hostname>-<model>[-nothink].json` and prints a summary.

Default model = `$STARLING_LOCAL_MODEL`, else the primary for the inferred profile from
`candidates.json`, so `bun tools/local-models/smoke.ts` with no flags does the right thing on
either laptop. `--think off` measures the same verdict with the reasoning pass disabled.

## Key decisions & reasoning

**`gh` CLI + REST, not a library.** L14 says shell out to `gh`; the only place a shell-out could not
express the intent was *disabling* merge commits — `gh repo edit` has `--enable-*` but no
`--disable-*` in gh 2.98, so that half goes through `gh api -X PATCH repos/:repo -F allow_merge_commit=false`.
Everything else stays in the CLI so the script reads like the commands a human would type.

**Issues are never edited by default.** Numbers are API surface: prompts, PRs and the Orchestrator
all reference `#NN`. So the default path skips existing issues, and `--refresh` (body only) is a
separate, explicit opt-in. This is what let me fix a body-formatting bug after the first run
without churning 50 issue numbers.

**Idempotency proven, not asserted.** The script was run for real (50 created), then immediately
again (0 created, 50 skipped), then a third time with `--refresh` (0 created, 50 bodies rewritten).
All three summaries are in the handback.

**mbp primary is `qwen3.8:27b-mlx`, not the brief's `qwen3.6:35b-a3b` — because of a measurement.**
The brief asked for Qwen 3.6 35B-A3B at ~4-bit, and it exists (23–24 GB, MoE, ~3B active). But the
footprint measurement below says an **18 GB** model already takes 32 GB down to **27% free**
(≈ 8.6 GB) with nothing else running. A 23 GB model would leave ≈ 6 GB for macOS *and* 8 opencode
sessions — exactly the squeeze the PRD's risk table calls out, and exactly what would make the demo
stall. `qwen3.8:27b-mlx` is Apache-2.0, a newer family than 3.6, was already resident on this
machine, and produced a correct sane verdict in the smoke test. The 35B-A3B pull was also throttled
to 2–4 MB/s on this network (≈ 2 h ETA), so it could not be validated in this session; the pull was
left running and `ollama pull` resumes. `candidates.json` keeps 35B-A3B, `gpt-oss:20b` (14 GB, MoE,
Apache-2.0) and `gemma4:26b-a4b-it-qat` (16 GB) as Epic 28 bench candidates, with the RAM arithmetic
written down so the benchmark has a budget to respect. Flipping back is a one-line change to
`.profiles.mbp.primary`.

**Air primary is `qwen3.5:9b`, slightly above the "4B–8B class" the brief suggested.** Qwen 3.6 has
no small variant (only 27b/35b), so the newest Qwen that fits an Air is 3.5. At 6.6 GB (q4_K_M) it
leaves ~9 GB of 16 GB for macOS plus one or two opencode sessions; a 4B model fits more comfortably
but its judgment on a real diff is weak, and a false "pass" is the failure mode this project exists
to prevent. `qwen3.5:4b` (3.3 GB) is the automatic fallback on an 8 GB machine, and
`gemma4:12b-it-qat` (7.2 GB) is the Epic 28 alternative — not the default because Gemma's licence is
not OSI-approved and Starling's story is open-weight-first.

**`think: false` is native-only.** Observed in the smoke test: `/v1/chat/completions` ignores a
`think` field (416 completion tokens, same as thinking on) while `/api/chat` honours it (102 tokens,
460 ms TTFT). The smoke script auto-detects this and records it in the result file's `notes`. Epic 10
and Epic 16 need to know this before they build the auditor loop.

**Results are committed, weights are not.** The two smoke result files are ~5 KB each and are the
evidence for this doc. Model weights live in `~/.ollama` and are never in the repo.

## Measured numbers (this machine)

**Hardware:** Apple M5 (10 cores), 32 GB unified memory, 141 GiB free disk, macOS 27.0.1,
Ollama 0.40.8 (installed as `Ollama.app`, not the Homebrew formula), Bun 1.4.4.

**Model:** `qwen3.8:27b-mlx` — 27B dense, MLX runner, 262 144-token context, Apache-2.0,
`ollama ps` resident size **18 GB**, 100% GPU.

| measurement | thinking on | thinking off (`--think off`) |
|---|---|---|
| load time, cold (18 GB → GPU) | ~9 s (separate `api/generate` probe) | — |
| cold verdict, TTFT | 23.4 s | 14.2 s (v1 ignores `think:false`) |
| cold verdict, total | 31.8 s | 25.3 s |
| **warm verdict, TTFT** | 12.3 s | **0.46 s** |
| **warm verdict, total** | 21.8 s | **5.8 s** |
| tokens generated | 413 | 102 |
| **tokens/s** (native `eval_duration`) | 19.0 | 18.3 |
| verdict correct (`pass: false`, missing test) | ✅ | ✅ |

**Memory footprint while the model is resident** (the number that decides how many sessions fit):

| | no model loaded | model resident |
|---|---|---|
| wired memory | 3.3 GB | **20.6 GB** (+17.3 GB) |
| system-wide free RAM | 75 % (24 GB) | **27 % (≈ 8.6 GB)** |
| `ollama ps` resident | — | 18 GB |
| ollama process RSS | 45 MB | 162–614 MB |

The last row is the interesting one: on Apple silicon the MLX weights are **wired GPU memory, not
process RSS**, so `ps` is useless here and `ollama ps` + `vm_stat` wired pages are the honest
sources. With ~8.6 GB free and `opencode` itself measured at 442 MB RSS, the mbp can run the model
plus roughly 8–10 opencode sessions before it starts swapping — which matches the configured
`flock.hubMaxSessions: 8`. **A 23 GB model would leave ~6 GB, i.e. 4–6 sessions.** That is the whole
argument for the primary choice above.

## Interfaces for future epics

- **`.orchestrator/issues.tsv`** — `nn ⇥ number ⇥ url`, one row per epic, sorted. Epic 18 (Tracker),
  Epic 40 (integration captain) and the Orchestrator read this to link epics to issues. Regenerate it
  with `gh-bootstrap.sh` whenever `epics.tsv` changes.
- **Issue titles are the join key** — `Epic NN: <title>`. `gh issue list --search "Epic 12"` works;
  the Tracker should match on this exact format.
- **Labels** — `epic`, `wave-N`, `machine:mbp|air`, `lane:<path>`, `checkpoint`, `contract-request`,
  `bug`, `hacktoberfest`, `good first issue`. Epic 18's `syncPlan` should create task issues with
  `wave-N` + the task's lane label; Epic 67 seeds `good first issue`.
- **`candidates.json`** — `.profiles.<mbp|air>.primary` is the single source of truth for "which local
  model this laptop runs". Epic 10 (LLM router) should read the same file (or the config key it feeds)
  rather than hard-coding a tag; Epic 28 owns replacing the primary with a measured winner.
- **`results/smoke-*.json`** — one file per (host, model, think) with `timings`, `memory`, `checks`,
  `verdict`. Epic 28 can reuse the shape for its benchmark matrix.
- **The verdict schema** `{pass, summary, fixInstructions?}` used in `smoke.ts` is a *proposal* for the
  auditor's structured-output contract (Epic 16). It is not a locked contract — it lives in
  `tools/`, not in `packages/core`.
- **`starling.config.yaml` wiring:** `models.auditor: { provider: ollama, model: qwen3.8:27b-mlx }` on
  the mbp, `qwen3.5:9b` on the Air. Base URL `http://127.0.0.1:11434/v1` (L15).

## Air setup in 5 steps

Run these on the MacBook Air M2. Steps 1–2 are one-time; 3–5 are what you re-run before a demo.

1. **Clone** — `git clone https://github.com/broiisapro/starling.git && cd starling`
2. **Auth** — `gh auth status || gh auth login`, then `gh auth setup-git` (one browser round-trip).
   Check you can see the issues: `gh issue list --label machine:air --limit 5`.
3. **Bring up the model** — `bash tools/local-models/setup.sh --profile air --pull`
   Installs Ollama if missing, starts it, prints chip/RAM/disk, and pulls **`qwen3.5:9b`** (6.6 GB).
   It adapts: on an 8 GB Air it pulls `qwen3.5:4b` (3.3 GB) instead. Expect 5–30 min on home wifi.
4. **Smoke it** — `bun tools/local-models/smoke.ts`
   No flags needed: it reads `candidates.json`, picks the `air` primary, and writes
   `tools/local-models/results/smoke-<air-hostname>-qwen3.5-9b.json`. It exits non-zero if the model
   returns invalid or insane JSON — if it fails, do **not** wire it into the config.
5. **Check the footprint, then wire it** — `ollama ps` while the model is loaded (note SIZE), then set
   `models.auditor: { provider: ollama, model: qwen3.5:9b }` in `starling.config.yaml`. On 16 GB,
   budget the model's ~7 GB and keep `perch.maxSessions` at 2–3 rather than the default 5.

If step 3 fails because the venue wifi is dead, the Air can run the auditor on the hub instead
(`starling perch --hub …` and let the hub audit) — audits always happen on the hub anyway (L20), so
the Air's local model is an optimisation for its *own* worker sessions, not a requirement.

## Deviations from plan

1. **mbp primary is `qwen3.8:27b-mlx`, not `qwen3.6:35b-a3b`.** Reason and reversal path above
   (measured RAM headroom; the 23 GB pull was throttled to ~2 h). The 35B-A3B pull was left running
   in the background — `ollama pull qwen3.6:35b-a3b` resumes it.
2. **Air primary is 9B, not 4–8B.** Qwen 3.6 has no small tag; 9B q4 fits 16 GB and judges better
   than 4B. 4B is the automatic fallback under 12 GB of RAM.
3. **`gh repo edit` cannot disable merge methods**, so "squash-merge only" is applied with
   `gh api -X PATCH`. Same outcome, one extra call.
4. **`--refresh` flag added** to `gh-bootstrap.sh`, beyond the brief's interface, to fix issue bodies
   without re-creating issues. Off by default; documented in `--help`.
5. **`smoke.ts` makes two calls, not one.** The brief asked for the `/v1/chat/completions` request;
   the extra `/api/chat` pass is what makes tokens/s exact (Ollama does not always report usage on the
   OpenAI-compatible stream) and it surfaced the `think:false` asymmetry. It also measures memory,
   which the brief asked for separately.
6. **`--think off` added** to `smoke.ts`: the single biggest latency lever found (21.8 s → 5.8 s per
   verdict, same verdict).

## Known limitations / deferred

- **No CI.** Deliberate (Epic 52).
- **`bun run test` / `bun run check` do not exist yet** at the repo root: Epic 00 owns root config and
  is running in parallel. This epic adds no package and no root file, so there is nothing for those
  scripts to run here; `bun -e` / `bash -n` were used as the local gate instead (see handback).
- **One model per profile was measured.** The rest of `candidates.json` is researched, not benchmarked
  — that is Epic 28, which should also re-measure *with opencode sessions running*, since that is the
  real demo condition.
- **The Air has not run any of this.** Its RAM is assumed to be 16 GB from `epics.tsv`/ARCHITECTURE;
  `setup.sh` adapts at runtime, but the numbers for `qwen3.5:9b` are estimates from the registry, not
  measurements. Step 4 of the Air setup is what turns them into facts.
- **`lane:` labels are coarse by design** (top-level path). Per-package labels would be 20+ labels for
  50 issues and the Orchestrator filters on wave + machine anyway.
- **Issue bodies are generated once.** If `epics.tsv` changes a lane or dependency later, re-run with
  `--refresh`.
- **Smoke results are machine-specific and committed anyway** (~5 KB). If they start to churn, move
  them behind a `results/` gitignore in a later epic — root `.gitignore` is Epic 00's lane.
