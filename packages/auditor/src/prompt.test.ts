import { describe, expect, test } from 'bun:test';
import { diffSignals } from './diff.ts';
import type { AuditPromptArgs } from './prompt.ts';
import { AUDITOR_SYSTEM_PROMPT, buildAuditPrompt } from './prompt.ts';
import { makeAuditInput } from './test-support.ts';

function promptArgs(): AuditPromptArgs {
  const input = makeAuditInput();
  return {
    task: input.ctx.task,
    goal: input.ctx.goal,
    lockedDecisions: input.ctx.plan.lockedDecisions,
    branch: input.ctx.branch,
    attempt: 1,
    changedFiles: input.changedFiles,
    diff: input.diff,
    testCommand: 'bun test',
    lintCommand: 'bunx biome check .',
    testResult: {
      ran: true,
      command: 'bun test',
      code: 0,
      timedOut: false,
      output: '12 pass\n0 fail',
      tail: '12 pass\n0 fail',
      durationMs: 412,
    },
    lintResult: {
      ran: true,
      command: 'bunx biome check .',
      code: 0,
      timedOut: false,
      output: 'Checked 12 files',
      tail: 'Checked 12 files',
      durationMs: 88,
    },
    laneViolations: [],
    signals: diffSignals(input.changedFiles),
    patch: input.diff.patch,
    truncated: false,
    omittedFiles: [],
  };
}

describe('AUDITOR_SYSTEM_PROMPT', () => {
  test('demands evidence for every DoD item', () => {
    expect(AUDITOR_SYSTEM_PROMPT).toContain('Every DoD item needs evidence in the diff');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('"met": false');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('one entry per DoD item');
  });

  test('makes new behaviour without tests fail, with concrete cases', () => {
    expect(AUDITOR_SYSTEM_PROMPT).toContain('New behaviour requires tests');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('NEW BEHAVIOUR WITHOUT NEW TESTS: YES');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('name the missing test cases');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('A green existing suite is not coverage');
  });

  test('forbids overruling deterministic failures and asking for out-of-scope work', () => {
    expect(AUDITOR_SYSTEM_PROMPT).toContain('Deterministic failures are not yours to overrule');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('Ignore style preferences');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('Do not invent files');
  });

  test('asks for JSON only, in the schema the auditor validates', () => {
    expect(AUDITOR_SYSTEM_PROMPT).toContain('Respond with JSON only');
    expect(AUDITOR_SYSTEM_PROMPT).toContain('"fixInstructions"');
  });
});

describe('buildAuditPrompt', () => {
  test('matches the committed snapshot', () => {
    expect(buildAuditPrompt(promptArgs())).toMatchSnapshot();
  });

  test('carries the task, the numbered DoD, lane and repository decisions', () => {
    const prompt = buildAuditPrompt(promptArgs());
    expect(prompt).toContain('Task `csv-export` — "CSV export" (attempt 1)');
    expect(prompt).toContain('1. bun test passes');
    expect(prompt).toContain('2. A round-trip test covers commas, quotes and newlines');
    expect(prompt).toContain('owns: src/features/export/**');
    expect(prompt).toContain('Vanilla TypeScript + Vite, no UI framework');
    expect(prompt).toContain('Out of scope:\n- Importing CSV');
  });

  test('flags an implementation with no test change', () => {
    const prompt = buildAuditPrompt(promptArgs());
    expect(prompt).toContain('test files changed: no');
    expect(prompt).toContain('NEW BEHAVIOUR WITHOUT NEW TESTS: YES');
  });

  test('clears the signal when a test file changed', () => {
    const args = promptArgs();
    args.changedFiles = ['src/features/export/index.ts', 'src/features/export/index.test.ts'];
    args.signals = diffSignals(args.changedFiles);
    const prompt = buildAuditPrompt(args);
    expect(prompt).toContain('test files changed: yes');
    expect(prompt).toContain('NEW BEHAVIOUR WITHOUT NEW TESTS: no');
  });

  test('lists lane violations and the changed-file stats', () => {
    const args = promptArgs();
    args.laneViolations = ['src/ui/render.ts'];
    const prompt = buildAuditPrompt(args);
    expect(prompt).toContain('- lane: 1 violation(s): src/ui/render.ts');
    expect(prompt).toContain('- `src/features/export/index.ts` (+14/-0)');
  });

  test('says when the diff was truncated and which files were omitted', () => {
    const args = promptArgs();
    args.truncated = true;
    args.omittedFiles = ['src/features/help/index.ts', 'src/ui/render.ts'];
    const prompt = buildAuditPrompt(args);
    expect(prompt).toContain(
      'diff: truncated to fit the review budget; omitted files: src/features/help/index.ts, src/ui/render.ts',
    );
  });

  test('shows an empty diff explicitly and skips absent commands', () => {
    const args = promptArgs();
    args.patch = '';
    args.diff = { files: [], patch: '', truncated: false };
    args.changedFiles = [];
    args.testCommand = undefined;
    args.lintCommand = undefined;
    args.testResult = { ...args.testResult, ran: false, output: '', tail: '' };
    args.lintResult = { ...args.lintResult, ran: false, output: '', tail: '' };
    const prompt = buildAuditPrompt(args);
    expect(prompt).toContain('(empty diff)');
    expect(prompt).toContain('- test command: skipped (no command configured)');
    expect(prompt).toContain('- lint command: skipped (no command configured)');
    expect(prompt).toContain('- (none)');
  });
});
