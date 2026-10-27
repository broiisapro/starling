/**
 * recommend.ts — turn measured results into the two lines Starling's config actually needs:
 * `models.auditor` and `models.summarizer`, per laptop profile.
 *
 *   bun tools/local-models/recommend.ts [--results DIR] [--out FILE] [--budget-mbp 24] [--budget-air 9]
 *
 * The rules, in order of precedence:
 *   1. only a model that measured *inside the profile's RAM budget* is eligible;
 *   2. the auditor is the most accurate of those, ties broken by the lowest mean latency;
 *   3. the summariser is the fastest of those that still clear SUMMARISER_MIN_ACCURACY, because
 *      writing a PR body is easier than judging a diff — and falls back to the auditor when
 *      nothing else clears the bar.
 *
 * A model that never reported a resident size is not eligible: "within the RAM budget" has to be a
 * measurement, not a hope. That is why an aborted or unloaded-early model can never be recommended.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ModelBenchResult } from './bench-core';
import { argNumber, argValue } from './cli-args';
import { ToolError } from './tool-error';

export type Profile = 'mbp' | 'air';

/** The RAM each laptop has (ARCHITECTURE §1, candidates.json). */
export const PROFILE_RAM_GB: Record<Profile, number> = { mbp: 32, air: 16 };

/**
 * How much of that RAM a local model may occupy once macOS, the editor and one or two opencode
 * sessions have theirs. Derived from Epic 02's measurement (an 18 GB model wired 21.2 GB and left
 * 27% of 32 GB free) and from candidates.json's air rule (a ~7 GB model next to 1-2 sessions).
 */
export const PROFILE_BUDGET_GB: Record<Profile, number> = { mbp: 24, air: 9 };

/** A summariser may be dumber than the auditor, but not useless. */
export const SUMMARISER_MIN_ACCURACY = 0.8;

export interface ProfilePick {
  auditor: string;
  summarizer: string;
}

export type Recommendation = Record<Profile, ProfilePick>;

const PROFILES: Profile[] = ['mbp', 'air'];

export function eligibleModels(results: ModelBenchResult[], budgetGb: number): ModelBenchResult[] {
  return results.filter(
    (r) => r.status === 'ok' && r.residentGb !== null && r.residentGb <= budgetGb && r.total > 0,
  );
}

const latencyOf = (r: ModelBenchResult): number => r.latencyMsMean ?? Number.POSITIVE_INFINITY;

/** Accuracy first, then latency, then name so the output is stable. */
export function rankForAuditor(results: ModelBenchResult[]): ModelBenchResult[] {
  return [...results].sort(
    (a, b) => b.accuracy - a.accuracy || latencyOf(a) - latencyOf(b) || a.model.localeCompare(b.model),
  );
}

export function pickForProfile(
  results: ModelBenchResult[],
  budgetGb: number,
  minSummariserAccuracy = SUMMARISER_MIN_ACCURACY,
): ProfilePick {
  const ranked = rankForAuditor(eligibleModels(results, budgetGb));
  const auditor = ranked[0];
  if (!auditor) {
    throw new ToolError(
      'NO_ELIGIBLE_MODEL',
      `no model fitted the ${budgetGb} GB budget with a measured resident size; ` +
        're-run the benchmark with a smaller model or a larger --budget.',
    );
  }
  const summarisers = ranked
    .filter((r) => r.accuracy >= minSummariserAccuracy)
    .sort((a, b) => latencyOf(a) - latencyOf(b) || b.accuracy - a.accuracy || a.model.localeCompare(b.model));
  return { auditor: auditor.model, summarizer: (summarisers[0] ?? auditor).model };
}

export function recommendModels(
  results: ModelBenchResult[],
  budgets: Record<Profile, number> = PROFILE_BUDGET_GB,
): Recommendation {
  return {
    mbp: pickForProfile(results, budgets.mbp),
    air: pickForProfile(results, budgets.air),
  };
}

/** A markdown table of the picks with the numbers behind them, for stdout. */
export function formatRecommendation(rec: Recommendation, results: ModelBenchResult[]): string[] {
  const lines = [
    '| profile | role | model | accuracy | latency | resident |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const profile of PROFILES) {
    const pick = rec[profile];
    for (const role of ['auditor', 'summarizer'] as const) {
      const model = role === 'auditor' ? pick.auditor : pick.summarizer;
      const r = results.find((x) => x.model === model);
      if (!r) {
        lines.push(`| ${profile} | ${role} | ${model} | ? | ? | ? |`);
        continue;
      }
      lines.push(
        `| ${profile} | ${role} | ${model} | ${(r.accuracy * 100).toFixed(0)}% | ` +
          `${r.latencyMsMean ?? '?'} ms | ${r.residentGb ?? '?'} GB |`,
      );
    }
  }
  return lines;
}

interface BenchFile {
  models?: ModelBenchResult[];
}

/** Read every `bench-*.json` in `dir`; the newest result per model wins. */
export function readBenchResults(dir: string): ModelBenchResult[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((n) => n.startsWith('bench-') && n.endsWith('.json'))
      .sort();
  } catch (cause) {
    throw new ToolError('USAGE', `cannot read the results directory ${dir}`, { cause });
  }
  const byModel = new Map<string, ModelBenchResult>();
  for (const name of names) {
    const path = join(dir, name);
    let parsed: BenchFile;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as BenchFile;
    } catch (cause) {
      throw new ToolError('USAGE', `${name}: not valid JSON`, { cause });
    }
    for (const result of parsed.models ?? []) {
      const previous = byModel.get(result.model);
      if (!previous || result.finishedAt >= previous.finishedAt) byModel.set(result.model, result);
    }
  }
  if (byModel.size === 0) {
    throw new ToolError('USAGE', `no bench results in ${dir}. Run tools/local-models/bench.ts first.`);
  }
  return [...byModel.values()];
}

export function writeRecommendation(path: string, rec: Recommendation): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
}

const USAGE = `usage: bun tools/local-models/recommend.ts [--results DIR] [--out FILE]
       [--budget-mbp 24] [--budget-air 9]`;

async function main(argv: string[]): Promise<void> {
  const defaultResults = join(dirname(new URL(import.meta.url).pathname), 'results');
  const resultsDir = argValue(argv, 'results') ?? defaultResults;
  const out = argValue(argv, 'out') ?? join(resultsDir, 'recommendation.json');
  const budgets: Record<Profile, number> = {
    mbp: argNumber(argv, 'budget-mbp', PROFILE_BUDGET_GB.mbp),
    air: argNumber(argv, 'budget-air', PROFILE_BUDGET_GB.air),
  };
  if (Number.isNaN(budgets.mbp) || Number.isNaN(budgets.air)) {
    throw new ToolError('USAGE', USAGE);
  }

  const results = readBenchResults(resultsDir);
  const rec = recommendModels(results, budgets);
  writeRecommendation(out, rec);

  console.log(formatRecommendation(rec, results).join('\n'));
  console.log('');
  console.log(`wrote ${out}`);
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n✘ ${message}`);
    process.exit(1);
  }
}
