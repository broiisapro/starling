#!/usr/bin/env bun
import { runEngineLoadTest } from './engine.ts';
/**
 * Run all three load tests and print their tables.
 *
 * ```sh
 * bun tools/load/index.ts            # full: 30 tasks, 20 sessions, 20 dashboards, 20k reducer events
 * bun tools/load/index.ts --quick    # a ~10 s smoke run for a busy machine
 * ```
 */
import { type EngineReport, formatEngineTable } from './report-engine.ts';
import { numberArg, parseArgs, writeResult } from './results.ts';
import { formatSseTable, runSseLoadTest, type SseReport } from './sse.ts';
import { formatReducerTable, type ReducerReport, runWebReducerTest } from './web-reducer.ts';

export interface CombinedReport {
  generatedAt: string;
  quick: boolean;
  engine: EngineReport;
  sse: SseReport;
  reducer: ReducerReport;
}

export async function runAll(
  options: { quick?: boolean; reducerEvents?: number } = {},
): Promise<CombinedReport> {
  const quick = options.quick ?? false;
  const taskCount = quick ? 12 : 30;
  const maxParallel = quick ? 8 : 20;
  const clients = quick ? 6 : 20;

  // Reducer first: it is pure CPU with no I/O, so it gets a clean heap and an unloaded event loop.
  const reducer = runWebReducerTest(options.reducerEvents ?? (quick ? 6_000 : 20_000));
  const engine = await runEngineLoadTest({
    taskCount,
    maxParallel,
    replaySpeed: quick ? 8 : 4,
    eventsPerTask: quick ? 120 : 300,
  });
  const sse = await runSseLoadTest({
    taskCount,
    maxParallel,
    clients,
    replaySpeed: quick ? 8 : 4,
    eventsPerTask: quick ? 120 : 300,
  });

  return { generatedAt: new Date().toISOString(), quick, engine, sse, reducer };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const quick = args.has('quick');
  const events = numberArg(args, 'reducer-events', quick ? 6_000 : 20_000);

  console.log(`Starling load suite${quick ? ' (quick)' : ''}\n`);
  const report = await runAll({ quick, reducerEvents: events });

  console.log(formatEngineTable(report.engine));
  console.log(`\n${formatSseTable(report.sse)}`);
  console.log(`\n${formatReducerTable(report.reducer)}`);

  const suffix = quick ? '-quick' : '';
  const paths = [
    await writeResult(`engine${suffix}`, report.engine),
    await writeResult(`sse${suffix}`, report.sse),
    await writeResult(`web-reducer${suffix}`, report.reducer),
    await writeResult(`combined${suffix}`, report),
  ];
  console.log(`\nJSON → ${paths.join(', ')}`);
}

if (import.meta.main) await main();
