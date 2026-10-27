import type { Run } from '@starling/core';
import type { CliContext } from '../context';
import { readEventsJsonl } from '../jsonl';
import { stateFromEvents } from '../live-state';
import { renderStatus } from '../render/status';
import { failWith, readBoolean, readString } from './options';

/**
 * `starling status [runId]` — one run, in detail.
 *
 * In Wave 1 the store is in-memory, so there is nothing to list from a previous process. `--file`
 * is an additive flag that renders a recorded JSONL through the same reducer, which makes status
 * useful today and in the dashboard era.
 */
export async function statusCommand(
  runId: string | undefined,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  const file = readString(options, 'file');
  let run: Run | undefined;
  let now = context.now();

  if (file !== undefined) {
    const events = readEventsJsonl(file, context.cwd);
    const state = stateFromEvents(events);
    run = state.run;
    now = state.now;
    if (run === undefined) failWith('INVALID_ARGUMENT', `${file} does not contain a run.created event`);
  } else {
    const composition = context.composition();
    const target = runId ?? composition.engine.listRuns()[0]?.id;
    if (target !== undefined) run = composition.engine.getRun(target);
    if (runId !== undefined && run === undefined) {
      failWith('INVALID_ARGUMENT', `No run ${runId} in this session — recordings are available with --file`);
    }
  }

  if (run === undefined) {
    context.write(context.palette.dim('No runs in this session yet.'));
    context.write(
      `${context.palette.dim('Try')} starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200`,
    );
    context.write(
      `${context.palette.dim('or')} starling status --file fixtures/runs/sky-todo-launch-day.jsonl`,
    );
    return 0;
  }

  if (readBoolean(options, 'json')) {
    context.write(JSON.stringify(run, null, 2));
    return run.status === 'failed' ? 1 : 0;
  }

  context.write(renderStatus(run, { palette: context.palette, width: context.columns, now }));
  return run.status === 'failed' ? 1 : 0;
}
