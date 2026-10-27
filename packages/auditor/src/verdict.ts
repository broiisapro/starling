import type { AuditCheck, TaskSpec } from '@starling/core';
import type { CommandResult } from './commands';
import { describeCommand, tailText } from './commands';
import type { LaneCheckResult } from './lane';
import type { AuditorLlmVerdict } from './types';

/**
 * One audit check. The duration rides in its own field (`AuditCheck.durationMs`, added in C1) rather
 * than being appended to `detail`, so the human-readable text stays parseable and the UI can chart
 * the slow check directly.
 */
export function makeCheck(name: string, ok: boolean, detail: string, durationMs: number): AuditCheck {
  return { name, ok, detail, durationMs: Math.max(0, Math.round(durationMs)) };
}

export function laneDetail(result: LaneCheckResult, owns: readonly string[]): string {
  if (result.checked === 0) return 'no changed files to check';
  if (result.ok) return `all ${result.checked} changed file(s) match the lane (${owns.join(', ')})`;
  const shown = result.violations.slice(0, 5).join(', ');
  const more = result.violations.length > 5 ? ` and ${result.violations.length - 5} more` : '';
  return `${result.violations.length} file(s) outside the lane: ${shown}${more}`;
}

export function diffDetail(files: number, added: number, removed: number, empty: boolean): string {
  if (empty) return 'diff is empty: no files changed';
  return `diff touches ${files} file(s), +${added}/-${removed} lines`;
}

export function commandDetail(result: CommandResult, label: string): string {
  const status = describeCommand(result);
  return result.ran ? `${label}: ${status}` : `${label}: skipped`;
}

export interface FixInstructionInput {
  task: TaskSpec;
  lane: LaneCheckResult;
  emptyDiff: boolean;
  testCommand?: string;
  tests: CommandResult;
  lintCommand?: string;
  lint: CommandResult;
  lintBlocking: boolean;
  commandTimeoutMs: number;
  llmVerdict?: AuditorLlmVerdict;
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim();
}

function splitModelInstructions(raw: string): string[] {
  return raw
    .split('\n')
    .map(stripListMarker)
    .filter((line) => line !== '')
    .map((line) => line.replace(/\s+/g, ' ').trim());
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item
      .toLowerCase()
      .replace(/[.!:;\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function commandFailureInstruction(
  command: string | undefined,
  result: CommandResult,
  timeoutMs: number,
): string | undefined {
  if (command === undefined || !result.ran) return undefined;
  if (result.timedOut) {
    return `Make \`${command}\` finish: it timed out after ${timeoutMs} ms. Run it yourself in the worktree, fix the hang or the runaway test, then re-run it.`;
  }
  if (result.error !== undefined) {
    return `Make \`${command}\` runnable: ${result.error}. Check the command and the worktree's dependencies, then re-run it.`;
  }
  if (result.code === 0) return undefined;
  const tail = tailText(result.output, 1_200);
  const output = tail.trim() === '' ? '(no output)' : tail;
  return `Make \`${command}\` pass: it exited ${result.code ?? 'unknown'}. Last output:\n\`\`\`\n${output}\n\`\`\``;
}

/**
 * Merge deterministic failures with the reviewer's judgment into one numbered list. Deterministic
 * instructions come first because they are facts; the model's instructions are deduped against them.
 */
export function buildFixInstructions(input: FixInstructionInput): string | undefined {
  const items: string[] = [];
  const owns = input.task.lane.owns;

  for (const violation of input.lane.violations) {
    items.push(
      `Revert or move the change to \`${violation}\`: it is outside this task's lane (${owns.join(', ') || 'no owned paths'}).`,
    );
  }

  if (input.emptyDiff) {
    const deliverables =
      input.task.deliverables.length === 0 ? input.task.goal : input.task.deliverables.join('; ');
    items.push(`The diff is empty. Implement the deliverables and commit them: ${deliverables}.`);
  }

  const testsInstruction = commandFailureInstruction(input.testCommand, input.tests, input.commandTimeoutMs);
  if (testsInstruction !== undefined) items.push(testsInstruction);

  if (input.lintBlocking) {
    const lintInstruction = commandFailureInstruction(input.lintCommand, input.lint, input.commandTimeoutMs);
    if (lintInstruction !== undefined) items.push(lintInstruction);
  }

  if (input.llmVerdict !== undefined) {
    for (const entry of input.llmVerdict.dod) {
      if (entry.met) continue;
      const evidence = entry.evidence.trim() === '' ? 'no evidence in the diff' : entry.evidence.trim();
      items.push(`Definition of done not met — "${entry.item}": ${evidence.slice(0, 500)}.`);
    }
    if (input.llmVerdict.fixInstructions !== undefined) {
      items.push(...splitModelInstructions(input.llmVerdict.fixInstructions));
    }
    if (items.length === 0 && input.llmVerdict.pass === false) {
      const finding = input.llmVerdict.summary.trim();
      if (finding !== '') items.push(`Address the reviewer's finding: ${finding}`);
    }
  }

  const unique = dedupe(items);
  if (unique.length === 0) return undefined;
  return unique.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export interface SummaryInput {
  pass: boolean;
  checks: readonly AuditCheck[];
  laneViolations: readonly string[];
  llmSummary?: string;
  llmConsulted: boolean;
  llmSkippedReason?: string;
}

export function buildSummary(input: SummaryInput): string {
  if (input.pass) {
    if (input.llmSummary !== undefined && input.llmSummary.trim() !== '') return input.llmSummary.trim();
    if (input.llmConsulted) return 'All checks passed and the definition of done is met.';
    if (input.llmSkippedReason !== undefined) {
      return `All deterministic checks passed; reviewer skipped (${input.llmSkippedReason}).`;
    }
    return 'All deterministic checks passed; no reviewer model was configured.';
  }

  const failed = input.checks.filter((check) => !check.ok).map((check) => check.name);
  const reason = failed.length > 0 ? `failed ${failed.join(', ')}` : 'failed the audit';
  const parts = [`Audit ${reason}.`];
  if (input.laneViolations.length > 0) {
    parts.push(`${input.laneViolations.length} lane violation(s).`);
  }
  if (input.llmSummary !== undefined && input.llmSummary.trim() !== '') {
    parts.push(input.llmSummary.trim());
  } else if (input.llmSkippedReason !== undefined) {
    parts.push(`Reviewer skipped: ${input.llmSkippedReason}.`);
  }
  parts.push('See fix instructions.');
  return parts.join(' ');
}
