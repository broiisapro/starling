/**
 * Planner eval runner against the **real** model (Wave 2, ARCHITECTURE L29).
 *
 * `evals/run.ts planner --impl real` is the canonical harness command; the planner's default router
 * finds the running opencode server through `service.json` (or `STARLING_OPENCODE_URL`). This
 * runner is the iteration loop: same cases, same scoring, plus a per-case latency column (the
 * assignment's plan-latency deliverable), the validator issues as text, and the repo-map renderer
 * switch used for the A/B comparison.
 *
 *   bun evals/planner/live-run.ts [--case name] [--max-tokens N] [--max-repairs N]
 *                                 [--temperature T] [--map-renderer repomap|verbose]
 *                                 [--dump dir] [--out path]
 *
 * It never runs in the unit-test suite.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { MapRenderer } from '../../packages/planner/src/index.ts';
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
  plan?: Plan;
  /** Set when the model could not produce a plan for this case; `score` is then a zero placeholder. */
  error?: string;
}

export interface LiveRunOptions {
  caseName?: string;
  maxTokens?: number;
  maxRepairs?: number;
  temperature?: number;
  /** `repomap` (default) or `verbose`: the A/B the assignment asks for. */
  mapRenderer?: MapRenderer;
  /** Extra attempts per case when the provider returns an unusable completion. Default 1. */
  caseRetries?: number;
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
    ...(options.mapRenderer === undefined ? {} : { mapRenderer: options.mapRenderer }),
  });

  const results: LiveCaseResult[] = [];
  for (const testCase of cases) {
    const map = loadRepoMap(testCase.repomap);
    const goal = makeGoal({ text: testCase.goal, repoPath: map.root });
    const started = performance.now();
    let planned: Awaited<ReturnType<typeof planner.plan>> | undefined;
    let error: string | undefined;
    // One case-level retry: an empty completion from the provider is a transport hiccup, not a
    // planning result, and the assignment wants a full table, not a half-finished one.
    for (let attempt = 0; attempt <= (options.caseRetries ?? 1); attempt += 1) {
      try {
        planned = await planner.plan(goal, map);
        error = undefined;
        break;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    const elapsedMs = Math.round(performance.now() - started);
    const result: LiveCaseResult =
      planned === undefined
        ? {
            caseName: testCase.name,
            score: { caseName: testCase.name, score: 0, checks: [], coverage: [] },
            tasks: 0,
            taskKeys: [],
            elapsedMs,
            issues: [],
            ...(error === undefined ? {} : { error }),
          }
        : {
            caseName: testCase.name,
            score: scorePlan(planned.plan, testCase, map),
            tasks: planned.plan.tasks.length,
            taskKeys: planned.plan.tasks.map((task) => task.key),
            elapsedMs,
            issues: planned.issues.map((issue) => `${issue.severity}:${issue.code} ${issue.message}`),
            plan: planned.plan,
            ...(error === undefined ? {} : { error }),
          };
    results.push(result);
    options.onCase?.(result);
  }

  const scored = results.filter((result) => result.error === undefined);
  const scores = scored.map((result) => result.score.score);
  return {
    results,
    meanScore: mean(scores),
    minScore: scores.length === 0 ? 0 : Math.min(...scores),
    allValidatorsClean: scored.every(
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
    entry.error === undefined ? entry.score.score.toFixed(3) : 'ERR',
    ...(entry.error === undefined
      ? entry.score.checks.map((check) => (check.ok ? 'ok' : check.score.toFixed(2)))
      : ['-', '-', '-', '-', '-', '-']),
    String(entry.tasks),
    String(entry.elapsedMs),
  ]);
  const errored = result.results.filter((entry) => entry.error !== undefined);
  return [
    `planner · impl=real · ${result.results.length} case(s)`,
    formatTable(headers, rows),
    `mean ${result.meanScore.toFixed(3)} · min ${result.minScore.toFixed(3)} · validators ${result.allValidatorsClean ? 'all clean' : 'DIRTY'} · total ${(result.totalMs / 1000).toFixed(1)}s · slowest ${(result.maxMs / 1000).toFixed(1)}s${errored.length === 0 ? '' : ` · ${errored.length} transport error(s)`}`,
  ].join('\n');
}

interface CliArgs {
  caseName?: string;
  maxTokens?: number;
  maxRepairs?: number;
  temperature?: number;
  mapRenderer?: MapRenderer;
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
    else if (flag === '--map-renderer') {
      const value = next();
      if (value !== 'repomap' && value !== 'verbose') {
        throw new StarlingError('INVALID_ARGUMENT', '--map-renderer must be repomap or verbose');
      }
      args.mapRenderer = value;
    } else if (flag === '--dump') args.dumpDir = next();
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
      ...(entry.error === undefined ? {} : { error: entry.error }),
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
    ...(args.mapRenderer === undefined ? {} : { mapRenderer: args.mapRenderer }),
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
    if (entry.error !== undefined) {
      console.log(`${entry.caseName} transport error: ${entry.error}`);
    }
  }
  console.log(formatLines(result));
  console.log(`report: ${writeReport(result, args.out)}`);
  if (args.dumpDir !== undefined) {
    mkdirSync(args.dumpDir, { recursive: true });
    for (const entry of result.results) {
      if (entry.plan === undefined) continue;
      writeFileSync(join(args.dumpDir, `${entry.caseName}.json`), `${JSON.stringify(entry.plan, null, 2)}\n`);
    }
  }
  const errored = result.results.some((entry) => entry.error !== undefined);
  return !errored && result.meanScore >= 0.85 && result.allValidatorsClean ? 0 : 1;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2));
}
