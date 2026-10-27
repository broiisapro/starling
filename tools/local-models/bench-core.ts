/**
 * bench-core.ts — the scoring and safety maths, kept pure and separate from the HTTP loop so the
 * numbers in a result file can be re-derived (and tested) without touching a model.
 */

import type { CaseExpectation } from './cases';
import { type CallResult, type Verdict, validateVerdict } from './ollama';

/** What one answer means. `correct` is the benchmark's only definition of "right". */
export interface Judgement {
  correct: boolean;
  passMatches: boolean;
  jsonValid: boolean;
  missingMentions: string[];
  verdict: Verdict | null;
  parseError?: string;
}

/** One request/answer pair. `repeat` is 0-based: the same case is asked `--repeat` times. */
export interface AttemptRecord {
  caseKey: string;
  repeat: number;
  transport: 'v1' | 'native' | 'none';
  /** What the corpus says this case needs, so a report can print "expected false". */
  expectedPass: boolean;
  ttftMs: number | null;
  latencyMs: number;
  completionTokens: number | null;
  tokensPerSec: number | null;
  judgement: Judgement;
  error?: string;
  /** The model's answer, truncated. Kept so a surprising score can be explained later. */
  rawResponse: string;
}

export interface CaseOutcome {
  key: string;
  /** Strict: a case counts only when every repeat of it was judged correctly. */
  correct: boolean;
  attempts: number;
}

export interface ModelBenchResult {
  model: string;
  profile: string;
  status: 'ok' | 'aborted';
  abortReason?: string;
  startedAt: number;
  finishedAt: number;
  correct: number;
  total: number;
  accuracy: number;
  jsonValidRate: number;
  ttftMsMean: number | null;
  latencyMsMean: number | null;
  tokensPerSecMean: number | null;
  transports: { v1: number; native: number; none: number };
  cases: CaseOutcome[];
  attempts: AttemptRecord[];
  residentGb: number | null;
  freeRamBeforeGb: number | null;
  freeRamAfterGb: number | null;
  alreadyResident: boolean;
  unloaded: boolean;
}

const round2 = (n: number): number => Number(n.toFixed(2));

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

const contains = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Judge one answer: the verdict must match the expected `pass`, the JSON must be well formed, and
 * the summary must name the thing that is wrong (the `mustMention` token). Reuses the smoke test's
 * verdict validator so the two tools cannot disagree about what "valid JSON" means.
 */
export function judgeAnswer(text: string, expect: CaseExpectation): Judgement {
  const { parsed, checks } = validateVerdict(text, { expectPass: expect.pass });
  const shapeChecks = checks.filter(
    (c) => c.name === 'json-parses' || c.name.startsWith('shape-') || c.name === 'no-extra-keys',
  );
  const jsonValid = parsed !== null && shapeChecks.every((c) => c.ok);
  const passMatches = parsed !== null && parsed.pass === expect.pass;

  const said = parsed ? `${parsed.summary} ${parsed.fixInstructions ?? ''}` : text;
  const missingMentions = expect.mustMention.filter((term) => !contains(said, term));

  const judgement: Judgement = {
    correct: passMatches && jsonValid && missingMentions.length === 0,
    passMatches,
    jsonValid,
    missingMentions,
    verdict: parsed,
  };

  const parseError = checks.find((c) => c.name === 'json-parses' && !c.ok)?.detail;
  if (parseError !== undefined) judgement.parseError = parseError;
  return judgement;
}

/** One case is correct only when every repeat of it was correct. */
export function caseOutcomes(attempts: AttemptRecord[], caseKeys: string[]): CaseOutcome[] {
  return caseKeys.map((key) => {
    const mine = attempts.filter((a) => a.caseKey === key);
    return {
      key,
      correct: mine.length > 0 && mine.every((a) => a.judgement.correct),
      attempts: mine.length,
    };
  });
}

export interface SummariseInput {
  model: string;
  profile: string;
  startedAt: number;
  finishedAt: number;
  attempts: AttemptRecord[];
  caseKeys: string[];
  abortReason?: string;
  residentGb: number | null;
  freeRamBeforeGb: number | null;
  freeRamAfterGb: number | null;
  alreadyResident: boolean;
  unloaded: boolean;
}

/** Turn raw attempts into the numbers the table, the JSON file and the recommender consume. */
export function summariseModel(input: SummariseInput): ModelBenchResult {
  const outcomes = caseOutcomes(input.attempts, input.caseKeys);
  const correct = outcomes.filter((o) => o.correct).length;
  // An aborted model is scored against the whole corpus: the cases it never reached are not done.
  const total = input.caseKeys.length;
  const answered = input.attempts.length;

  const transports = { v1: 0, native: 0, none: 0 };
  let jsonValid = 0;
  for (const a of input.attempts) {
    transports[a.transport] += 1;
    if (a.judgement.jsonValid) jsonValid += 1;
  }

  const ttfts = input.attempts.flatMap((a) => (a.ttftMs === null ? [] : [a.ttftMs]));
  const tokens = input.attempts.flatMap((a) => (a.tokensPerSec === null ? [] : [a.tokensPerSec]));

  const result: ModelBenchResult = {
    model: input.model,
    profile: input.profile,
    status: input.abortReason ? 'aborted' : 'ok',
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    correct,
    total,
    accuracy: total === 0 ? 0 : round2(correct / total),
    jsonValidRate: answered === 0 ? 0 : round2(jsonValid / answered),
    ttftMsMean: mean(ttfts),
    latencyMsMean: mean(input.attempts.map((a) => a.latencyMs)),
    tokensPerSecMean: mean(tokens),
    transports,
    cases: outcomes,
    attempts: input.attempts,
    residentGb: input.residentGb,
    freeRamBeforeGb: input.freeRamBeforeGb,
    freeRamAfterGb: input.freeRamAfterGb,
    alreadyResident: input.alreadyResident,
    unloaded: input.unloaded,
  };
  if (input.abortReason !== undefined) result.abortReason = input.abortReason;
  return result;
}

/**
 * An OOM-ish failure: Ollama returns 500 with a memory message, or the runner dies mid-stream.
 * The first one of these aborts the model — retrying a model that cannot fit only makes the
 * machine swap (it is exactly how Epic 02 took the laptop to 4% free RAM).
 */
export function isMemoryFailure(result: CallResult): boolean {
  const text = `${result.error ?? ''}`.toLowerCase();
  if (text.includes('out of memory') || text.includes('insufficient memory')) return true;
  if (text.includes('memory allocation') || text.includes('failed to allocate')) return true;
  if (text.includes('ggml_backend') || text.includes('not enough memory')) return true;
  return result.status >= 500 && /\bmemory\b|\boom\b/.test(text);
}

/** Status 0 is our marker in ollama.ts for "the request never reached the server". */
export function isUnreachable(result: CallResult): boolean {
  if (result.status !== 0) return false;
  const text = `${result.error ?? ''}`.toLowerCase();
  return (
    text.includes('request failed') || text.includes('connection refused') || text.includes('fetch failed')
  );
}

// ── safety rails ────────────────────────────────────────────────────────

export const MAX_OPENCODE_PROCESSES = 4;

export interface RailInput {
  openCodeProcesses: number;
  freeRamGb: number | null;
  /** Required free RAM before a model may be loaded, in GB. */
  maxRamGb: number;
}

export interface RailResult {
  ok: boolean;
  blocking: string[];
  warnings: string[];
}

/**
 * Refuse to start when the machine is already full: more than four opencode sessions would each
 * lose their context to swap, and a cold 18 GB model needs real headroom, not the last gigabyte.
 * `--force` is the caller's business; this function only says what is wrong.
 */
export function checkRails(input: RailInput): RailResult {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (input.openCodeProcesses > MAX_OPENCODE_PROCESSES) {
    blocking.push(
      `${input.openCodeProcesses} opencode processes are running (limit ${MAX_OPENCODE_PROCESSES}); ` +
        'finish or stop them, then re-run. --force overrides.',
    );
  }
  if (input.freeRamGb === null) {
    warnings.push('free RAM could not be measured, so the memory rail is blind for this run.');
  } else if (input.freeRamGb < input.maxRamGb) {
    blocking.push(
      `only ${input.freeRamGb} GB of RAM is free and ${input.maxRamGb} GB of headroom is required; ` +
        'close the heavy apps, then re-run. --force overrides.',
    );
  }
  return { ok: blocking.length === 0, blocking, warnings };
}
