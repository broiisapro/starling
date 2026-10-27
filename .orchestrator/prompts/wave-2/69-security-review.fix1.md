# Epic 69 · Fix 1: probes flipped green after the owner fixes landed

**Same branch `epic/69-security-review`, same worktree, same PR. Budget: 10–20 min.**

The Orchestrator merged all 17 finished Wave 2 branches together in a test copy. Your probes worked exactly as designed: **Epic 41's replay allow-list fixed the replay-confinement findings**, so these now fail *because the behaviour is fixed*. Update them:

1. `tools/security/replay-confinement.test.ts`:
   - remove `.failing` from the three probes "refuses a recording outside the run directory", "refuses a symlink that points outside the run directory" and "refuses an absolute path to a non-recording";
   - change the "replay is an event-injection primitive" impact test so it asserts the **fixed** behaviour (a forged recording outside the allowed dirs is refused with **403**), and keep a comment explaining what it used to demonstrate.
2. `tools/security/exec-argv.test.ts`, the "every bash -c command is config-derived" allow-list. The merged code now has exactly these `-c` sites; review each and update the list:
   - `apps/cli/src/doctor.ts`: `['sh', '-c', 'ulimit -n']` (a constant string, benign);
   - `packages/auditor/src/commands.ts`: unchanged;
   - `packages/merger/src/suite.ts`: the merger's test command moved here from `merge.ts` (Epic 45), still config-derived. Verify that.
3. The trial merge of all 17 branches is what flips these. Your branch alone doesn't contain Epic 41's or 45's changes, so **rebase onto `origin/main` only after the Orchestrator says those are merged**. Instead, verify your changes by temporarily merging them locally: `git fetch origin && git merge --no-commit --no-ff origin/epic/41-live-dashboard origin/epic/45-resolver origin/epic/61-onboarding`, run `bun test tools/security` (0 fail), then `git merge --abort`.
4. Update your handback's findings table: mark the replay findings **FIXED by Epic 41**. Commit and push to the same PR. Print the PR URL last.
