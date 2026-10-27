/**
 * The real thing: a genuine `starling run` on the sky-todo demo repo with real agents.
 *
 * Skipped unless `STARLING_LIVE=1` (AGENTS.md §4), and deliberately not part of the root suite: it
 * spends real tokens, takes ~10 minutes and writes to /tmp. Run it by hand:
 *
 * ```bash
 * bash examples/scripts/make-demo-repo.sh /tmp/sky-e2e-live
 * STARLING_LIVE=1 bun test apps/cli/src/real/compose-real.live.test.ts
 * ```
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig, exec } from '@starling/core';
import { composeReal } from './compose-real';
import { storePathFor } from './paths';

const live = process.env.STARLING_LIVE === '1';
const REPO = process.env.STARLING_LIVE_REPO ?? '/tmp/sky-e2e-live';

function quickWinsGoal(): string {
  const file = join(import.meta.dir, '../../../../examples/sky-todo/demo-goals/quick-wins.md');
  return readFileSync(file, 'utf8').trim();
}

describe.skipIf(!live)('composeReal (live)', () => {
  test(
    'quick-wins: every task merges and the integration branch is green',
    async () => {
      const composition = composeReal(defaultConfig, { repoPath: REPO });
      try {
        const { runId } = await composition.engine.start({
          goal: quickWinsGoal(),
          repoPath: REPO,
          maxParallel: 3,
          baseBranch: 'main',
        });
        const run = await composition.engine.waitForFinish(runId);

        expect(run.plan?.tasks.length).toBeGreaterThan(1);
        for (const task of Object.values(run.tasks)) {
          expect(`${task.taskKey}: ${task.status}`).toBe(`${task.taskKey}: merged`);
        }
        expect(run.status).toBe('finished');
        expect(run.integrationBranch).toBeDefined();

        // The deliverable is the integration branch itself: its suite must be green.
        const branch = run.integrationBranch ?? '';
        const worktree = join(composition.worktreeRoot, 'live-verify');
        await exec(['git', 'worktree', 'add', '--force', worktree, branch], {
          cwd: REPO,
          timeoutMs: 60_000,
        });
        const tests = await exec(['bash', '-c', 'bun run test'], { cwd: worktree, timeoutMs: 300_000 });
        await exec(['git', 'worktree', 'remove', '--force', worktree], { cwd: REPO });
        expect(tests.code).toBe(0);

        // And the run left a durable record behind.
        const events = composition.store.events(runId);
        expect(events.some((event) => event.type === 'merge.result')).toBe(true);
        expect(storePathFor(REPO)).toContain('.starling');
      } finally {
        await composition.close();
      }
    },
    { timeout: 30 * 60_000 },
  );
});
