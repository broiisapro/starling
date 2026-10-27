import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Run } from '@starling/core';
import type { SqliteStore } from '@starling/store';
import { createSqliteStore } from '@starling/store';
import type { CliContext } from '../context';
import { readEventsJsonl } from '../jsonl';
import { stateFromEvents } from '../live-state';
import { storePathFor } from '../real/paths';
import { renderStatus } from '../render/status';
import { failWith, readBoolean, readString } from './options';

/**
 * `starling status [runId]` — one run, in detail.
 *
 * Reads the repo's SQLite store (`<repo>/.starling/starling.db`, written by `starling run`), so a run
 * survives the process that flew it. `--file <jsonl>` still renders a recording through the same
 * reducer, which is what the dashboard and `starling replay` do. `--repo` (additive) picks the store
 * of a demo repo without `cd`-ing into it.
 */
export async function statusCommand(
  runId: string | undefined,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  const file = readString(options, 'file');
  const repoPath = resolve(context.cwd, readString(options, 'repo') ?? '.');

  if (file !== undefined) {
    const events = readEventsJsonl(file, context.cwd);
    const state = stateFromEvents(events);
    const run = state.run;
    if (run === undefined) failWith('INVALID_ARGUMENT', `${file} does not contain a run.created event`);
    return renderRun(run, state.now, options, context);
  }

  const dbPath = storePathFor(repoPath);
  if (!existsSync(dbPath)) {
    context.write(context.palette.dim(`No runs recorded in ${repoPath} yet.`));
    context.write(`${context.palette.dim('Start one with')} starling run "<goal>" --repo ${repoPath}`);
    return 0;
  }

  let store: SqliteStore | undefined;
  try {
    store = createSqliteStore(dbPath);
    const target = runId ?? store.listRuns()[0]?.id;
    const run = target === undefined ? undefined : store.getRun(target);
    if (runId !== undefined && run === undefined) {
      failWith('INVALID_ARGUMENT', `No run ${runId} in ${dbPath}`);
    }
    if (run === undefined) {
      context.write(context.palette.dim('No runs recorded here yet.'));
      return 0;
    }
    return renderRun(run, context.now(), options, context);
  } finally {
    store?.close();
  }
}

function renderRun(run: Run, now: number, options: Record<string, unknown>, context: CliContext): number {
  if (readBoolean(options, 'json')) {
    context.write(JSON.stringify(run, null, 2));
    return run.status === 'failed' ? 1 : 0;
  }
  context.write(renderStatus(run, { palette: context.palette, width: context.columns, now }));
  return run.status === 'failed' ? 1 : 0;
}
