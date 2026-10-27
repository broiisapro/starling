import { existsSync } from 'node:fs';
import { createEventBus } from '@starling/core';
import { createSqliteStore } from '@starling/store';
import type { CliContext } from '../context';
import { type Dashboard, startDashboard } from '../real/dashboard';
import { storePathFor } from '../real/paths';
import { createReadOnlyEngine } from '../real/readonly-engine';
import { readNumber, requirePositiveInteger } from './options';

/**
 * `starling dash` — serve the dashboard for the repo in the current directory.
 *
 * It serves the repo's SQLite store (every run `starling run` recorded) plus the API and SSE surface
 * the web app expects. There is no engine in this process: `starling run` owns the live one, and its
 * dashboard is started for the duration of the run. Launching work from a `dash` process needs the
 * engine to be constructed from flags the CLI does not have yet (Epic 41's launch form), so the API
 * answers 501 with a pointer to the real command.
 */
export async function dashCommand(options: Record<string, unknown>, context: CliContext): Promise<number> {
  const config = context.loadStarlingConfig();
  const port = requirePositiveInteger(readNumber(options, 'port', config.server.port), '--port');
  const dbPath = storePathFor(context.cwd);
  const store = createSqliteStore(dbPath);
  const bus = createEventBus();
  const engine = createReadOnlyEngine(store);

  let dashboard: Dashboard;
  try {
    dashboard = startDashboard({
      engine,
      store,
      bus,
      port,
      // The LAN host: perches on the other laptop need to reach the hub, not just this shell.
      hostname: '0.0.0.0',
    });
  } catch (err) {
    store.close();
    throw err;
  }

  const { palette } = context;
  const runs = store.listRuns();
  context.write(`${palette.bold('Starling dashboard')} is up 🐦`);
  context.write(`  ${palette.dim('url')}   ${palette.cyan(dashboard.url)}`);
  context.write(`  ${palette.dim('api')}   ${palette.cyan(`${dashboard.url}/api/health`)}`);
  context.write(
    `  ${palette.dim('store')} ${dbPath} ${palette.dim(`(${runs.length} run${runs.length === 1 ? '' : 's'}${existsSync(dbPath) ? '' : ' — created on first read'})`)}`,
  );
  context.write(palette.dim('  Ctrl-C to stop.'));

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });

  dashboard.stop();
  store.close();
  context.write(palette.dim('\ndash stopped.'));
  return 0;
}
