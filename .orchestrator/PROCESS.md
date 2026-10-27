# Build process — how the swarm builds Starling

Adapted from the Orchestrator Methodology, with these changes:
- **No epic-chat layer.** The Orchestrator (Claude, in Cowork) writes each epic prompt straight to a file: `.orchestrator/prompts/wave-N/NN-slug.md`. Each prompt is self-contained and sized for 40–120 min of autonomous opencode work.
- **Model:** every opencode session runs DeepSeek V4.1 Flash.
- **Branches + PRs + issues, not trunk-based.** One issue, one branch, one worktree and one PR per epic.
- **Massively parallel waves** instead of a sequential epic chain. Lanes prevent collisions.
- **CI comes later:** checks run in the integrator session at each checkpoint; GitHub Actions arrive in Epic 41.
- **Asana** is the "which epic are we on" surface. Git tags are the objective record.

## Per-epic lifecycle

| Step | Who | Artifact |
|---|---|---|
| 1. Write prompt | Orchestrator | `.orchestrator/prompts/wave-N/NN-slug.md` committed to `main` |
| 2. Issue | `gh-bootstrap.sh` (E02) | GitHub issue "Epic NN: Title", labels `wave-N`, `epic`, lane label |
| 3. Spawn | Moksh runs `.orchestrator/bin/spawn-wave.sh N --machine mbp` on the Pro and `… --machine air` on the Air (after `git pull` on both) | branch `epic/NN-slug`, worktree `../starling-wt/NN-slug`, opencode session |
| 4. Build | opencode + DeepSeek | commits, `docs/epic-NN-slug.md`, handback, PR |
| 5. Audit | Orchestrator reads handback + diff (`git show`, `git diff main...epic/NN-slug`) | verdict: merge / fix-prompt / reject |
| 6. Fix (if needed) | Orchestrator writes `.orchestrator/prompts/wave-N/NN-slug.fix1.md`; Moksh runs `spawn-wave.sh --resume NN` | more commits on the same PR |
| 7. Merge | integrator session at the checkpoint (or Moksh via `gh pr merge --squash` for trivial ones) | squash commit on `main` |
| 8. Close out | integrator tags `epic-NN-complete` on the squash commit; Orchestrator moves the Asana task to Done with the tag + PR link | tag + doc + Asana all agree |

An epic counts as **done** only when the tag, `docs/epic-NN-*.md` and Asana all agree. That's methodology §9, unchanged.

## Checkpoints (C1, C2)

The Orchestrator writes `.orchestrator/prompts/checkpoint-CN.md` for one **integrator** opencode session on `main` (worktree `../starling-wt/integrator`). It:
1. Merges approved PRs in the listed order (`gh pr merge --squash`). On `bun.lock` conflicts, take `main`'s version, then `bun install`, then commit.
2. Runs `bun install && bun test && bun run check` after every merge, and bisects on failure.
3. Tags each merged epic.
4. Writes `.orchestrator/handbacks/checkpoint-CN.md`: what merged, what failed, regressions, contract requests collected.

The Orchestrator then folds contract requests into ARCHITECTURE.md (new L-items), and writes the next wave's prompts with the carryover as **FIRST TASK**.

## Rules the Orchestrator holds itself to
- Never write product code. Prompts, docs and dev tooling scripts only.
- Never tag or close an epic on a self-report. Read the diff; check the verification output is real.
- Carryover is never dropped. It becomes the first task of the next prompt touching that lane.
- Re-ground after each checkpoint: re-read ARCHITECTURE + ROADMAP + Asana, then post a status update to Asana (methodology §8 format).
