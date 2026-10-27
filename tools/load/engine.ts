#!/usr/bin/env bun
/**
 * Load test #1 — the engine at swarm scale.
 *
 * Runs a generated 30-task plan with `maxParallel: 20` through the real `createEngine`,
 * `createSqliteStore`, `createWorkspace`, `createAuditor` and `createMerger` on a generated repo.
 * Agents are `ReplayRunner`s (300 scripted events per task); the planner model is a `MockLLM`.
 *
 * ```sh
 * bun tools/load/engine.ts
 * bun tools/load/engine.ts --tasks 30 --parallel 20 --speed 4 --events 300 --raw-merges
 * ```
 */
import { startMemorySampler } from './instrument.ts';
import { createEngineReport, type EngineReport, formatEngineTable } from './report-engine.ts';
import { numberArg, parseArgs, writeResult, zeroableNumberArg } from './results.ts';
import { createLoadRig, type LoadRigOptions, withTimeout } from './rig.ts';

export type { EngineReport };

export interface RunEngineLoadOptions extends LoadRigOptions {
  /** Hard stop for the whole run so a wedged engine never hangs CI. */
  timeoutMs?: number;
}

/** Execute the engine load test and return the fully summarised report. */
export async function runEngineLoadTest(options: RunEngineLoadOptions = {}): Promise<EngineReport> {
  const timeoutMs = options.timeoutMs ?? 150_000;
  const startedAt = performance.now();
  const rig = await createLoadRig(options);
  const memory = startMemorySampler(50);

  try {
    const runId = await rig.startRun();
    const run = await withTimeout(rig.finish(runId, timeoutMs), timeoutMs + 5_000, 'engine load test hung');
    const wallMs = performance.now() - startedAt;
    const dbBytes = await rig.dbBytes();
    const memoryReport = memory.stop();

    return createEngineReport({ rig, run, wallMs, dbBytes, memory: memoryReport, options });
  } finally {
    memory.stop();
    await rig.dispose();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const options: RunEngineLoadOptions = {
    taskCount: numberArg(args, 'tasks', 30),
    maxParallel: numberArg(args, 'parallel', 20),
    replaySpeed: numberArg(args, 'speed', 4),
    eventsPerTask: numberArg(args, 'events', 300),
    sessionHeadroom: zeroableNumberArg(args, 'headroom', 4),
    serialiseMerges: !args.has('raw-merges'),
    doubleRecord: args.has('double-record'),
    retimeReplayEvents: !args.has('no-retime'),
  };

  console.log(
    `Starling engine load test: ${options.taskCount} tasks, maxParallel ${options.maxParallel}, ` +
      `${options.eventsPerTask} events/task, replay ×${options.replaySpeed}, ` +
      `session headroom ${options.sessionHeadroom ?? 4}` +
      `${options.serialiseMerges === false ? ', RAW (unqueued) merges' : ''}` +
      `${options.retimeReplayEvents === false ? ', raw replay timestamps' : ''}` +
      `${options.doubleRecord === true ? ', DOUBLE recorded' : ''}\n`,
  );

  const report = await runEngineLoadTest(options);
  console.log(formatEngineTable(report));
  const suffix =
    (options.serialiseMerges === false ? '-raw-merges' : '') +
    (options.retimeReplayEvents === false ? '-no-retime' : '') +
    (options.doubleRecord === true ? '-double-record' : '') +
    ((options.sessionHeadroom ?? 4) === 0 ? '-no-headroom' : '');
  const path = await writeResult(`engine${suffix}`, report);
  console.log(`\nJSON → ${path}`);
}

if (import.meta.main) await main();
