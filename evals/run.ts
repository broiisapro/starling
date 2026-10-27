/**
 * Evals harness CLI.
 *
 *   bun evals/run.ts planner|auditor --impl mock|real [--case name] [--out path]
 *
 * `mock` feeds hand-written reference answers through `@starling/core/testing`'s MockPlanner and
 * MockAuditor, which validates the *harness* (a below-perfect score means a case and its reference
 * drifted). `real` loads `@starling/planner` / `@starling/auditor` through dynamic imports and is
 * Wave 2-only: it needs the real packages and a configured model (ARCHITECTURE L23 keeps it out of
 * Wave 1 runs and tests).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findAuditorCase, loadAuditorCases } from './auditor/cases';
import { makeAuditInputFor } from './auditor/input';
import { referenceVerdict } from './auditor/reference';
import { type AuditorScore, scoreAuditor } from './auditor/score';
import {
  type AuditVerdict,
  type Goal,
  type Plan,
  type Planner,
  type RepoMap,
  StarlingError,
} from './lib/core';
import { MockAuditor, MockPlanner, makeGoal } from './lib/core-testing';
import { RESULTS_DIR } from './lib/paths';
import { formatTable } from './lib/table';
import { findPlannerCase, loadPlannerCases, loadRepoMap } from './planner/cases';
import { referencePlan } from './planner/reference';
import { type PlanScore, scorePlan } from './planner/score';
import { loadRealAuditor, loadRealPlanner } from './real';

export type Suite = 'planner' | 'auditor';
export type Impl = 'mock' | 'real';

export interface CliOptions {
  suite: Suite;
  impl: Impl;
  caseName?: string;
  out?: string;
}

export const PLANNER_CASE_THRESHOLD = 0.85;
export const AUDITOR_ACCURACY_THRESHOLD = 0.9;
export const AUDITOR_FALSE_PASS_LIMIT = 0.15;

interface PlannerReport {
  suite: 'planner';
  impl: Impl;
  generatedAt: string;
  date: string;
  caseName: string | null;
  cases: PlanScore[];
  summary: {
    caseCount: number;
    meanScore: number;
    minScore: number;
    threshold: number;
    passed: boolean;
  };
}

interface AuditorReport {
  suite: 'auditor';
  impl: Impl;
  generatedAt: string;
  date: string;
  caseName: string | null;
  cases: AuditorScore['results'];
  summary: {
    caseCount: number;
    accuracy: number;
    falsePassRate: number;
    falseFailRate: number;
    fixQuality: number;
    laneDetection: number;
    threshold: number;
    passed: boolean;
  };
}

export type EvalReport = PlannerReport | AuditorReport;

export function parseArgs(argv: string[]): CliOptions {
  const suite = argv[0];
  if (suite !== 'planner' && suite !== 'auditor') {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      'Usage: bun evals/run.ts planner|auditor --impl mock|real [--case name] [--out path]',
    );
  }
  let impl: Impl = 'mock';
  let caseName: string | undefined;
  let out: string | undefined;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const next = (): string => {
      if (inline !== undefined) return inline;
      const value = argv[i + 1];
      if (value === undefined) throw new StarlingError('INVALID_ARGUMENT', `Missing value for ${flag}`);
      i += 1;
      return value;
    };
    if (flag === '--impl') {
      const value = next();
      if (value !== 'mock' && value !== 'real') {
        throw new StarlingError('INVALID_ARGUMENT', `--impl must be mock or real, got "${value}"`);
      }
      impl = value;
    } else if (flag === '--case') {
      caseName = next();
    } else if (flag === '--out') {
      out = next();
    } else {
      throw new StarlingError('INVALID_ARGUMENT', `Unknown argument "${arg}"`);
    }
  }

  return {
    suite,
    impl,
    ...(caseName === undefined ? {} : { caseName }),
    ...(out === undefined ? {} : { out }),
  };
}

export async function run(
  options: CliOptions,
): Promise<{ lines: string; report: EvalReport; passed: boolean }> {
  return options.suite === 'planner' ? runPlanner(options) : runAuditor(options);
}

async function runPlanner(
  options: CliOptions,
): Promise<{ lines: string; report: PlannerReport; passed: boolean }> {
  const all = loadPlannerCases();
  const cases = options.caseName === undefined ? all : [findPlannerCase(all, options.caseName)];
  const real = options.impl === 'real' ? await loadRealPlanner() : undefined;
  const scores: PlanScore[] = [];

  for (const testCase of cases) {
    const map = loadRepoMap(testCase.repomap);
    const goal = makeGoal({ text: testCase.goal, repoPath: map.root });
    const plan = await planFor(options.impl, testCase.name, goal, map, real);
    scores.push(scorePlan(plan, testCase, map));
  }

  const meanScore = round(mean(scores.map((score) => score.score)));
  const minScore = scores.length === 0 ? 0 : Math.min(...scores.map((score) => score.score));
  const passed = scores.length > 0 && scores.every((score) => score.score >= PLANNER_CASE_THRESHOLD);
  const report: PlannerReport = {
    suite: 'planner',
    impl: options.impl,
    generatedAt: new Date().toISOString(),
    date: today(),
    caseName: options.caseName ?? null,
    cases: scores,
    summary: { caseCount: scores.length, meanScore, minScore, threshold: PLANNER_CASE_THRESHOLD, passed },
  };

  const headers = ['case', 'score', 'validator', 'count', 'coverage', 'deps', 'lanes', 'dod'];
  const rows = scores.map((score) => [
    score.caseName,
    score.score.toFixed(3),
    ...score.checks.map((check) => (check.ok ? 'ok' : check.score.toFixed(2))),
  ]);
  const lines = [
    `planner · impl=${options.impl} · ${scores.length} case(s)`,
    formatTable(headers, rows),
    `${scores.length} case(s) · mean ${meanScore.toFixed(3)} · min ${minScore.toFixed(3)} · threshold ${PLANNER_CASE_THRESHOLD.toFixed(2)} · ${passed ? 'PASS' : 'FAIL'}`,
  ].join('\n');
  return { lines, report, passed };
}

async function planFor(
  impl: Impl,
  caseName: string,
  goal: Goal,
  map: RepoMap,
  real: Planner | undefined,
): Promise<Plan> {
  if (impl === 'mock') {
    const planner = new MockPlanner({ results: [{ plan: referencePlan(caseName, goal), issues: [] }] });
    return (await planner.plan(goal, map)).plan;
  }
  if (real === undefined) throw new StarlingError('INVALID_ARGUMENT', 'real planner was not loaded');
  return (await real.plan(goal, map)).plan;
}

async function runAuditor(
  options: CliOptions,
): Promise<{ lines: string; report: AuditorReport; passed: boolean }> {
  const all = loadAuditorCases();
  const cases = options.caseName === undefined ? all : [findAuditorCase(all, options.caseName)];
  const real = options.impl === 'real' ? await loadRealAuditor() : undefined;
  const verdicts: Array<{ testCase: (typeof cases)[number]; verdict: AuditVerdict }> = [];

  for (const testCase of cases) {
    const input = makeAuditInputFor(testCase);
    let verdict: AuditVerdict;
    if (options.impl === 'mock') {
      const auditor = new MockAuditor({
        decorate: (_verdict, auditInput) => ({
          ...referenceVerdict(testCase),
          attempt: auditInput.attempt,
        }),
      });
      verdict = await auditor.audit(input);
    } else {
      if (real === undefined) throw new StarlingError('INVALID_ARGUMENT', 'real auditor was not loaded');
      verdict = await real.audit(input);
    }
    verdicts.push({ testCase, verdict });
  }

  const score = scoreAuditor(verdicts);
  const passed =
    score.accuracy >= AUDITOR_ACCURACY_THRESHOLD && score.falsePassRate <= AUDITOR_FALSE_PASS_LIMIT;
  const report: AuditorReport = {
    suite: 'auditor',
    impl: options.impl,
    generatedAt: new Date().toISOString(),
    date: today(),
    caseName: options.caseName ?? null,
    cases: score.results,
    summary: {
      caseCount: score.caseCount,
      accuracy: score.accuracy,
      falsePassRate: score.falsePassRate,
      falseFailRate: score.falseFailRate,
      fixQuality: score.fixQuality,
      laneDetection: score.laneDetection,
      threshold: AUDITOR_ACCURACY_THRESHOLD,
      passed,
    },
  };

  const headers = ['case', 'expect', 'verdict', 'fix', 'lane'];
  const rows = score.results.map((result) => [
    result.caseName,
    result.expectedPass ? 'pass' : 'fail',
    result.actualPass ? 'pass' : 'fail',
    result.fixQuality === null ? '-' : result.fixQuality.toFixed(2),
    result.laneOk ? 'ok' : 'BAD',
  ]);
  const lines = [
    `auditor · impl=${options.impl} · ${score.caseCount} case(s)`,
    formatTable(headers, rows),
    `${score.caseCount} case(s) · accuracy ${score.accuracy.toFixed(3)} · false-pass ${score.falsePassRate.toFixed(3)} · false-fail ${score.falseFailRate.toFixed(3)} · fix ${score.fixQuality.toFixed(3)} · lane ${score.laneDetection.toFixed(3)} · ${passed ? 'PASS' : 'FAIL'}`,
  ].join('\n');
  return { lines, report, passed };
}

/** Write the JSON report; returns the path. */
export function writeReport(report: EvalReport, out?: string): string {
  const path = resolve(out ?? join(RESULTS_DIR, `${report.suite}-${report.date}.json`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const options = parseArgs(argv);
    const { lines, report, passed } = await run(options);
    const path = writeReport(report, options.out);
    console.log(lines);
    console.log(`report: ${path}`);
    return passed ? 0 : 1;
  } catch (err) {
    if (err instanceof StarlingError) {
      console.error(`evals: ${err.message}`);
      return err.code === 'NOT_IMPLEMENTED' ? 2 : 64;
    }
    throw err;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2));
}
