#!/usr/bin/env bun
/**
 * bench.ts — which local open-weight model should Starling audit with on THIS laptop?
 *
 *   bun tools/local-models/bench.ts --models a,b --profile mbp|air [--cases DIR] [--repeat 2]
 *                                   [--max-ram-gb N] [--dry-run] [--force] [--host URL]
 *                                   [--out FILE] [--no-write] [--think off]
 *
 * For each model it asks every case in `cases/` through the same JSON-schema audit request the
 * smoke test sends, and records correctness, JSON validity, TTFT, latency, tokens/s, resident
 * memory and free RAM before and after. It then prints a markdown table and writes
 * `results/bench-<host>-<date>.json`; `recommend.ts` turns those files into the per-profile pick.
 *
 * `--dry-run` runs the whole pipeline against an in-process fake Ollama instead: a "smart" model
 * that gets every case right and a "lazy" one that passes everything. No model is loaded, no
 * `ollama` command runs, and nothing is written — safe to run while 20 agents are working.
 *
 * Safety rails (override with --force): more than 4 opencode processes, or less free RAM than
 * --max-ram-gb, refuses to start. Each model is unloaded before the next one loads, and a model is
 * abandoned on its first OOM-ish failure.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AUDIT_SYSTEM, VERDICT_SCHEMA } from './audit-request';
import { checkRails } from './bench-core';
import { markdownTable, missReport } from './bench-report';
import { runBench } from './bench-run';
import { loadCases } from './cases';
import { argList, argNumber, argValue, hasFlag, writesEnabled } from './cli-args';
import { fakeModelSpec, startFakeOllama } from './fake-ollama';
import { hardware, slug } from './host';
import { ollamaVersion } from './ollama';
import { fakeProbes, hostProbes } from './probes';
import {
  formatRecommendation,
  PROFILE_BUDGET_GB,
  type Profile,
  type Recommendation,
  readBenchResults,
  recommendModels,
  writeRecommendation,
} from './recommend';
import { isToolError, ToolError } from './tool-error';

const HERE = dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);

const USAGE = `usage: bun tools/local-models/bench.ts --models a,b [options]

  --models a,b          model tags to compare (required), e.g. qwen3.8:27b-mlx,gpt-oss:20b
  --profile mbp|air     which laptop's RAM budget this run is for (default: detected)
  --cases DIR           case corpus (default: tools/local-models/cases)
  --repeat N            ask every case N times (default: 2)
  --max-ram-gb N        free RAM required before a model loads (default: 6 mbp, 4 air)
  --dry-run             use the in-process fake Ollama; load no model; write nothing
  --force               ignore the safety rails
  --host URL            Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)
  --out FILE            result file (default: results/bench-<host>-<date>.json)
  --no-write            measure and print, save nothing
  --think on|off        reasoning pass (default: on; off is much faster, see Epic 02)`;

function defaultProfile(): Profile {
  return hardware().ramGb >= 24 ? 'mbp' : 'air';
}

function payload(
  startedAt: string,
  finishedAt: string,
  profile: Profile,
  host: string,
  version: string,
  rails: unknown,
  cases: ReturnType<typeof loadCases>,
  results: Awaited<ReturnType<typeof runBench>>,
  repeat: number,
) {
  return {
    kind: 'starling.local-model.bench',
    schemaVersion: 1,
    startedAt,
    finishedAt,
    profile,
    host: { ...hardware(), bun: Bun.version },
    ollama: { url: host, version },
    request: {
      endpoint: '/v1/chat/completions',
      fallbackEndpoint: '/api/chat',
      responseFormat: 'json_schema',
      schema: VERDICT_SCHEMA,
      system: AUDIT_SYSTEM,
      temperature: 0,
      repeat,
    },
    safety: rails,
    cases: cases.map((c) => ({ key: c.key, expectPass: c.expect.pass, mustMention: c.expect.mustMention })),
    models: results,
  };
}

async function main(): Promise<void> {
  if (hasFlag(argv, 'help') || hasFlag(argv, 'h')) {
    console.log(USAGE);
    return;
  }

  const models = argList(argv, 'models');
  if (!models) throw new ToolError('USAGE', USAGE);

  const dryRun = hasFlag(argv, 'dry-run');
  const force = hasFlag(argv, 'force');
  const casesDir = argValue(argv, 'cases') ?? join(HERE, 'cases');
  const repeat = argNumber(argv, 'repeat', 2);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new ToolError('USAGE', '--repeat must be a positive integer');
  }

  const profileArg = argValue(argv, 'profile') ?? (dryRun ? 'mbp' : defaultProfile());
  if (profileArg !== 'mbp' && profileArg !== 'air') {
    throw new ToolError('USAGE', `--profile must be "mbp" or "air", got "${profileArg}"`);
  }
  const profile: Profile = profileArg;

  const maxRamGb = argNumber(argv, 'max-ram-gb', profile === 'mbp' ? 6 : 4);
  if (!Number.isFinite(maxRamGb) || maxRamGb <= 0) {
    throw new ToolError('USAGE', '--max-ram-gb must be a positive number');
  }
  const think = argValue(argv, 'think') !== 'off';
  const maxTokens = argNumber(argv, 'max-tokens', 2000);

  const startedAt = new Date().toISOString();
  const cases = loadCases(casesDir);
  console.log(
    `🐦 local-model bench — ${cases.length} cases × ${repeat} · profile ${profile}` +
      `${dryRun ? ' · DRY RUN against a fake Ollama (no model is loaded)' : ''}`,
  );

  const fake = dryRun ? startFakeOllama({ cases, models: models.map(fakeModelSpec) }) : undefined;
  const host =
    fake?.url ??
    (argValue(argv, 'host') ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const probes = fake
    ? fakeProbes({
        freeRamGb: argNumber(argv, 'fake-free-ram', 12),
        openCodeProcesses: argNumber(argv, 'fake-opencode', 0),
      })
    : hostProbes();

  try {
    const version = await ollamaVersion(host);
    if (version === 'unreachable') {
      throw new ToolError(
        'OLLAMA_UNREACHABLE',
        `Ollama is not answering at ${host}. Run bash tools/local-models/setup.sh first.`,
      );
    }

    const [openCodeProcesses, freeRamGb] = await Promise.all([
      probes.openCodeProcesses(),
      probes.freeRamGb(),
    ]);
    const rails = checkRails({ openCodeProcesses, freeRamGb, maxRamGb });
    console.log(`   ollama ${version} at ${host}`);
    console.log(
      `   rails: ${openCodeProcesses} opencode process(es), ${freeRamGb ?? '?'} GB free (needs ${maxRamGb} GB)`,
    );
    for (const warning of rails.warnings) console.warn(`   ! ${warning}`);
    if (!rails.ok) {
      const detail = rails.blocking.map((b) => `   ✘ ${b}`).join('\n');
      if (!force) {
        throw new ToolError('RAIL_REFUSED', `refusing to start — the machine is not quiet:\n${detail}`);
      }
      console.warn(`   ! --force: continuing anyway\n${detail}`);
    }

    const results = await runBench(
      {
        host,
        profile,
        models,
        cases,
        repeat,
        maxTokens,
        keepAlive: '5m',
        think,
        log: (msg) => console.log(msg),
      },
      { probes, now: Date.now },
    );

    console.log('');
    console.log(markdownTable(results).join('\n'));
    console.log('');
    console.log('misses:');
    console.log(missReport(results).join('\n'));

    const budgets: Record<Profile, number> = {
      mbp: argNumber(argv, 'budget-mbp', PROFILE_BUDGET_GB.mbp),
      air: argNumber(argv, 'budget-air', PROFILE_BUDGET_GB.air),
    };
    let rec: Recommendation | undefined;
    try {
      rec = recommendModels(results, budgets);
    } catch (err) {
      if (!isToolError(err, 'NO_ELIGIBLE_MODEL')) throw err;
      console.warn(`\n   ! ${err.message}`);
    }

    if (rec) {
      console.log('');
      console.log(formatRecommendation(rec, results).join('\n'));
      console.log('');
      console.log(JSON.stringify(rec));
    }

    if (dryRun) {
      console.log('\n   dry run: nothing written. Re-run without --dry-run on a quiet machine.');
      return;
    }
    if (!writesEnabled(argv)) {
      console.log('\n   --no-write: results not saved.');
      return;
    }

    const finishedAt = new Date().toISOString();
    const outPath =
      argValue(argv, 'out') ??
      join(HERE, 'results', `bench-${slug(hardware().hostname)}-${finishedAt.slice(0, 10)}.json`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      `${JSON.stringify(payload(startedAt, finishedAt, profile, host, version, { ...rails, forced: force }, cases, results, repeat), null, 2)}\n`,
    );
    console.log(`\n   wrote ${outPath}`);

    const recommendationPath = join(HERE, 'results', 'recommendation.json');
    const merged = readBenchResults(join(HERE, 'results'));
    writeRecommendation(recommendationPath, recommendModels(merged, budgets));
    console.log(`   wrote ${recommendationPath}`);
  } finally {
    fake?.stop();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    if (isToolError(err, 'USAGE')) {
      console.error(`\n✘ ${err.message}`);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n✘ ${isToolError(err) ? `${err.code}: ` : ''}${message}`);
    }
    process.exit(1);
  }
}
