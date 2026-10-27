import type { CliContext } from '../context';
import { readEventsJsonl } from '../jsonl';
import { applyEvent, emptyLiveState } from '../live-state';
import { LiveView } from '../live-view';
import { fmtDuration } from '../render/format';
import { renderSummary } from '../render/summary';
import { failWith, readNumber } from './options';

const MAX_STEP_MS = 10_000;

/**
 * `starling replay <file.jsonl> [--speed N]` — the one fully real command in Wave 1.
 *
 * Events are validated by the production zod schema, then played into the same reducer and live
 * view the engine uses. Timing is scaled by `--speed`; a gap is never allowed to stall a replay for
 * more than 10 seconds, which keeps a corrupted timestamp from hanging the terminal.
 */
export async function replayCommand(
  file: string,
  options: Record<string, unknown>,
  context: CliContext,
): Promise<number> {
  const events = readEventsJsonl(file, context.cwd);
  if (events.length === 0) failWith('INVALID_ARGUMENT', `The recording at ${file} has no events`);

  const speed = readNumber(options, 'speed', 4);
  if (!(speed > 0)) failWith('INVALID_ARGUMENT', `--speed must be greater than 0 (got ${speed})`);

  const state = emptyLiveState();
  const live = new LiveView({
    write: (text) => context.io.write(text),
    isTTY: context.io.isTTY,
    now: context.now,
    columns: context.columns,
    palette: context.palette,
  });

  const startedAt = context.now();
  let previousTs: number | undefined;
  for (const event of events) {
    if (previousTs !== undefined) {
      const delay = Math.min(MAX_STEP_MS, Math.max(0, (event.ts - previousTs) / speed));
      if (delay > 0) await context.sleep(delay);
    }
    previousTs = event.ts;
    applyEvent(state, event);
    live.render(state);
  }

  live.render(state, { force: true });
  live.close();
  context.write();

  const run = state.run;
  if (run !== undefined) {
    context.write(
      renderSummary(run, state.finishedSummary ?? `Replayed ${events.length} events.`, {
        palette: context.palette,
        width: Math.min(context.columns, 90),
      }),
    );
    context.write();
  }

  const wall = fmtDuration(context.now() - startedAt);
  context.write(
    context.palette.dim(
      `replayed ${events.length} events from ${file} · ×${speed} · ${wall} wall time${
        run === undefined ? '' : ` · run ${run.id.slice(-6)} ${run.status}`
      }`,
    ),
  );
  return run === undefined || run.status === 'finished' ? 0 : 1;
}
