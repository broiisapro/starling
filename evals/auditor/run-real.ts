/**
 * `--impl real` for the auditor evals, wired to a real reviewer model.
 *
 * Why this file exists: `evals/real.ts` instantiates `createAuditor({})` with no `llm`, so the
 * shared CLI measures the deterministic checks only — the reviewer never runs. The auditor lane may
 * not edit `evals/real.ts` (see the FIX REQUEST in `.orchestrator/handbacks/44-auditor-tuning.md`),
 * so the model wiring lives here instead and imports the real packages by path, exactly like
 * `evals/lib/core.ts` does.
 *
 *   STARLING_LLM_PROFILE=opencode OPENCODE_SERVER_PASSWORD=… \
 *     bun evals/auditor/run-real.ts --set seeded --tag baseline
 *
 * `--set seeded` scores the twelve tuning cases, `--set heldout` the four generalisation cases that
 * were written before tuning and never used to tune, `--set all` both. Reports land in
 * `evals/results/auditor-<date>-<tag>.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createAuditor } from '../../packages/auditor/src/index.ts';
import { createLLMFromEnv } from '../../packages/llm/src/index.ts';
import type { AuditVerdict } from '../lib/core';
import { RESULTS_DIR } from '../lib/paths';
import { formatTable } from '../lib/table';
import type { AuditorCase } from './case';
import { findAuditorCase, loadAuditorCases } from './cases';
import { makeAuditInputFor } from './input';
import { type AuditorScore, scoreAuditor } from './score';
import { cleanupCaseWorktrees } from './worktree';

export type CaseSet = 'seeded' | 'heldout' | 'all';

export interface RealEvalOptions {
  set: CaseSet;
  tag: string;
  caseName?: string;
  out?: string;
  /** Print each case as it finishes; the run takes minutes against a real model. */
  progress?: boolean;
}

export interface RealEvalReport {
  suite: 'auditor';
  impl: 'real';
  set: CaseSet;
  tag: string;
  generatedAt: string;
  date: string;
  model: string;
  /** One entry per case: the answer-key score plus the verdict's own evidence, for the changelog. */
  cases: RealCaseResult[];
  summary: {
    caseCount: number;
    accuracy: number;
    falsePassRate: number;
    falseFailRate: number;
    fixQuality: number;
    laneDetection: number;
    passed: boolean;
  };
}

/** `AuditCaseResult` plus what the verdict said, so a MISS can be explained from the report alone. */
export type RealCaseResult = AuditorScore['results'][number] & {
  model: string;
  summary: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

export const AUDITOR_ACCURACY_THRESHOLD = 0.9;
export const AUDITOR_FALSE_PASS_LIMIT = 0;

/** Parse `--set seeded|heldout|all`, `--tag X`, `--case name`, `--out path`, `--quiet`. */
export function parseRealArgs(argv: string[]): RealEvalOptions {
  let set: CaseSet = 'seeded';
  let tag = 'run';
  let caseName: string | undefined;
  let out: string | undefined;
  let progress = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const next = (): string => {
      if (inline !== undefined) return inline;
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${flag}`);
      i += 1;
      return value;
    };
    if (flag === '--set') {
      const value = next();
      if (value !== 'seeded' && value !== 'heldout' && value !== 'all') {
        throw new Error(`--set must be seeded, heldout or all, got "${value}"`);
      }
      set = value;
    } else if (flag === '--tag') {
      tag = next();
    } else if (flag === '--case') {
      caseName = next();
    } else if (flag === '--out') {
      out = next();
    } else if (flag === '--quiet') {
      progress = false;
    } else {
      throw new Error(`Unknown argument "${arg}"`);
    }
  }

  return {
    set,
    tag,
    progress,
    ...(caseName === undefined ? {} : { caseName }),
    ...(out === undefined ? {} : { out }),
  };
}

export function casesForSet(set: CaseSet, caseName?: string): AuditorCase[] {
  const all = loadAuditorCases();
  const pool =
    set === 'seeded'
      ? all.filter((entry) => !entry.heldOut)
      : set === 'heldout'
        ? all.filter((entry) => entry.heldOut)
        : all;
  return caseName === undefined ? pool : [findAuditorCase(pool, caseName)];
}

/**
 * Run one real audit per case, in order.
 *
 * Sequential on purpose: the reviewer is a shared, rate-limited endpoint on a machine already
 * running ~20 agents, and a slow run is easier to trust than a fast one that tripped a retry.
 * Whatever happens, temporary worktrees are removed before returning.
 */
export async function runRealEval(options: RealEvalOptions): Promise<RealEvalReport> {
  const cases = casesForSet(options.set, options.caseName);
  const llm = createLLMFromEnv();
  const auditor = createAuditor({ llm });
  const verdicts: Array<{ testCase: AuditorCase; verdict: AuditVerdict }> = [];
  let model = 'unknown';

  try {
    for (const testCase of cases) {
      const verdict = await auditor.audit(makeAuditInputFor(testCase));
      verdicts.push({ testCase, verdict });
      model = `${verdict.model.provider}/${verdict.model.model}`;
      if (options.progress === true) {
        const mark = verdict.pass === testCase.expected.pass ? 'ok  ' : 'MISS';
        process.stderr.write(`  ${mark} ${testCase.name} — ${verdict.summary.slice(0, 100)}\n`);
      }
    }
  } finally {
    cleanupCaseWorktrees();
  }

  const score = scoreAuditor(verdicts);
  const byCase = new Map(verdicts.map(({ testCase, verdict }) => [testCase.name, verdict]));
  const caseResults: RealCaseResult[] = score.results.map((result) => {
    const verdict = byCase.get(result.caseName);
    return {
      ...result,
      model: verdict === undefined ? '?' : `${verdict.model.provider}/${verdict.model.model}`,
      summary: verdict?.summary ?? '',
      checks:
        verdict?.checks.map((check) => ({ name: check.name, ok: check.ok, detail: check.detail })) ?? [],
    };
  });
  const report: RealEvalReport = {
    suite: 'auditor',
    impl: 'real',
    set: options.set,
    tag: options.tag,
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    model,
    cases: caseResults,
    summary: {
      caseCount: score.caseCount,
      accuracy: score.accuracy,
      falsePassRate: score.falsePassRate,
      falseFailRate: score.falseFailRate,
      fixQuality: score.fixQuality,
      laneDetection: score.laneDetection,
      passed: score.accuracy >= AUDITOR_ACCURACY_THRESHOLD && score.falsePassRate <= AUDITOR_FALSE_PASS_LIMIT,
    },
  };
  return report;
}

export function formatRealReport(report: RealEvalReport): string {
  const headers = ['case', 'expect', 'verdict', 'fix', 'lane'];
  const rows = report.cases.map((result) => [
    result.caseName,
    result.expectedPass ? 'pass' : 'fail',
    result.actualPass ? 'pass' : 'fail',
    result.fixQuality === null ? '-' : result.fixQuality.toFixed(2),
    result.laneOk ? 'ok' : 'BAD',
  ]);
  const s = report.summary;
  return [
    `auditor (real, ${report.model}) · set=${report.set} · tag=${report.tag} · ${s.caseCount} case(s)`,
    formatTable(headers, rows),
    `${s.caseCount} case(s) · accuracy ${s.accuracy.toFixed(3)} · false-pass ${s.falsePassRate.toFixed(3)}` +
      ` · false-fail ${s.falseFailRate.toFixed(3)} · fix ${s.fixQuality.toFixed(3)}` +
      ` · lane ${s.laneDetection.toFixed(3)} · ${s.passed ? 'PASS' : 'FAIL'}`,
    ...report.cases
      .filter((result) => !result.correct)
      .map(
        (result) =>
          `  MISS ${result.caseName}: expected ${result.expectedPass ? 'pass' : 'fail'} — ` +
          `${result.summary.replace(/\s+/g, ' ').slice(0, 160)}`,
      ),
  ].join('\n');
}

export function writeRealReport(report: RealEvalReport, out?: string): string {
  const path = resolve(out ?? join(RESULTS_DIR, `auditor-${report.date}-${report.tag}.json`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

if (import.meta.main) {
  try {
    const options = parseRealArgs(Bun.argv.slice(2));
    const report = await runRealEval(options);
    const path = writeRealReport(report, options.out);
    console.log(formatRealReport(report));
    console.log(`report: ${path}`);
    process.exitCode = report.summary.passed ? 0 : 1;
  } catch (err) {
    console.error(`auditor real eval: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 64;
  }
}
