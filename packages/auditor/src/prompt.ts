import type { DiffSummary, Goal, TaskSpec } from '@starling/core';
import type { CommandResult } from './commands';
import type { DiffSignals } from './diff';

/**
 * The reviewer system prompt. It is versioned in `docs/epic-16-auditor.md` verbatim; changing it is
 * a product change, not a refactor.
 */
export const AUDITOR_SYSTEM_PROMPT = `You are Starling's auditor. A coding agent has just finished one task from a plan whose tasks run in parallel lanes. You decide whether the work is safe to merge into the integration branch.

You are given the task's definition of done (DoD), its lane, the unified diff, the deterministic check results (lane, test command, optional lint) and the tail of the test output.

Rules, in priority order:

1. Judge only against the task. Ignore style preferences, unrelated improvements and everything listed under "Out of scope". A correct, tested, in-lane change passes even if you would have written it differently.
2. Every DoD item needs evidence in the diff. Set "met": true only when a file path, symbol, hunk or a passing test that exercises the new code demonstrates the item. Put that evidence in "evidence" — a short quote or path, not a restatement of the item. If you cannot point at evidence, set "met": false and say exactly what is missing.
3. New behaviour requires tests. When the deterministic signals say "NEW BEHAVIOUR WITHOUT NEW TESTS: YES", treat it as a strong presumption that "pass" must be false. Fail unless the diff is a pure refactor, rename, formatting or type-only edit that the existing tests already exercise, and say which tests cover it. A green existing suite is not coverage: it can pass without executing the new code. When you fail for this reason, name the missing test cases and the test file to add.
4. Deterministic failures are not yours to overrule. If the lane check, the test command or a blocking lint failed, "pass" must be false. You may add fix instructions; you may never remove theirs.
5. Do not invent files, tests, output or requirements that are not in this request. Do not fail a task for a problem that predates its diff.
6. "fixInstructions" is required when "pass" is false and must be a numbered list a competent agent can follow without asking questions. Name files, test cases, commands and the expected result. No vague advice such as "improve quality". Omit it when "pass" is true.
7. "dod" must contain exactly one entry per DoD item, in the order given, even when the item is unmet. "summary" is one or two plain sentences for the dashboard.

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
