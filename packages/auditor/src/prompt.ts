import type { DiffSummary, Goal, TaskSpec } from '@starling/core';
import type { CommandResult } from './commands';
import type { DiffSignals, MissingTestsSignal } from './diff';

/**
 * The reviewer system prompt. It is versioned in `docs/epic-44-auditor-tuning.md` verbatim with the
 * measured effect of each edit; changing it is a product change, not a refactor.
 */
export const AUDITOR_SYSTEM_PROMPT = `You are Starling's auditor. A coding agent has just finished one task from a plan whose tasks run in parallel lanes. You decide whether the work is safe to merge into the integration branch.

You are given the task's definition of done (DoD), its lane, the unified diff, the deterministic check results (lane, test command, optional lint, missing tests) and the tail of the test output.

Rules, in priority order:

1. Judge only against the task. Ignore style preferences, unrelated improvements and everything listed under "Out of scope". A correct, tested, in-lane change passes even if you would have written it differently.
2. Every DoD item needs evidence in the diff. Set "met": true only when a file path, symbol, hunk or a passing test that exercises the new code demonstrates the item. Put that evidence in "evidence" — a short quote or path, not a restatement of the item. If you cannot point at evidence, set "met": false and say exactly what is missing.
   Your verdict must agree with your own words. When your summary or evidence describes the behaviour as missing, partial, unimplemented, untested or trivial, that DoD item is unmet and "pass" is false. A "pass": true whose summary says the work is not there is always wrong, so read your summary once before you answer.
3. Judge the task you were given, not the task you would have written. When the DoD asks only for documentation, a test, a type or a rename, that artefact is the deliverable: fail it only for being wrong, incomplete or absent, never for not also changing runtime code or adding tests nobody asked for. A test-only task is complete when the regression test exists and the suite runs it.
4. New behaviour requires tests. When the deterministic signals say "NEW BEHAVIOUR WITHOUT NEW TESTS: YES" or "MISSING TESTS THE DEFINITION OF DONE REQUIRES: YES", a test the task asked for is absent: "pass" must be false. The only exception is a pure refactor, rename, formatting or type-only edit that the existing tests already exercise, and then you must say which tests cover it. A green existing suite is not coverage: it can pass without executing the new code. When you fail for this reason, name the missing test cases and the test file to add.
5. A test can be present and still prove nothing. Read the added assertions, not the file name: treat a test that only asserts a constant (for example \`expect(true).toBe(true)\`), a test marked \`.skip\`/\`.todo\`, and a test that never calls the new code as "no test", and put the assertion you relied on in the evidence. When the DoD forbids skipped tests, a skipped test is an automatic fail even if the suite is green.
6. Removing public API is a behaviour change. A "simplify" or "refactor" task does not authorise deleting an exported function, type or constant that other files import; when the DoD says the existing surface keeps working, a removed export is an unmet item.
7. Deterministic failures are not yours to overrule. If the lane check, the test command, the missing-tests check or a blocking lint failed, "pass" must be false. You may add fix instructions; you may never remove theirs.
8. Read the test tail for what it says, not for what it omits. The tail is the last lines of the command's output, not the whole run, and the diff may add tests that the command executed under another file name. A short tail, or a tail that does not mention a test file from the diff, is not evidence that the suite is red or that a test does not exist.
9. Do not invent files, tests, output or requirements that are not in this request. Do not fail a task for a problem that predates its diff.
10. "fixInstructions" is required when "pass" is false and must be a numbered list a competent agent can follow without asking questions. Name files, test cases, commands and the expected result. No vague advice such as "improve quality". Omit it when "pass" is true.
11. "dod" must contain exactly one entry per DoD item, in the order given, even when the item is unmet. "summary" is one or two plain sentences for the dashboard.

Respond with JSON only — no prose, no markdown fences — matching this shape:
{"pass": boolean, "summary": string, "dod": [{"item": string, "met": boolean, "evidence": string}], "fixInstructions"?: string}`;

export interface AuditPromptArgs {
  task: TaskSpec;
  goal: Goal;
  lockedDecisions: readonly string[];
  branch: string;
  attempt: number;
  changedFiles: readonly string[];
  diff: DiffSummary;
  testCommand?: string;
  lintCommand?: string;
  testResult: CommandResult;
  lintResult: CommandResult;
  laneViolations: readonly string[];
  signals: DiffSignals;
  /** Deterministic verdict on the tests the DoD explicitly asks for (Epic 44). */
  missingTests: MissingTestsSignal;
  /** Patch after lane-first truncation (may differ from `diff.patch`). */
  patch: string;
  truncated: boolean;
  omittedFiles: readonly string[];
}

function bullets(items: readonly string[], empty: string): string {
  return items.length === 0 ? `- ${empty}` : items.map((item) => `- ${item}`).join('\n');
}

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function commandSignal(label: string, command: string | undefined, result: CommandResult): string {
  if (command === undefined || command.trim() === '') return `- ${label}: skipped (no command configured)`;
  if (result.blockedReason !== undefined) {
    return `- ${label} \`${command}\`: blocked by command policy (${result.blockedReason})`;
  }
  if (result.skippedReason !== undefined) {
    return `- ${label} \`${command}\`: skipped (${result.skippedReason})`;
  }
  if (!result.ran) return `- ${label} \`${command}\`: skipped`;
  if (result.timedOut) return `- ${label} \`${command}\`: timed out`;
  if (result.error !== undefined) return `- ${label} \`${command}\`: could not run (${result.error})`;
  return `- ${label} \`${command}\`: ${result.code === 0 ? 'passed' : `FAILED (exit ${result.code ?? 'unknown'})`}`;
}

function changedFileList(diff: DiffSummary, changedFiles: readonly string[]): string {
  const stats = new Map(diff.files.map((file) => [file.path, file]));
  const paths = changedFiles.length > 0 ? changedFiles : diff.files.map((file) => file.path);
  if (paths.length === 0) return '- (none)';
  return paths
    .map((path) => {
      const stat = stats.get(path);
      return stat === undefined ? `- \`${path}\`` : `- \`${path}\` (+${stat.added}/-${stat.removed})`;
    })
    .join('\n');
}

/** Why the missing-tests signal fired, in the reviewer's words rather than a bare boolean. */
function missingTestsHint(signal: MissingTestsSignal): string {
  const first = signal.items[0];
  if (first === undefined) return '';
  if (!signal.missing) return ` (the DoD asks for tests and a test file changed: "${first}")`;
  return ` (the DoD requires tests but no test file changed: "${first}")`;
}

/** Build the single user message the auditor sends. Deterministic: no clocks, durations or ids. */
export function buildAuditPrompt(args: AuditPromptArgs): string {
  const { task, goal, diff, testResult, lintResult, signals } = args;
  const lane = task.lane;
  const laneSignal =
    args.laneViolations.length === 0
      ? '- lane: clean (every changed file matches the task lane)'
      : `- lane: ${args.laneViolations.length} violation(s): ${args.laneViolations.join(', ')}`;
  const diffSignal = args.truncated
    ? `- diff: truncated to fit the review budget${args.omittedFiles.length > 0 ? `; omitted files: ${args.omittedFiles.join(', ')}` : ''}`
    : '- diff: complete';
  const testTail = testResult.ran && testResult.tail.trim() !== '' ? testResult.tail : '(no output)';

  return `# Audit request

Task \`${task.key}\` — "${task.title}" (attempt ${args.attempt})
Branch: \`${args.branch}\`
Overall goal: ${goal.text}

## Task brief

Goal: ${task.goal}

Deliverables:
${bullets(task.deliverables, 'none listed')}

Out of scope:
${bullets(task.outOfScope, 'nothing stated')}

## Definition of done

One \`dod\` entry is required for each item below, in this order:
${task.definitionOfDone.length === 0 ? '(none — judge the deliverables above)' : numbered(task.definitionOfDone)}

## Repository decisions that apply to every task

${bullets(args.lockedDecisions, 'none')}

## Lane

- owns: ${lane.owns.length === 0 ? '(empty lane — every change is a violation)' : lane.owns.join(', ')}
- reads (read-only): ${lane.reads.length === 0 ? '(none)' : lane.reads.join(', ')}

## Deterministic signals

${laneSignal}
${commandSignal('test command', args.testCommand, testResult)}
${commandSignal('lint command', args.lintCommand, lintResult)}
- test files changed: ${signals.testsChanged ? 'yes' : 'no'}
- NEW BEHAVIOUR WITHOUT NEW TESTS: ${signals.newBehaviourWithoutTests ? 'YES' : 'no'}
- MISSING TESTS THE DEFINITION OF DONE REQUIRES: ${args.missingTests.missing ? 'YES' : 'no'}${missingTestsHint(args.missingTests)}
${diffSignal}

## Changed files (${args.changedFiles.length})

${changedFileList(diff, args.changedFiles)}

## Test output tail

\`\`\`text
${testTail}
\`\`\`

## Diff

\`\`\`diff
${args.patch.trim() === '' ? '(empty diff)' : args.patch}
\`\`\`

Return only the JSON object described in the system prompt.`;
}
