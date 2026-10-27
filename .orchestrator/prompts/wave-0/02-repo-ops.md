# Epic 02: Repo ops, GitHub bootstrap + local model bring-up

**Wave 0 · Branch `epic/02-repo-ops` · Model: DeepSeek V4.1 Flash · Budget: 40–80 min**

Starling (read `.orchestrator/PRD.md` and `.orchestrator/PROCESS.md`) is being built by about 35 parallel opencode agents across two laptops: a MacBook Pro M5 Pro with 32 GB (the "mbp") and a MacBook Air M2 (the "air"). The workflow is one GitHub issue, one branch, one worktree and one PR per epic, tracked in `.orchestrator/epics.tsv`. You set up the **GitHub side** of that workflow, and you bring up the **local open-weight models** Starling uses for auditing.

Epics 00 and 01 are running in parallel. Stay strictly in your lane.

## Locked decisions relevant to you
L14 (shell out to `gh`, no Octokit), L15 (Ollama OpenAI-compatible endpoint `http://127.0.0.1:11434/v1`), L16 (MIT, public, `hacktoberfest` topic), L17 (issues + branches + PRs, two dev machines), ARCHITECTURE §2 (model routing: local models do auditor/summarizer/writer).

## FIRST TASK: carryover
None. This is a first-wave epic.

## Your lane
`.github/**`, `tools/local-models/**`, `.orchestrator/bin/gh-bootstrap.sh`, `.orchestrator/issues.tsv`, `docs/epic-02-repo-ops.md`, `.orchestrator/handbacks/02-repo-ops.md`. (This is a deliberate exception to the AGENTS.md "don't touch `.orchestrator/`" rule, for exactly those two files.)

## Deliverables

### Part A: GitHub bootstrap (do this first: other epics' PRs reference these issues)
1. Confirm `gh auth status` works and find the repo with `gh repo view --json nameWithOwner`. If `gh` isn't authenticated, stop Part A, say so loudly at the top of your handback, and continue with Part B.
2. `.orchestrator/bin/gh-bootstrap.sh`: **idempotent**, bash-3.2 compatible, safe to re-run any time the Orchestrator adds epics:
   - Labels (create or update colour and description): `epic`, `wave-0` … `wave-3`, `machine:mbp`, `machine:air`, `checkpoint`, `contract-request`, `bug`, `hacktoberfest`, `good first issue`, plus a `lane:<name>` label per distinct top-level lane.
   - Milestones: `Wave 0` … `Wave 3`.
   - One issue per row of `.orchestrator/epics.tsv`, titled exactly `Epic NN: <title>`, skipped if an issue with that title exists. The body has the lane, depends-on, machine, the prompt path `.orchestrator/prompts/wave-N/NN-slug.md` (note "prompt written when the wave is scheduled" if missing), and a checklist: prompt written · spawned · PR open · audited · merged · tagged `epic-NN-complete`. Apply the labels and milestone.
   - Writes `.orchestrator/issues.tsv` (`nn  number  url`), sorted.
   - Repo settings via `gh repo edit`: description "🐦 Starling: an open-weight swarm of coding agents that spreads across every laptop in the room", topics `hacktoberfest, open-source-ai, open-weight, opencode, deepseek, coding-agents, multi-agent, bun`, squash-merge only, delete branch on merge, issues enabled.
   - Run it for real, then run it a **second time** to prove idempotency (zero new issues). Paste both summaries.
3. `.github/PULL_REQUEST_TEMPLATE.md` = the handback template from AGENTS.md §6. Also `.github/ISSUE_TEMPLATE/epic.yml`, `bug.yml`, `contract-request.yml` (issue forms) and `config.yml`.
4. **No CI workflows.** CI is Epic 52.

### Part B: local model bring-up (this machine, plus a script Moksh will re-run on the Air)
1. `tools/local-models/setup.sh [--profile mbp|air] [--pull]`:
   - Checks Ollama is installed and running. If it's missing, install it with Homebrew (`brew install ollama`) and start it (`brew services start ollama`, or `ollama serve` in the background). Print what it did.
   - Prints hardware facts: chip, RAM (`sysctl hw.memsize`), free disk.
   - **Research the current exact Ollama library tags** (ollama.com/library) for these candidates and record them in `tools/local-models/candidates.json` with name, tag, download size, context length, license, tool/JSON support:
     - mbp auditor candidates (32 GB): Qwen 3.6 35B-A3B (MoE), Qwen 3.6 27B, gpt-oss 20B, Gemma 4 26B-A4B.
     - air candidates (assume 16 GB unless `sysctl` says otherwise; adapt to the real RAM): a 4B–8B class model with reliable JSON output (e.g. a small Qwen 3.6 or Gemma 4 variant; verify the names exist).
   - With `--pull`, pulls **one primary model per profile** (mbp: Qwen 3.6 35B-A3B at a ~4-bit quant, if it exists; otherwise the best fit you find; air: the best small one). Epic 28 benchmarks the rest.
2. `tools/local-models/smoke.ts` (Bun script, no deps beyond what Bun has; plain `fetch` is fine here): calls `POST /v1/chat/completions` on Ollama with a **JSON-schema-constrained** "audit verdict" style request (`{pass:boolean, summary:string, fixInstructions?:string}`) for a tiny fake diff. It measures time-to-first-token, tokens/s and total latency, and checks the JSON parses. It writes `tools/local-models/results/smoke-<hostname>-<model>.json`. Run it on this machine against the pulled model and paste the result.
3. Note the real memory footprint while the model is loaded (`ollama ps`, plus Activity Monitor-style RSS via `ps`). This number decides how many opencode sessions the mbp can run alongside the model on demo day. Record it in the doc.

### Part C: docs
`docs/epic-02-repo-ops.md` per AGENTS.md §6. Include **"Air setup in 5 steps"**: plain steps Moksh follows on the MacBook Air (clone, auth, `setup.sh --profile air --pull`, smoke), and a table of the chosen models with the measured numbers.

## Explicitly out of scope
CI workflows (Epic 52). The full model benchmark and auditor-quality evals (Epics 28, 29, 44). Any Starling package code. Root config. `examples/`.

## Definition of done (run literally, paste outputs)
1. `gh issue list --label epic --limit 100` shows one issue per epic row (50 issues). `.orchestrator/issues.tsv` matches.
2. The second `gh-bootstrap.sh` run reports 0 created.
3. `gh repo view --json description,repositoryTopics,squashMergeAllowed,mergeCommitAllowed,deleteBranchOnMerge` shows the settings.
4. `bash tools/local-models/setup.sh --profile mbp --pull` succeeds; `bun tools/local-models/smoke.ts` writes a result file with valid JSON output and tok/s.
5. Doc + handback written. PR opened with `Closes #<your issue>`.

## Git
Branch `epic/02-repo-ops`, Conventional Commits (`chore(github): …`, `feat(local-models): …`), at least 5 commits, rebase on `origin/main` before push. Never commit model weights or result files larger than 100 KB. No merging or tagging.
