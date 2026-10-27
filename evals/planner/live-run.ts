/**
 * Planner eval runner against the **real** model (Wave 2, ARCHITECTURE L29).
 *
 * `evals/run.ts planner --impl real` is the canonical harness command; it needs a
 * `starling.config.yaml` in the working directory so the planner's default router finds the opencode
 * server. This runner is the iteration loop: same cases, same scoring, plus a per-case latency
 * column (the assignment's plan-latency deliverable) and the validator issues as text.
 *
 *   bun evals/planner/live-run.ts [--case name] [--max-tokens N] [--max-repairs N]
 *                                 [--temperature T] [--dump dir] [--out path]
 *
 * It never runs in the unit-test suite.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type Plan, StarlingError } from '../lib/core';
import { makeGoal } from '../lib/core-testing';
import { RESULTS_DIR } from '../lib/paths';
import { formatTable } from '../lib/table';
import { findPlannerCase, loadPlannerCases, loadRepoMap } from './cases';
import { createLivePlanner } from './live';
import { type PlanScore, scorePlan } from './score';

export interface LiveCaseResult {
  caseName: string;
  score: PlanScore;
  tasks: number;
  taskKeys: string[];
  elapsedMs: number;
  issues: string[];
  plan: Plan;
}

export interface LiveRunOptions {
  caseName?: string;
  maxTokens?: number;
  maxRepairs?: number;
  temperature?: number;
  /** Fires as each case finishes, so a CLI can show progress on a slow model. */
  onCase?: (result: LiveCaseResult) => void;
}

export interface LiveRunResult {
  results: LiveCaseResult[];
  meanScore: number;
  minScore: number;
  allValidatorsClean: boolean;
  totalMs: number;
  maxMs: number;
}

export async function runLivePlannerEval(options: LiveRunOptions = {}): Promise<LiveRunResult> {
  const all = loadPlannerCases();
  const cases = options.caseName === undefined ? all : [findPlannerCase(all, options.caseName)];
  const { planner } = createLivePlanner({
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxRepairs === undefined ? {} : { maxRepairs: options.maxRepairs }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
  });

  const results: LiveCaseResult[] = [];
  for (const testCase of cases) {
    const map = loadRepoMap(testCase.repomap);
    const goal = makeGoal({ text: testCase.goal, repoPath: map.root });
    const started = performance.now();
    const planned = await planner.plan(goal, map);
    const elapsedMs = Math.round(performance.now() - started);
    const score = scorePlan(planned.plan, testCase, map);
    const result: LiveCaseResult = {
      caseName: testCase.name,
      score,
      tasks: planned.plan.tasks.length,
      taskKeys: planned.plan.tasks.map((task) => task.key),
      elapsedMs,
      issues: planned.issues.map((issue) => `${issue.severity}:${issue.code} ${issue.message}`),
      plan: planned.plan,
    };
    results.push(result);
    options.onCase?.(result);
  }

  const scores = results.map((result) => result.score.score);
  return {
    results,
    meanScore: mean(scores),
    minScore: scores.length === 0 ? 0 : Math.min(...scores),
    allValidatorsClean: results.every(
      (result) => result.score.checks.find((check) => check.name === 'validator')?.ok === true,
    ),
    totalMs: results.reduce((sum, result) => sum + result.elapsedMs, 0),
    maxMs: results.reduce((max, result) => Math.max(max, result.elapsedMs), 0),
  };
}

export function formatLines(result: LiveRunResult): string {
  const headers = ['case', 'score', 'validator', 'count', 'coverage', 'deps', 'lanes', 'dod', 'tasks', 'ms'];
  const rows = result.results.map((entry) => [
    entry.caseName,
    entry.score.score.toFixed(3),
    ...entry.score.checks.map((check) => (check.ok ? 'ok' : check.score.toFixed(2))),
    String(entry.tasks),
    String(entry.elapsedMs),
  ]);
  return [
    `planner · impl=real · ${result.results.length} case(s)`,
    formatTable(headers, rows),
    `mean ${result.meanScore.toFixed(3)} · min ${result.minScore.toFixed(3)} · validators ${result.allValidatorsClean ? 'all clean' : 'DIRTY'} · total ${(result.totalMs / 1000).toFixed(1)}s · slowest ${(result.maxMs / 1000).toFixed(1)}s`,
  ].join('\n');
}

interface CliArgs {
  caseName?: string;
  maxTokens?: number;
  maxRepairs?: number;
  temperature?: number;
  dumpDir?: string;
  out?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const next = (): string => {
      const value = inline ?? argv[i + 1];
      if (value === undefined) throw new StarlingError('INVALID_ARGUMENT', `Missing value for ${flag}`);
      if (inline === undefined) i += 1;
      return value;
    };
    const numeric = (): number => {
      const value = Number(next());
      if (!Number.isFinite(value)) {
        throw new StarlingError('INVALID_ARGUMENT', `${flag} expects a number`);
      }
      return value;
    };
    if (flag === '--case') args.caseName = next();
    else if (flag === '--max-tokens') args.maxTokens = numeric();
    else if (flag === '--max-repairs') args.maxRepairs = numeric();
    else if (flag === '--temperature') args.temperature = numeric();
    else if (flag === '--dump') args.dumpDir = next();
    else if (flag === '--out') args.out = next();
    else throw new StarlingError('INVALID_ARGUMENT', `Unknown argument "${arg}"`);
  }
  return args;
}

export function writeReport(result: LiveRunResult, out?: string): string {
  const path = resolve(
    out ?? join(RESULTS_DIR, `planner-live-${new Date().toISOString().slice(0, 10)}.json`),
  );
  mkdirSync(dirname(path), { recursive: true });
  const report = {
    suite: 'planner',
    impl: 'real',
    generatedAt: new Date().toISOString(),
    meanScore: result.meanScore,
    minScore: result.minScore,
    allValidatorsClean: result.allValidatorsClean,
    totalMs: result.totalMs,
    cases: result.results.map((entry) => ({
      caseName: entry.caseName,
      score: entry.score,
      tasks: entry.tasks,
      taskKeys: entry.taskKeys,
      elapsedMs: entry.elapsedMs,
      issues: entry.issues,
    })),
  };
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const result = await runLivePlannerEval({
    ...(args.caseName === undefined ? {} : { caseName: args.caseName }),
    ...(args.maxTokens === undefined ? {} : { maxTokens: args.maxTokens }),
    ...(args.maxRepairs === undefined ? {} : { maxRepairs: args.maxRepairs }),
    ...(args.temperature === undefined ? {} : { temperature: args.temperature }),
    onCase: (entry) => {
      console.log(
        `· ${entry.caseName} score=${entry.score.score.toFixed(3)} tasks=${entry.tasks} ${entry.elapsedMs}ms`,
      );
    },
  });
  for (const entry of result.results) {
    if (entry.issues.length > 0) {
      console.log(`${entry.caseName} issues:\n  ${entry.issues.join('\n  ')}`);
    }
  }
  console.log(formatLines(result));
  console.log(`report: ${writeReport(result, args.out)}`);
  if (args.dumpDir !== undefined) {
    mkdirSync(args.dumpDir, { recursive: true });
    for (const entry of result.results) {
      writeFileSync(join(args.dumpDir, `${entry.caseName}.json`), `${JSON.stringify(entry.plan, null, 2)}\n`);
    }
  }
  return result.meanScore >= 0.85 && result.allValidatorsClean ? 0 : 1;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2));
}
