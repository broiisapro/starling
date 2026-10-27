import type { AuditCheck, AuditInput, Auditor, AuditVerdict, LLM, ModelRef } from '@starling/core';
import { exec as coreExec, isStarlingError, systemClock } from '@starling/core';
import type { CommandResult } from './commands';
import { runShellCommand } from './commands';
import type { MissingTestsSignal } from './diff';
import { missingTestsSignal, prioritiseDiff, signalsFor } from './diff';
import { checkLane } from './lane';
import { chooseAuditorModel, createLlmFor, defaultLlmMode } from './model-choice';
import { AUDITOR_SYSTEM_PROMPT, buildAuditPrompt } from './prompt';
import type {
  AuditorLlmOption,
  AuditorLlmVerdict,
  CreateAuditorOptions,
  ResolvedAuditorOptions,
} from './types';
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
  missingTestsDetail,
} from './verdict';

/**
 * Output budget for one review. The verdict is small, but reasoning models bill their thinking
 * against this cap: at 1 400 a long DoD occasionally came back truncated, which surfaced as
 * `LLM_BAD_JSON` and (correctly) failed the audit as un-reviewed (Epic 44 measurement).
 */
const LLM_MAX_TOKENS = 2_000;

/** Resolve the reviewer once, memoised: a run audits many tasks with the same model. */
function lazyReviewer(mode: AuditorLlmOption, opts: CreateAuditorOptions): () => Promise<LLM | undefined> {
  if (mode !== 'auto') {
    const fixed = mode === 'off' ? undefined : mode;
    return () => Promise.resolve(fixed);
  }
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? systemClock;
  const log = (level: 'info' | 'warn', msg: string): void => {
    opts.bus?.publish({ type: 'log', runId: '*', ts: clock.now(), payload: { level, msg } });
  };
  let pending: Promise<LLM | undefined> | undefined;
  return () => {
    pending ??= (async () => {
      const choice = await chooseAuditorModel({
        env,
        ...(opts.profile === undefined ? {} : { profile: opts.profile }),
      });
      if (choice.warning !== undefined) log('warn', choice.warning);
      log(
        'info',
        `auditor model: ${choice.model.provider}/${choice.model.model} (profile ${choice.profile})`,
      );
      return createLlmFor(choice, { env });
    })();
    return pending;
  };
}

function resolveOptions(options: CreateAuditorOptions): ResolvedAuditorOptions {
  const mode = options.llm ?? defaultLlmMode(options.env ?? process.env);
  return {
    llmFor: lazyReviewer(mode, options),
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
  /**
   * True when a reviewer was configured for this audit, so a skip means "the model did not answer"
   * rather than "nobody was asked". That distinction is the difference between an offline demo and
   * a silently un-reviewed merge, so it decides whether the check passes (Epic 44).
   */
  expected: boolean;
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
  missing: MissingTestsSignal,
): Promise<LlmOutcome> {
  if (input.diff.patch.trim() === '') {
    // The empty diff already fails `non-empty`; adding a reviewer failure would only be noise.
    return { checked: false, expected: false, skippedReason: 'empty diff, nothing to review' };
  }
  let llm: LLM | undefined;
  try {
    llm = await opts.llmFor();
  } catch (err) {
    return {
      checked: false,
      expected: true,
      skippedReason: `reviewer unavailable (${errorMessage(err)})`,
    };
  }
  if (llm === undefined) {
    return { checked: false, expected: false, skippedReason: 'no reviewer model configured' };
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
    missingTests: missing,
    patch: prioritised.patch,
    truncated: prioritised.truncated || input.diff.truncated,
    omittedFiles: prioritised.omittedFiles,
  });

  try {
    const response = await llm.completeJson(
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
        expected: true,
        skippedReason: 'reviewer returned no parsed JSON verdict',
        model: response.model,
      };
    }
    return { verdict, model: response.model, checked: true, expected: true };
  } catch (err) {
    return {
      checked: false,
      expected: true,
      skippedReason: `reviewer unavailable (${errorMessage(err)})`,
    };
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

  // 4. missing-tests — a DoD that asks for tests, source changed, no test file: unfinished work.
  const missingStarted = performance.now();
  const missing = missingTestsSignal(ctx.task.definitionOfDone, files);
  checks.push(
    makeCheck(
      'missing-tests',
      !missing.missing,
      missingTestsDetail(missing),
      performance.now() - missingStarted,
    ),
  );

  // 5. lint — advisory unless `lintBlocking`, but the result is always recorded.
  const lintStarted = performance.now();
  const lintCommand = ctx.map.lintCommand;
  const lint = await runShellCommand(opts.exec, lintCommand, worktree, opts.commandTimeoutMs);
  const lintOk = !lint.ran || (lint.code === 0 && !lint.timedOut && lint.error === undefined);
  const lintDetail = lint.ran
    ? `${commandDetail(lint, 'lint')}${!opts.lintBlocking && !lintOk ? '; non-blocking' : ''}`
    : 'lint: skipped (no lintCommand in the repo map)';
  checks.push(makeCheck('lint', lintOk, lintDetail, performance.now() - lintStarted));

  // 6. llm-review — judgment against the DoD; skipped (not failed) when unavailable.
  const llmStarted = performance.now();
  const outcome = await reviewWithLlm(input, opts, files, tests, lint, lane.violations, missing);
  const llmVerdict = outcome.verdict;
  const allDodMet = llmVerdict === undefined || llmVerdict.dod.every((entry) => entry.met);
  const llmOk = llmVerdict === undefined ? !outcome.expected : llmVerdict.pass && allDodMet;
  const reviewerFailed = llmVerdict === undefined && outcome.expected;
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

  const llmPass = llmOk;
  const pass =
    lane.ok && !emptyDiff && testsOk && !missing.missing && (!opts.lintBlocking || lintOk) && llmPass;

  const fixInstructions = pass
    ? undefined
    : buildFixInstructions({
        task: ctx.task,
        lane,
        emptyDiff,
        missingTests: missing,
        testCommand: ctx.testCommand,
        tests,
        lintCommand,
        lint,
        lintBlocking: opts.lintBlocking,
        commandTimeoutMs: opts.commandTimeoutMs,
        llmVerdict,
        ...(reviewerFailed
          ? { reviewerFailure: outcome.skippedReason ?? 'the reviewer did not answer' }
          : {}),
      });

  const summary = buildSummary({
    pass,
    checks,
    laneViolations: lane.violations,
    llmSummary: llmVerdict !== undefined && (pass || !llmVerdict.pass) ? llmVerdict.summary : undefined,
    llmConsulted: outcome.checked,
    llmSkippedReason: outcome.checked ? undefined : outcome.skippedReason,
    reviewerFailed,
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
  if (llmVerdict !== undefined) {
    // The reviewer's per-item DoD judgments, verbatim, so the drawer can show which requirement
    // failed without re-reading the prompt. Empty evidence is dropped rather than stored as "".
    verdict.dod = llmVerdict.dod.map((entry) =>
      entry.evidence.trim() === ''
        ? { item: entry.item, met: entry.met }
        : { item: entry.item, met: entry.met, evidence: entry.evidence },
    );
  }
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
