import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditorCase } from './case';

/**
 * Per-case throwaway worktrees for `--impl real`.
 *
 * The auditor runs the task's test command in `run.worktreePath`. A real auditor therefore needs a
 * real directory: without one the command cannot spawn, the `tests` check fails for every case, and
 * the eval measures "missing worktree" instead of "judgment".
 *
 * Each worktree is a one-file Bun project whose suite is generated from the case's recorded outcome
 * (`suite` in the case JSON). A green case gets a genuinely passing `bun test`; a red case gets a
 * genuinely failing assertion, so the reviewer reads real Bun output — exit code and tail included —
 * exactly like production. Nothing here writes into the repo or loads a model.
 */

const created: string[] = [];
let hookInstalled = false;

function installCleanupHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  process.on('exit', cleanupCaseWorktrees);
}

function suiteSource(testCase: AuditorCase): string {
  const { suite } = testCase;
  const name = suite.testName;
  if (suite.pass) {
    return [
      "import { expect, test } from 'bun:test'",
      '',
      `test(${JSON.stringify(name)}, () => {`,
      '  expect(1 + 1).toBe(2)',
      '})',
      '',
    ].join('\n');
  }
  return [
    "import { expect, test } from 'bun:test'",
    '',
    `test(${JSON.stringify(name)}, () => {`,
    `  expect(${JSON.stringify(suite.actual)}).toBe(${JSON.stringify(suite.expected)})`,
    '})',
    '',
  ].join('\n');
}

/** Create (and remember) the worktree this case's audit should run in. */
export function makeCaseWorktree(testCase: AuditorCase): { path: string; testCommand: string } {
  installCleanupHook();
  const dir = mkdtempSync(join(tmpdir(), `starling-audit-eval-${testCase.name}-`));
  created.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'sky-todo', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(join(dir, 'suite.test.ts'), suiteSource(testCase), 'utf8');
  return { path: dir, testCommand: 'bun test' };
}

/** Remove every worktree this process created. Safe to call more than once. */
export function cleanupCaseWorktrees(): void {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not worth failing an eval run over.
    }
  }
}

/** Number of worktrees currently on disk from this process (tests assert cleanup works). */
export function liveWorktreeCount(): number {
  return created.filter((dir) => {
    try {
      return readdirSync(dir).length >= 0;
    } catch {
      return false;
    }
  }).length;
}
