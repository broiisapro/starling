/**
 * Render the nightly run's step summary (Epic 150).
 *
 * The nightly workflow runs three cheap, deterministic checks and keeps their JSON as one artifact:
 * the mock planner/auditor evals, the quick load suite, and the swarm stats collector. This renders
 * a short Markdown table from those files. Everything is optional: a check that did not produce a
 * file shows as "not produced" instead of failing the job, because the artifact is the source of
 * truth and the summary is for a human glancing at the run.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PlannerSummary {
  cases: number;
  meanScore: number;
  passed: boolean;
}

export interface AuditorSummary {
  cases: number;
  accuracy: number;
  falsePassRate: number;
  passed: boolean;
}

export interface LoadSummary {
  quick: boolean;
  engineWallMs: number;
  sseWallMs: number;
  reducerEvents: number;
}

export interface StatsSummary {
  epics: number;
  prs: number;
  tests: number;
  agents: number;
}

export interface SummaryInputs {
  planner?: PlannerSummary;
  auditor?: AuditorSummary;
  load?: LoadSummary;
  stats?: StatsSummary;
}

/** Paths relative to the repository root, matching `.github/workflows/nightly.yml`. */
export const SUMMARY_PATHS = {
  planner: 'evals/results/nightly/planner.json',
  auditor: 'evals/results/nightly/auditor.json',
  load: 'tools/load/results/combined-quick.json',
  stats: 'stats.json',
} as const;

function formatNumber(value: number, digits = 0): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function summaryTable(inputs: SummaryInputs): string {
  const rows: string[] = [];
  rows.push('| Nightly check | Result |');
  rows.push('| --- | --- |');
  rows.push(
    inputs.planner === undefined
      ? '| Planner eval (mock) | not produced |'
      : `| Planner eval (mock) | ${inputs.planner.cases} cases · mean ${formatNumber(inputs.planner.meanScore, 3)} · ${inputs.planner.passed ? 'pass' : 'FAIL'} |`,
  );
  rows.push(
    inputs.auditor === undefined
      ? '| Auditor eval (mock) | not produced |'
      : `| Auditor eval (mock) | ${inputs.auditor.cases} cases · accuracy ${formatNumber(inputs.auditor.accuracy, 3)} · false-pass ${formatNumber(inputs.auditor.falsePassRate, 3)} · ${inputs.auditor.passed ? 'pass' : 'FAIL'} |`,
  );
  rows.push(
    inputs.load === undefined
      ? '| Quick load | not produced |'
      : `| Quick load${inputs.load.quick ? ' (quick)' : ''} | engine ${formatNumber(inputs.load.engineWallMs)} ms · SSE ${formatNumber(inputs.load.sseWallMs)} ms · reducer ${formatNumber(inputs.load.reducerEvents)} events |`,
  );
  rows.push(
    inputs.stats === undefined
      ? '| Swarm stats | not produced |'
      : `| Swarm stats | ${formatNumber(inputs.stats.epics)} epics · ${formatNumber(inputs.stats.prs)} PRs · ${formatNumber(inputs.stats.tests)} tests · ${formatNumber(inputs.stats.agents)} agents |`,
  );
  return `${rows.join('\n')}\n`;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function numberAt(source: Record<string, unknown> | undefined, ...path: string[]): number | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' ? current : undefined;
}

/** Read the four JSON files (any may be absent) and project the fields the table needs. */
export function readSummaryInputs(root: string = process.cwd()): SummaryInputs {
  const inputs: SummaryInputs = {};

  const planner = readJson(join(root, SUMMARY_PATHS.planner));
  const plannerSummary = planner?.summary as Record<string, unknown> | undefined;
  if (plannerSummary !== undefined) {
    const cases = numberAt(plannerSummary, 'caseCount');
    const meanScore = numberAt(plannerSummary, 'meanScore');
    if (cases !== undefined && meanScore !== undefined) {
      inputs.planner = { cases, meanScore, passed: plannerSummary.passed === true };
    }
  }

  const auditor = readJson(join(root, SUMMARY_PATHS.auditor));
  const auditorSummary = auditor?.summary as Record<string, unknown> | undefined;
  if (auditorSummary !== undefined) {
    const cases = numberAt(auditorSummary, 'caseCount');
    const accuracy = numberAt(auditorSummary, 'accuracy');
    if (cases !== undefined && accuracy !== undefined) {
      inputs.auditor = {
        cases,
        accuracy,
        falsePassRate: numberAt(auditorSummary, 'falsePassRate') ?? 0,
        passed: auditorSummary.passed === true,
      };
    }
  }

  const load = readJson(join(root, SUMMARY_PATHS.load));
  if (load !== undefined) {
    const engineWallMs = numberAt(load, 'engine', 'wallMs');
    const sseWallMs = numberAt(load, 'sse', 'wallMs');
    const reducerEvents = numberAt(load, 'reducer', 'totalEvents');
    if (engineWallMs !== undefined && sseWallMs !== undefined && reducerEvents !== undefined) {
      inputs.load = { quick: load.quick === true, engineWallMs, sseWallMs, reducerEvents };
    }
  }

  const stats = readJson(join(root, SUMMARY_PATHS.stats));
  const totals = stats?.totals as Record<string, unknown> | undefined;
  if (totals !== undefined) {
    const epics = numberAt(totals, 'epics');
    const prs = numberAt(totals, 'prs');
    const tests = numberAt(totals, 'tests');
    const agents = numberAt(totals, 'agentSessions');
    if (epics !== undefined && prs !== undefined && tests !== undefined && agents !== undefined) {
      inputs.stats = { epics, prs, tests, agents };
    }
  }

  return inputs;
}

function main(): void {
  const table = `## Nightly\n\n${summaryTable(readSummaryInputs())}`;
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath === undefined) {
    console.log(table);
    return;
  }
  appendFileSync(summaryPath, `${table}\n`);
}

if (import.meta.main) main();
