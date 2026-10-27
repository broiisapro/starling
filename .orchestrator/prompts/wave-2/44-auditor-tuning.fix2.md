# Epic 44 · Fix 2: resume after the crash

**Same branch `epic/44-auditor-tuning`, same worktree. Model: DeepSeek V4.1 Flash.**

At **15:57 ET** every running agent was cut off at the same moment by `Error: Transport: The socket connection was closed unexpectedly` (the shared opencode service dropped). **Nothing is wrong with your work.** You're being relaunched in the same worktree, with each agent now on its own private opencode server.

## Your assignment is unchanged
Read **`.orchestrator/prompts/wave-2/44-auditor-tuning.fix1.md`** completely. It's still your full assignment: lane, deliverables, definition of done, git rules. Then read `AGENTS.md`.

## FIRST TASK: pick up where you left off
1. `git log --oneline origin/main..HEAD` and `git status` show what you already committed and what's uncommitted. Read your own `docs/epic-44-auditor-tuning.md` / `.orchestrator/handbacks/44-auditor-tuning.md` if they exist.
2. Review the uncommitted changes: keep and commit what's correct (Conventional Commits), and discard anything half-written that doesn't compile.
3. Make a short list of the remaining deliverables and DoD items, then do **only those**. Don't redo finished work.
4. If you had started a long-running process (a server, a real Starling run, a benchmark), assume it's gone. Clean up stale temp dirs and ports you created, and re-run it if your DoD still needs it.
5. Finish exactly as the original assignment says: doc, handback (mention the interruption in one line), `git fetch origin && git rebase origin/main`, push, open the PR (or update it if one exists: `gh pr list --head epic/44-auditor-tuning`), and print the PR URL last.
