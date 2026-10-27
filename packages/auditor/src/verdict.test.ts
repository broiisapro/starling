import { describe, expect, test } from 'bun:test';
import type { CommandResult } from './commands.ts';
import { csvExportTask } from './test-support.ts';
import type { FixInstructionInput } from './verdict.ts';
import { buildFixInstructions, buildSummary, makeCheck } from './verdict.ts';

function command(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    ran: true,
    command: 'bun test',
    code: 0,
    timedOut: false,
    output: '12 pass\n0 fail',
    tail: '12 pass\n0 fail',
    durationMs: 10,
    ...overrides,
  };
}

function instructionsInput(overrides: Partial<FixInstructionInput> = {}): FixInstructionInput {
  return {
    task: csvExportTask(),
    lane: { ok: true, violations: [], checked: 1 },
    emptyDiff: false,
    testCommand: 'bun test',
    tests: command(),
    lintCommand: 'bunx biome check .',
    lint: command({ command: 'bunx biome check .' }),
    lintBlocking: false,
    commandTimeoutMs: 600_000,
    ...overrides,
  };
}

describe('makeCheck', () => {
  test('appends the duration trailer AuditCheck cannot express', () => {
    expect(makeCheck('tests', true, 'exit 0', 12.4)).toEqual({
      name: 'tests',
      ok: true,
      detail: 'exit 0 (12 ms)',
    });
  });
});

describe('buildFixInstructions', () => {
  test('returns undefined when nothing failed', () => {
    expect(buildFixInstructions(instructionsInput())).toBeUndefined();
  });

  test('turns each lane violation into its own revert instruction', () => {
    const text = buildFixInstructions(
      instructionsInput({
        lane: { ok: false, violations: ['src/ui/render.ts', 'package.json'], checked: 3 },
      }),
    );
    expect(text).toContain('1. Revert or move the change to `src/ui/render.ts`');
    expect(text).toContain('2. Revert or move the change to `package.json`');
    expect(text).toContain('src/features/export/**');
  });

  test('an empty diff names the deliverables to implement', () => {
    const text = buildFixInstructions(instructionsInput({ emptyDiff: true }));
    expect(text).toContain('The diff is empty');
    expect(text).toContain('src/features/export/index.ts exports');
  });

  test('a failing test command embeds the output tail', () => {
    const text = buildFixInstructions(
      instructionsInput({
        tests: command({
          code: 1,
          output: 'FAIL quoting: expected "a,b"',
          tail: 'FAIL quoting: expected "a,b"',
        }),
      }),
    );
    expect(text).toContain('Make `bun test` pass: it exited 1');
    expect(text).toContain('FAIL quoting: expected "a,b"');
  });

  test('a timed-out test command reports the configured timeout', () => {
    const text = buildFixInstructions(
      instructionsInput({
        tests: command({ code: undefined, timedOut: true, error: 'killed' }),
        commandTimeoutMs: 90_000,
      }),
    );
    expect(text).toContain('it timed out after 90000 ms');
  });

  test('non-blocking lint failures are not in the fix instructions', () => {
    const text = buildFixInstructions(
      instructionsInput({
        lint: command({ command: 'bunx biome check .', code: 1, tail: 'lint error' }),
      }),
    );
    expect(text).toBeUndefined();
  });

  test('blocking lint failures are in the fix instructions', () => {
    const text = buildFixInstructions(
      instructionsInput({
        lintBlocking: true,
        lint: command({ command: 'bunx biome check .', code: 2, output: 'lint error', tail: 'lint error' }),
      }),
    );
    expect(text).toContain('Make `bunx biome check .` pass: it exited 2');
    expect(text).toContain('lint error');
  });

  test('merges unmet DoD items and the reviewer instructions into one numbered list', () => {
    const text = buildFixInstructions(
      instructionsInput({
        tests: command({ code: 1, tail: '1 fail' }),
        llmVerdict: {
          pass: false,
          summary: 'Missing tests.',
          dod: [
            { item: 'bun test passes', met: false, evidence: '1 failing test' },
            { item: 'Round-trip test', met: false, evidence: '' },
          ],
          fixInstructions: '1. Add src/features/export/index.test.ts.\n2. Cover commas and quotes.',
        },
      }),
    );
    const lines = (text ?? '').split('\n');
    expect(lines.filter((line) => /^\d+\. /.test(line))).toHaveLength(5);
    expect(text).toContain('Definition of done not met — "Round-trip test": no evidence in the diff.');
    expect(text).toContain('4. Add src/features/export/index.test.ts.');
    expect(text).toContain('5. Cover commas and quotes.');
  });

  test('falls back to the reviewer summary when a failing verdict has no instructions', () => {
    const text = buildFixInstructions(
      instructionsInput({
        llmVerdict: {
          pass: false,
          summary: 'Quoting is incomplete for embedded double quotes.',
          dod: [],
        },
      }),
    );
    expect(text).toContain(
      "Address the reviewer's finding: Quoting is incomplete for embedded double quotes.",
    );
  });

  test('dedupes the reviewer repeating a deterministic instruction', () => {
    const text = buildFixInstructions(
      instructionsInput({
        lane: { ok: false, violations: ['src/ui/render.ts'], checked: 2 },
        llmVerdict: {
          pass: false,
          summary: 'Out of lane.',
          dod: [],
          fixInstructions:
            "Revert or move the change to `src/ui/render.ts`: it is outside this task's lane (src/features/export/**).",
        },
      }),
    );
    expect((text ?? '').split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(1);
  });
});

describe('buildSummary', () => {
  test('uses the reviewer summary on a clean pass', () => {
    expect(
      buildSummary({
        pass: true,
        checks: [makeCheck('lane', true, 'ok', 1)],
        laneViolations: [],
        llmSummary: 'Looks good.',
        llmConsulted: true,
      }),
    ).toBe('Looks good.');
  });

  test('names the failed checks and the lane count on a failure', () => {
    const summary = buildSummary({
      pass: false,
      checks: [
        makeCheck('lane', false, 'violation', 1),
        makeCheck('tests', false, 'exit 1', 1),
        makeCheck('llm-review', true, 'skipped', 1),
      ],
      laneViolations: ['src/ui/render.ts'],
      llmConsulted: false,
      llmSkippedReason: 'no reviewer model configured',
    });
    expect(summary).toContain('failed lane, tests');
    expect(summary).toContain('1 lane violation(s)');
    expect(summary).toContain('Reviewer skipped: no reviewer model configured');
    expect(summary).toContain('See fix instructions');
  });

  test('explains a skipped reviewer on a deterministic pass', () => {
    const summary = buildSummary({
      pass: true,
      checks: [makeCheck('lane', true, 'ok', 1)],
      laneViolations: [],
      llmConsulted: false,
      llmSkippedReason: 'reviewer unavailable (LLM_ERROR: down)',
    });
    expect(summary).toContain('All deterministic checks passed');
    expect(summary).toContain('LLM_ERROR');
  });
});
