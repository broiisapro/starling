import type { AuditCheck, AuditInput, Auditor, AuditVerdict, ModelRef } from '@starling/core';
import { exec as coreExec, isStarlingError, systemClock } from '@starling/core';
import type { CommandResult } from './commands';
import { runShellCommand } from './commands';
import { prioritiseDiff, signalsFor } from './diff';
import { checkLane } from './lane';
import { AUDITOR_SYSTEM_PROMPT, buildAuditPrompt } from './prompt';
import type { AuditorLlmVerdict, CreateAuditorOptions, ResolvedAuditorOptions } from './types';
import {
  AuditorLlmVerdictSchema,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_DIFF_CHARS,
  DETERMINISTIC_MODEL,
} from './types';
import {
  buildFixInstructions,
  buildSummary,
  commandDetail,
  diffDetail,
  laneDetail,
  makeCheck,
} from './verdict';

const LLM_MAX_TOKENS = 1_400;

function resolveOptions(options: CreateAuditorOptions): ResolvedAuditorOptions {
  return {
    llm: options.llm,
    exec: options.exec ?? coreExec,
    clock: options.clock ?? systemClock,
    commandTimeoutMs:
      options.commandTimeoutMs !== undefined && Number.isFinite(options.commandTimeoutMs)
        ? Math.max(0, options.commandTimeoutMs)
        : DEFAULT_COMMAND_TIMEOUT_MS,
    lintBlocking: options.lintBlocking ?? false,
    maxDiffChars:
      options.maxDiffChars !== undefined && Number.isFinite(options.maxDiffChars)
        ? Math.max(0, options.maxDiffChars)
        : DEFAULT_MAX_DIFF_CHARS,
  };
}

interface LlmOutcome {
  verdict?: AuditorLlmVerdict;
  model?: ModelRef;
  checked: boolean;
  skippedReason?: string;
}

function errorMessage(err: unknown): string {
  if (isStarlingError(err)) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function reviewWithLlm(
  input: AuditInput,
  opts: ResolvedAuditorOptions,
  files: readonly string[],
  tests: CommandResult,
  lint: CommandResult,
  laneViolations: readonly string[],
): Promise<LlmOutcome> {
  if (opts.llm === undefined) {
    return { checked: false, skippedReason: 'no reviewer model configured' };
  }
  if (input.diff.patch.trim() === '') {
    return { checked: false, skippedReason: 'empty diff, nothing to review' };
  }

  const signals = signalsFor(input.diff, files);
  const prioritised = prioritiseDiff(input.diff.patch, {
    owns: input.ctx.task.lane.owns,
    maxChars: opts.maxDiffChars,
  });
  const prompt = buildAuditPrompt({
    task: input.ctx.task,
    goal: input.ctx.goal,
    lockedDecisions: input.ctx.plan.lockedDecisions,
    branch: input.ctx.branch,
    attempt: input.attempt,
    changedFiles: files,
    diff: input.diff,
    testCommand: input.ctx.testCommand,
    lintCommand: input.ctx.map.lintCommand,
    testResult: tests,
    lintResult: lint,
    laneViolations,
    signals,
    patch: prioritised.patch,
    truncated: prioritised.truncated || input.diff.truncated,
    omittedFiles: prioritised.omittedFiles,
  });

  try {
    const response = await opts.llm.completeJson(
      {
        role: 'auditor',
        system: AUDITOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: LLM_MAX_TOKENS,
      },
      AuditorLlmVerdictSchema,
    );
    const verdict = response.parsed;
    if (verdict === undefined) {
      return {
        checked: false,
        skippedReason: 'reviewer returned no parsed JSON verdict',
        model: response.model,
      };
    }
    return { verdict, model: response.model, checked: true };
  } catch (err) {
    return { checked: false, skippedReason: `reviewer unavailable (${errorMessage(err)})` };
  }
}

async function audit(input: AuditInput, opts: ResolvedAuditorOptions): Promise<AuditVerdict> {
  const { ctx, run, attempt } = input;
  const files =
    input.changedFiles.length > 0 ? input.changedFiles : input.diff.files.map((file) => file.path);
  const owns = ctx.task.lane.owns;
  const worktree = run.worktreePath ?? ctx.goal.repoPath;
  const checks: AuditCheck[] = [];

  // 1. lane — every changed file must be owned by the task.
  const laneStarted = performance.now();
  const lane = checkLane(files, owns);
  checks.push(makeCheck('lane', lane.ok, laneDetail(lane, owns), performance.now() - laneStarted));

  // 2. non-empty — an empty diff is never a finished task, even when tests pass.
  const emptyStarted = performance.now();
  const emptyDiff = files.length === 0 || input.diff.patch.trim() === '';
  const added = input.diff.files.reduce((sum, file) => sum + file.added, 0);
  const removed = input.diff.files.reduce((sum, file) => sum + file.removed, 0);
  checks.push(
    makeCheck(
      'non-empty',
      !emptyDiff,
      diffDetail(files.length, added, removed, emptyDiff),
      performance.now() - emptyStarted,
    ),
  );

  // 3. tests — run the detected command in the worktree, never in the hub repo.
  const testStarted = performance.now();
  const tests = await runShellCommand(opts.exec, ctx.testCommand, worktree, opts.commandTimeoutMs);
  const testsOk = !tests.ran || (tests.code === 0 && !tests.timedOut && tests.error === undefined);
  checks.push(
    makeCheck(
      'tests',
      testsOk,
      tests.ran ? commandDetail(tests, 'tests') : 'tests: skipped (no testCommand configured)',
      performance.now() - testStarted,
    ),
  );

  // 4. lint — advisory unless `lintBlocking`, but the result is always recorded.
  const lintStarted = performance.now();
  const lintCommand = ctx.map.lintCommand;
  const lint = await runShellCommand(opts.exec, lintCommand, worktree, opts.commandTimeoutMs);
  const lintOk = !lint.ran || (lint.code === 0 && !lint.timedOut && lint.error === undefined);
  const lintDetail = lint.ran
    ? `${commandDetail(lint, 'lint')}${!opts.lintBlocking && !lintOk ? '; non-blocking' : ''}`
    : 'lint: skipped (no lintCommand in the repo map)';
  checks.push(makeCheck('lint', lintOk, lintDetail, performance.now() - lintStarted));

  // 5. llm-review — judgment against the DoD; skipped (not failed) when unavailable.
  const llmStarted = performance.now();
  const outcome = await reviewWithLlm(input, opts, files, tests, lint, lane.violations);
  const llmVerdict = outcome.verdict;
  const allDodMet = llmVerdict === undefined || llmVerdict.dod.every((entry) => entry.met);
  const llmOk = llmVerdict === undefined ? true : llmVerdict.pass && allDodMet;
  const contradiction =
    llmVerdict?.pass === true && !allDodMet ? ' [rejected: reviewer passed while a DoD item was unmet]' : '';
  let llmDetail: string;
  if (outcome.checked) {
    const model = outcome.model;
    const who = model === undefined ? 'reviewer' : `${model.provider}/${model.model}`;
    const summary = llmVerdict?.summary.trim() === '' ? '(no summary)' : (llmVerdict?.summary ?? '');
    llmDetail = `${who}: ${summary}${contradiction}`;
  } else {
    llmDetail = `skipped: ${outcome.skippedReason ?? 'not consulted'}`;
  }
  checks.push(makeCheck('llm-review', llmOk, llmDetail, performance.now() - llmStarted));

  const llmPass = outcome.checked && llmVerdict !== undefined ? llmOk : true;
  const pass = lane.ok && !emptyDiff && testsOk && (!opts.lintBlocking || lintOk) && llmPass;

  const fixInstructions = pass
    ? undefined
    : buildFixInstructions({
        task: ctx.task,
        lane,
        emptyDiff,
        testCommand: ctx.testCommand,
        tests,
        lintCommand,
        lint,
        lintBlocking: opts.lintBlocking,
        commandTimeoutMs: opts.commandTimeoutMs,
        llmVerdict,
      });

  const summary = buildSummary({
    pass,
    checks,
    laneViolations: lane.violations,
    llmSummary: llmVerdict !== undefined && (pass || !llmVerdict.pass) ? llmVerdict.summary : undefined,
    llmConsulted: outcome.checked,
    llmSkippedReason: outcome.checked ? undefined : outcome.skippedReason,
  });

  const verdict: AuditVerdict = {
    taskKey: ctx.task.key,
    attempt,
    pass,
    checks,
    laneViolations: lane.violations,
    summary,
    model: outcome.model ?? DETERMINISTIC_MODEL,
    ts: opts.clock.now(),
  };
  if (fixInstructions !== undefined) verdict.fixInstructions = fixInstructions;
  return verdict;
}

/**
 * Create Starling's quality gate (ARCHITECTURE §6 `Auditor`).
 *
 * Checks run in a fixed order and are all recorded: `lane`, `non-empty`, `tests`, `lint`,
 * `llm-review`. Check failures never throw; only programming errors (an invalid worktree path in
 * `exec`, which `runShellCommand` also catches) could escape.
 */
export function createAuditor(options: CreateAuditorOptions = {}): Auditor {
  const opts = resolveOptions(options);
  return {
    audit: (input: AuditInput) => audit(input, opts),
  };
}
