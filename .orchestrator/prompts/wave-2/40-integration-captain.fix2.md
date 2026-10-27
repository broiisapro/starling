# Epic 40 · Fix 2: land on top of the other 22 Wave 2 epics (checkpoint C2)

**Same branch `epic/40-integration-captain`, same worktree, same PR #108. Budget: 30–60 min. Model: DeepSeek V4.1 Flash.**

Great work: the real runs (quick-wins 5/5, launch-day 6/6) and the merge-port race fix are exactly what Starling needed. The Orchestrator merged all 23 Wave 2 branches together in a test copy. **The other 22 merge cleanly, with 2,519 tests passing**, and they're being merged into `main` now. Your branch has **two real conflicts** with them:

1. **`packages/llm/src/providers/opencode.ts`** (semantic conflict with Epic 49, which owned it this wave). Epic 49 **unified the opencode V2 client**: `createOpencodeCompletionClient` now wraps the shared `OpencodeClient` from `@starling/runner` and maps errors via `asLlmError`. Your branch rewrote the *old* implementation to call `POST /api/experimental/generate` first and fall back to the session flow. **Port your behaviour onto Epic 49's design**:
   - add a `generate(...)` method (stateless route, returns `undefined` on 404/refusal so the caller can fall back) to the shared `OpencodeClient` in `packages/runner/src/opencode/client.ts`;
   - make the llm provider try `client.generate` first, then the session path;
   - keep `asLlmError`;
   - address your own handback's FIX REQUEST: report real usage (read the session totals when the session path runs; when the stateless route reports none, record usage as unknown, not zero, if the types allow it, otherwise document it).
   Keep both epics' tests, and add tests for the generate → fallback path in both packages.
2. **`apps/cli/package.json`**: Epic 42 added `@starling/perch` and you added 12 workspace deps. Take the union, alphabetical.
3. **`bun.lock`**: never hand-edit it. Take `origin/main`'s version, then `bun install`.

## Steps
1. Check the other 22 are merged: `git fetch origin --tags && git tag -l 'epic-*-complete' | grep -cE 'epic-(4[1-9]|5[1-9]|6[0-9]|7[01])-complete'` should print **22** (46, 50, 54 haven't run yet). If it's lower, the human is still merging: wait 2 minutes and check again (up to 40 minutes).
2. `git rebase origin/main` (or merge `origin/main` into your branch if the rebase is too noisy), resolving as above. Run `bun install`.
3. Verify:
   - `bun run test` → 0 fail (both halves);
   - `bun run check` → clean;
   - `cd apps/web && bun run build` OK;
   - **one real quick-wins run** on a fresh demo repo (`bash examples/scripts/make-demo-repo.sh sky-todo /tmp/sky-c2` then `bun run starling run "$(cat examples/sky-todo/demo-goals/quick-wins.md)" --repo /tmp/sky-c2 --no-dash`) → all tasks merged. Paste the summary.
4. `git push --force-with-lease`. Update the PR body (handback) with a "C2 rebase" section. Print the PR URL last.
