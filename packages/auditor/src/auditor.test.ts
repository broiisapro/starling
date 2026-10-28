import { describe, expect, test } from 'bun:test';
import type { DiffSummary } from '@starling/core';
import { FakeClock, StarlingError } from '@starling/core';
import { MockLLM } from '@starling/core/testing';
import { createAuditor } from './index.ts';
import {
  BRANCH,
  csvDiff,
  csvExportTask,
  fakeExec,
  llmJson,
  makeAuditInput,
  passingVerdict,
  WORKTREE,
} from './test-support.ts';

function okOutput(): { code: number; stdout: string } {
  return { code: 0, stdout: '12 pass\n0 fail\n\nRan 12 tests across 2 files.' };
}

describe('createAuditor — passing work', () => {
  test('a lane-clean, green, DoD-complete diff passes with every check recorded', async () => {
    const clock = new FakeClock(1_700_000_123_000);
    const llm = new MockLLM({ responses: [llmJson(passingVerdict())] });
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({ llm, exec: fake.fn, clock }).audit(makeAuditInput());

    expect(verdict.pass).toBe(true);
    expect(verdict.taskKey).toBe('csv-export');
    expect(verdict.attempt).toBe(1);
    expect(verdict.ts).toBe(1_700_000_123_000);
    expect(verdict.laneViolations).toEqual([]);
    expect(verdict.fixInstructions).toBeUndefined();
    expect(verdict.model).toEqual({ provider: 'ollama', model: 'qwen3.6:35b-a3b' });
    expect(verdict.checks.map((check) => check.name)).toEqual([
      'lane',
      'non-empty',
      'tests',
      'missing-tests',
      'lint',
      'llm-review',
    ]);
    expect(verdict.checks.every((check) => check.ok)).toBe(true);
    // C1: the duration is its own field now, so `detail` is exactly what the check has to say.
    expect(verdict.checks.every((check) => check.detail.includes(' ms)') === false)).toBe(true);
    expect(verdict.checks.every((check) => Number.isInteger(check.durationMs))).toBe(true);
    expect(verdict.checks.every((check) => (check.durationMs ?? -1) >= 0)).toBe(true);
    expect(verdict.summary).toContain('RFC 4180');
  });

  test('runs the test and lint commands through sh -c in the task worktree', async () => {
    const fake = fakeExec((command) =>
      command.includes('bun test') ? okOutput() : { code: 0, stdout: 'Checked 12 files' },
    );
    await createAuditor({ exec: fake.fn }).audit(makeAuditInput());

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.cmd).toEqual(['sh', '-c', 'bun test']);
    expect(fake.calls[0]?.opts.cwd).toBe(WORKTREE);
    expect(fake.calls[0]?.opts.timeoutMs).toBe(600_000);
    expect(fake.calls[1]?.cmd).toEqual(['sh', '-c', 'bunx biome check .']);
  });

  test('falls back to the goal repo when the run has no worktree path', async () => {
    const fake = fakeExec(() => okOutput());
    await createAuditor({ exec: fake.fn }).audit(makeAuditInput({ worktreePath: null }));
    expect(fake.calls[0]?.opts.cwd).toBe('/tmp/sky-todo');
  });

  test('honours a custom command timeout', async () => {
    const fake = fakeExec(() => okOutput());
    await createAuditor({ exec: fake.fn, commandTimeoutMs: 5_000 }).audit(makeAuditInput());
    expect(fake.calls[0]?.opts.timeoutMs).toBe(5_000);
  });

  test('.starling bookkeeping files are allowed even though no task owns them', async () => {
    const verdict = await createAuditor({ exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({
        changedFiles: [
          'src/features/export/index.ts',
          'src/features/export/index.test.ts',
          '.starling/runs/run-1.jsonl',
        ],
      }),
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.laneViolations).toEqual([]);
  });
});

describe('createAuditor — lane enforcement', () => {
  test('a lane violation fails even when tests pass and the reviewer approves', async () => {
    const llm = new MockLLM({ responses: [llmJson(passingVerdict())] });
    const changedFiles = ['src/features/export/index.ts', 'src/ui/render.ts'];
    const verdict = await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({ changedFiles }),
    );

    expect(verdict.pass).toBe(false);
    expect(verdict.laneViolations).toEqual(['src/ui/render.ts']);
    expect(verdict.checks.find((check) => check.name === 'lane')?.ok).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'tests')?.ok).toBe(true);
    expect(verdict.fixInstructions).toContain('outside this task');
    expect(verdict.fixInstructions).toContain('src/ui/render.ts');
    expect(verdict.summary).toContain('lane');
  });

  test('an empty owns list treats every change as a violation', async () => {
    const task = csvExportTask({ lane: { owns: [], reads: [] } });
    const verdict = await createAuditor({ exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({ task }),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.laneViolations).toEqual([
      'src/features/export/index.ts',
      'src/features/export/index.test.ts',
    ]);
  });
});

describe('createAuditor — deterministic checks', () => {
  test('an empty diff never passes and skips the reviewer', async () => {
    const llm = new MockLLM({ responses: [llmJson(passingVerdict())] });
    const empty: DiffSummary = { files: [], patch: '', truncated: false };
    const verdict = await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({ diff: empty, changedFiles: [] }),
    );

    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'non-empty')?.ok).toBe(false);
    const llmCheck = verdict.checks.find((check) => check.name === 'llm-review');
    expect(llmCheck?.detail).toContain('skipped');
    expect(llmCheck?.detail).toContain('empty diff');
    expect(llm.calls).toHaveLength(0);
    expect(verdict.fixInstructions).toContain('The diff is empty');
    expect(verdict.model).toEqual({ provider: 'starling', model: 'deterministic' });
  });

  test('failing tests fail the audit and put the output tail in the fix instructions', async () => {
    const failing = [
      'src/features/export/index.test.ts:',
      'FAIL expected "a,b" to be quoted as "\\"a,b\\""',
      'error: expect(received).toBe(expected)',
    ].join('\n');
    const fake = fakeExec((command) =>
      command.includes('bun test') ? { code: 1, stdout: '', stderr: failing } : { code: 0 },
    );
    const verdict = await createAuditor({
      llm: new MockLLM({ responses: [llmJson(passingVerdict())] }),
      exec: fake.fn,
    }).audit(makeAuditInput());

    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'tests')?.ok).toBe(false);
    expect(verdict.fixInstructions).toContain('Make `bun test` pass: it exited 1');
    expect(verdict.fixInstructions).toContain('FAIL expected "a,b" to be quoted');
    expect(verdict.summary).toContain('tests');
  });

  test('a test timeout is a recorded failure, not a thrown error', async () => {
    const fake = fakeExec((command) => {
      if (command.includes('bun test')) {
        throw new StarlingError('EXEC_TIMEOUT', 'bun test timed out after 600000ms');
      }
      return { code: 0 };
    });
    const verdict = await createAuditor({ exec: fake.fn }).audit(makeAuditInput());

    expect(verdict.pass).toBe(false);
    const tests = verdict.checks.find((check) => check.name === 'tests');
    expect(tests?.ok).toBe(false);
    expect(tests?.detail).toContain('timed out');
    expect(verdict.fixInstructions).toContain('timed out');
    expect(verdict.fixInstructions).toContain('600000 ms');
  });

  test('a missing test command is skipped and does not fail the audit', async () => {
    const llm = new MockLLM({ responses: [llmJson(passingVerdict())] });
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({ llm, exec: fake.fn }).audit(makeAuditInput({ testCommand: null }));

    expect(verdict.pass).toBe(true);
    expect(verdict.checks.find((check) => check.name === 'tests')?.detail).toContain(
      'no testCommand configured',
    );
    expect(fake.calls).toHaveLength(1);
  });

  test('a failing lint is advisory by default', async () => {
    const fake = fakeExec((command) =>
      command.includes('biome') ? { code: 1, stderr: 'src/features/export/index.ts:3 lint' } : okOutput(),
    );
    const verdict = await createAuditor({
      llm: new MockLLM({ responses: [llmJson(passingVerdict())] }),
      exec: fake.fn,
    }).audit(makeAuditInput());

    expect(verdict.pass).toBe(true);
    const lint = verdict.checks.find((check) => check.name === 'lint');
    expect(lint?.ok).toBe(false);
    expect(lint?.detail).toContain('non-blocking');
    expect(verdict.fixInstructions).toBeUndefined();
  });

  test('a failing lint fails the audit when lintBlocking is set', async () => {
    const fake = fakeExec((command) =>
      command.includes('biome') ? { code: 2, stderr: 'lint error on line 3' } : okOutput(),
    );
    const verdict = await createAuditor({
      exec: fake.fn,
      lintBlocking: true,
    }).audit(makeAuditInput());

    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'lint')?.ok).toBe(false);
    expect(verdict.fixInstructions).toContain('Make `bunx biome check .` pass: it exited 2');
    expect(verdict.fixInstructions).toContain('lint error on line 3');
  });

  test('a DoD that asks for tests fails deterministically even when the reviewer passes', async () => {
    const llm = new MockLLM({ responses: [llmJson(passingVerdict())] });
    const verdict = await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({ diff: csvDiff() }),
    );

    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((entry) => entry.name === 'missing-tests');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('requires tests');
    expect(check?.detail).toContain('A round-trip test covers commas, quotes and newlines');
    expect(verdict.fixInstructions).toContain('Add the tests the definition of done requires');
    // The reviewer is still consulted: the missing-tests check does not replace its judgment.
    expect(llm.calls).toHaveLength(1);
  });

  test('an advisory missing-tests check never fires on a test-only or type-only diff', async () => {
    const task = csvExportTask({
      definitionOfDone: ['bun test passes', 'No runtime behaviour changes'],
    });
    const verdict = await createAuditor({
      llm: new MockLLM({ responses: [llmJson(passingVerdict())] }),
      exec: fakeExec(() => okOutput()).fn,
    }).audit(makeAuditInput({ task }));

    expect(verdict.pass).toBe(true);
    const check = verdict.checks.find((entry) => entry.name === 'missing-tests');
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('does not ask for tests');
  });

  test('a repo map without a lint command records a skipped lint check', async () => {
    const verdict = await createAuditor({ exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({ lintCommand: null }),
    );
    const lint = verdict.checks.find((check) => check.name === 'lint');
    expect(verdict.pass).toBe(true);
    expect(lint?.ok).toBe(true);
    expect(lint?.detail).toContain('no lintCommand');
  });
});

describe('createAuditor — reviewer verdict', () => {
  test('the reviewer can fail the audit with its own numbered instructions', async () => {
    const llm = new MockLLM({
      responses: [
        llmJson(
          passingVerdict({
            pass: false,
            summary: 'Quoting is right but the required round-trip test is missing.',
            dod: passingVerdict().dod.map((entry) =>
              entry.item.includes('round-trip')
                ? { ...entry, met: false, evidence: 'no test file changed' }
                : entry,
            ),
            fixInstructions:
              '1. Add src/features/export/index.test.ts covering a title with a comma.\n2. Also cover a double quote and a newline.',
          }),
        ),
      ],
    });
    const verdict = await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn }).audit(makeAuditInput());

    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'llm-review')?.ok).toBe(false);
    expect(verdict.fixInstructions).toContain(
      'Add src/features/export/index.test.ts covering a title with a comma.',
    );
    expect(verdict.fixInstructions).toContain('Also cover a double quote and a newline.');
    expect(verdict.summary).toContain('round-trip test');
    expect(verdict.fixInstructions?.split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(3);
  });

  test('a reviewer that passes while a DoD item is unmet is rejected', async () => {
    const verdict = await createAuditor({
      llm: new MockLLM({
        responses: [
          llmJson(
            passingVerdict({
              dod: [
                { item: 'bun test passes', met: true, evidence: '12 pass' },
                {
                  item: 'A round-trip test covers commas, quotes and newlines',
                  met: false,
                  evidence: 'no test file in the diff',
                },
                {
                  item: 'The button is disabled when the list is empty',
                  met: true,
                  evidence: 'initExportButton',
                },
              ],
            }),
          ),
        ],
      }),
      exec: fakeExec(() => okOutput()).fn,
    }).audit(makeAuditInput());

    expect(verdict.pass).toBe(false);
    const review = verdict.checks.find((check) => check.name === 'llm-review');
    expect(review?.ok).toBe(false);
    expect(review?.detail).toContain('rejected');
    expect(verdict.fixInstructions).toContain('Definition of done not met');
    expect(verdict.fixInstructions).toContain('A round-trip test covers commas, quotes and newlines');
    expect(verdict.fixInstructions).toContain('no test file in the diff');
    // C1: the per-item judgments land on the verdict itself, so the drawer can show them.
    expect(verdict.dod).toEqual([
      { item: 'bun test passes', met: true, evidence: '12 pass' },
      {
        item: 'A round-trip test covers commas, quotes and newlines',
        met: false,
        evidence: 'no test file in the diff',
      },
      { item: 'The button is disabled when the list is empty', met: true, evidence: 'initExportButton' },
    ]);
  });

  test('drops empty evidence instead of storing an empty string', async () => {
    const verdict = await createAuditor({
      llm: new MockLLM({
        responses: [
          llmJson(
            passingVerdict({
              dod: [
                { item: 'bun test passes', met: true, evidence: '   ' },
                { item: 'docs updated', met: true, evidence: 'docs/epic-99.md' },
              ],
            }),
          ),
        ],
      }),
      exec: fakeExec(() => okOutput()).fn,
    }).audit(makeAuditInput());

    expect(verdict.dod).toEqual([
      { item: 'bun test passes', met: true },
      { item: 'docs updated', met: true, evidence: 'docs/epic-99.md' },
    ]);
  });

  test('a deterministic audit sets no dod, because nobody judged it', async () => {
    const verdict = await createAuditor({ exec: fakeExec(() => okOutput()).fn }).audit(makeAuditInput());
    expect(verdict.dod).toBeUndefined();
  });

  test('a configured reviewer that does not answer fails the audit: un-reviewed work never merges', async () => {
    const llm = new MockLLM({
      responder: () => {
        throw new StarlingError('LLM_ERROR', 'ollama is not running');
      },
    });
    const verdict = await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn }).audit(makeAuditInput());

    expect(verdict.pass).toBe(false);
    const review = verdict.checks.find((check) => check.name === 'llm-review');
    expect(review?.ok).toBe(false);
    expect(review?.detail).toContain('reviewer unavailable');
    expect(review?.detail).toContain('LLM_ERROR');
    expect(verdict.model).toEqual({ provider: 'starling', model: 'deterministic' });
    expect(verdict.summary).toContain('did not answer');
    // The fix instruction must not send the agent off to rewrite working code.
    expect(verdict.fixInstructions).toContain('infrastructure failure, not a problem with the diff');
    expect(verdict.fixInstructions).toContain('do not rewrite working code');
  });

  test('reviewer-unavailable is only an infrastructure retry: a clean diff plus no reviewer still passes', async () => {
    const verdict = await createAuditor({ llm: 'off', exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput(),
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.fixInstructions).toBeUndefined();
  });

  test('without a configured LLM the audit is deterministic and says so', async () => {
    const verdict = await createAuditor({ exec: fakeExec(() => okOutput()).fn }).audit(makeAuditInput());

    expect(verdict.pass).toBe(true);
    expect(verdict.checks.find((check) => check.name === 'llm-review')?.detail).toContain(
      'no reviewer model configured',
    );
    expect(verdict.model).toEqual({ provider: 'starling', model: 'deterministic' });
  });

  test('the csv-export diff with no test file is flagged and fails with "add tests" instructions', async () => {
    const llm = new MockLLM({
      responder: (request) => {
        const prompt = request.messages[0]?.content ?? '';
        expect(prompt).toContain('NEW BEHAVIOUR WITHOUT NEW TESTS: YES');
        expect(prompt).toContain('A round-trip test covers commas, quotes and newlines');
        return llmJson(
          passingVerdict({
            pass: false,
            summary: 'The export works but the new behaviour has no tests.',
            dod: passingVerdict().dod.map((entry) =>
              entry.item.includes('round-trip') ? { ...entry, met: false, evidence: 'no test file' } : entry,
            ),
            fixInstructions:
              '1. Add a colocated test file src/features/export/index.test.ts covering commas, quotes, newlines and the header row.',
          }),
        );
      },
    });
    const verdict = await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn }).audit(
      makeAuditInput({ diff: csvDiff() }),
    );

    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'missing-tests')?.ok).toBe(false);
    expect(verdict.fixInstructions).toContain('Add the tests the definition of done requires');
    expect(verdict.fixInstructions).toContain('Add a colocated test file src/features/export/index.test.ts');
    expect(verdict.fixInstructions).toContain('Definition of done not met');
    expect(llm.calls).toHaveLength(1);
    const request = llm.calls[0];
    expect(request?.role).toBe('auditor');
    expect(request?.temperature).toBe(0);
    expect(request?.system).toContain('New behaviour requires tests');
  });

  test('the reviewer prompt survives truncation with the lane file still visible', async () => {
    const big = 'x'.repeat(6_000);
    const patch = [
      csvDiff().patch,
      'diff --git a/src/ui/styles.css b/src/ui/styles.css',
      'index 1111111..2222222 100644',
      '--- a/src/ui/styles.css',
      '+++ b/src/ui/styles.css',
      '@@ -1,1 +1,1 @@',
      `-${big}`,
      `+${big}y`,
      'diff --git a/src/features/help/index.ts b/src/features/help/index.ts',
      '--- /dev/null',
      '+++ b/src/features/help/index.ts',
      '@@ -0,0 +1,1 @@',
      '+export const help = true;',
    ].join('\n');
    const task = csvExportTask({
      lane: { owns: ['src/features/export/**', 'src/ui/styles.css'], reads: [] },
    });
    const diff: DiffSummary = {
      files: [
        { path: 'src/features/export/index.ts', added: 14, removed: 0 },
        { path: 'src/ui/styles.css', added: 1, removed: 1 },
        { path: 'src/features/help/index.ts', added: 1, removed: 0 },
      ],
      patch,
      truncated: false,
    };
    const llm = new MockLLM({ responses: [llmJson(passingVerdict())] });
    await createAuditor({ llm, exec: fakeExec(() => okOutput()).fn, maxDiffChars: 4_000 }).audit(
      makeAuditInput({ task, diff, changedFiles: diff.files.map((file) => file.path) }),
    );

    const prompt = llm.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain('diff: truncated to fit the review budget');
    expect(prompt).toContain('src/features/export/index.ts');
    expect(prompt).toContain('export function exportCsv');
    expect(prompt).toContain('omitted files: src/features/help/index.ts');
  });

  test('carries the attempt number into the request', async () => {
    const llm = new MockLLM({
      responses: [llmJson(passingVerdict()), llmJson(passingVerdict())],
    });
    const auditor = createAuditor({ llm, exec: fakeExec(() => okOutput()).fn });
    const verdict = await auditor.audit(makeAuditInput({ attempt: 2 }));

    expect(verdict.attempt).toBe(2);
    expect(llm.calls[0]?.messages[0]?.content).toContain('attempt 2');
    expect(verdict.taskKey).toBe('csv-export');
    expect(BRANCH).toBe('starling/run-1/csv-export');
  });
});

describe('createAuditor — command policy (Epic 103, SEC-11)', () => {
  test('mode off skips the tests and lint checks without spawning anything', async () => {
    const fake = fakeExec(() => ({ code: 1, stderr: 'should not run' }));
    const verdict = await createAuditor({
      exec: fake.fn,
      commandPolicy: { mode: 'off' },
    }).audit(makeAuditInput());

    expect(fake.calls).toHaveLength(0);
    expect(verdict.pass).toBe(true);
    expect(verdict.checks.find((check) => check.name === 'tests')).toMatchObject({
      ok: true,
      detail: 'skipped: tests disabled by policy',
    });
    expect(verdict.checks.find((check) => check.name === 'lint')?.detail).toBe(
      'skipped: lint disabled by policy',
    );
  });

  test('an allowlisted test command still runs, with CI=1 in the child environment', async () => {
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({
      exec: fake.fn,
      commandPolicy: { mode: 'allowlist' },
    }).audit(makeAuditInput());

    expect(verdict.pass).toBe(true);
    expect(fake.calls[0]?.cmd).toEqual(['sh', '-c', 'bun test']);
    expect(fake.calls[0]?.opts.env?.CI).toBe('1');
  });

  test('a blocked test command fails the check without suspending the lint check', async () => {
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({
      exec: fake.fn,
      commandPolicy: { mode: 'allowlist' },
    }).audit(makeAuditInput({ testCommand: 'rm -rf .' }));

    expect(verdict.pass).toBe(false);
    const tests = verdict.checks.find((check) => check.name === 'tests');
    expect(tests?.ok).toBe(false);
    expect(tests?.detail).toContain('blocked by command policy');
    expect(tests?.detail).toContain('not in the allowlist');
    expect(fake.calls.map((call) => call.cmd[2])).toEqual(['bunx biome check .']);
    expect(verdict.fixInstructions).toContain('blocked by the command policy');
    expect(verdict.fixInstructions).toContain('configuration problem, not a problem with the diff');
  });

  test('shell chaining behind an allowed prefix is blocked', async () => {
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({
      exec: fake.fn,
      commandPolicy: { mode: 'allowlist' },
    }).audit(makeAuditInput({ testCommand: 'bun test && touch pwned' }));

    expect(verdict.pass).toBe(false);
    expect(fake.calls.map((call) => call.cmd[2])).not.toContain('bun test && touch pwned');
    expect(verdict.checks.find((check) => check.name === 'tests')?.detail).toContain(
      'blocked by command policy',
    );
  });

  test('a blocked lint command is advisory unless lintBlocking is set', async () => {
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({
      exec: fake.fn,
      commandPolicy: { mode: 'allowlist' },
    }).audit(makeAuditInput({ lintCommand: 'node scripts/lint.js' }));

    expect(verdict.pass).toBe(true);
    const lint = verdict.checks.find((check) => check.name === 'lint');
    expect(lint?.ok).toBe(false);
    expect(lint?.detail).toContain('blocked by command policy');
    expect(lint?.detail).toContain('non-blocking');

    const blocking = await createAuditor({
      exec: fakeExec(() => okOutput()).fn,
      commandPolicy: { mode: 'allowlist' },
      lintBlocking: true,
    }).audit(makeAuditInput({ lintCommand: 'node scripts/lint.js' }));
    expect(blocking.pass).toBe(false);
    expect(blocking.fixInstructions).toContain('blocked by the command policy');
  });

  test('a custom allow list is honoured', async () => {
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({
      exec: fake.fn,
      commandPolicy: { mode: 'allowlist', allow: ['custom-test'] },
    }).audit(makeAuditInput({ testCommand: 'custom-test --ci', lintCommand: null }));

    expect(verdict.pass).toBe(true);
    expect(fake.calls[0]?.cmd).toEqual(['sh', '-c', 'custom-test --ci']);
  });
});

describe('createAuditor — where the tests ran (Epic 103, deliverable 4)', () => {
  test('without a task worktree the tests check says it ran in the hub repo', async () => {
    const fake = fakeExec(() => okOutput());
    const verdict = await createAuditor({ exec: fake.fn, llm: 'off' }).audit(
      makeAuditInput({ worktreePath: null }),
    );

    expect(verdict.pass).toBe(true);
    expect(fake.calls[0]?.opts.cwd).toBe('/tmp/sky-todo');
    expect(verdict.checks.find((check) => check.name === 'tests')?.detail).toContain(
      '(no task worktree: ran in the hub repo)',
    );
  });

  test('requireWorktree fails the tests check instead, with a harness fix instruction', async () => {
    const verdict = await createAuditor({
      exec: fakeExec(() => okOutput()).fn,
      requireWorktree: true,
    }).audit(makeAuditInput({ worktreePath: null }));

    expect(verdict.pass).toBe(false);
    const tests = verdict.checks.find((check) => check.name === 'tests');
    expect(tests?.ok).toBe(false);
    expect(tests?.detail).toContain('(no task worktree: ran in the hub repo)');
    expect(tests?.detail).toContain('requireWorktree is set');
    expect(verdict.fixInstructions).toContain('no worktree');
  });

  test('requireWorktree does not fire when the run has a worktree', async () => {
    const verdict = await createAuditor({
      exec: fakeExec(() => okOutput()).fn,
      requireWorktree: true,
    }).audit(makeAuditInput());

    expect(verdict.pass).toBe(true);
    expect(verdict.checks.find((check) => check.name === 'tests')?.detail).not.toContain('no task worktree');
  });
});
