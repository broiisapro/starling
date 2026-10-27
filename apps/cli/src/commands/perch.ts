import { hostname } from 'node:os';
import { createBonjourAdvertiser } from '@starling/perch';
import type { CliContext } from '../context';
import { composePerch, perchComposeInput, perchComposeOptions } from '../real/perch-compose';
import { readNumber, readString, requirePositiveInteger } from './options';

/** How often the status line refreshes while the daemon idles. */
const STATUS_INTERVAL_MS = 2_000;

/**
 * `starling perch` — lend this machine to the flock.
 *
 * With no `--hub` the command teaches the join handshake and exits, which is what someone typing
 * `starling perch` for the first time needs. With `--hub` (and `--code`/`STARLING_HUB_URL`) it is a
 * real daemon: `composePerch` builds the workspace + opencode runner + `LocalNode`, `startPerch` serves
 * the Perch API and heartbeats, and this command stays in the foreground until Ctrl-C.
 */
export async function perchCommand(options: Record<string, unknown>, context: CliContext): Promise<number> {
  const config = context.loadStarlingConfig();
  const { palette } = context;
  const hub = readString(options, 'hub');
  const port = requirePositiveInteger(readNumber(options, 'port', config.perch.port), '--port');
  const maxSessions = requirePositiveInteger(
    readNumber(options, 'maxSessions', config.perch.maxSessions),
    '--max-sessions',
  );
  const name = readString(options, 'name');

  if (hub === undefined) {
    context.write(palette.bold('Perch — lend this machine to the flock'));
    context.write();
    context.write('Give me the hub URL and join code from the hub machine:');
    context.write(`  ${palette.cyan('starling perch --hub http://192.168.1.20:7777 --code ABCD-EFGH')}`);
    context.write();
    context.write(
      palette.dim(
        'On the hub, `starling flock` prints both and `starling dash` shows them in the Flock panel.',
      ),
    );
    return 0;
  }

  const input = perchComposeInput(config, {
    hub,
    port,
    maxSessions,
    ...(readString(options, 'code') === undefined ? {} : { code: readString(options, 'code') }),
    ...(name === undefined ? {} : { name }),
  });

  const mdns = config.flock.mdns
    ? createBonjourAdvertiser({
        onError: (err) => {
          // A locked-down wifi blocks multicast; the manual --hub/--code path must still work.
          context.writeErr(
            palette.dim(`mDNS: ${err instanceof Error ? err.message : String(err)} (staying on --hub)`),
          );
        },
      })
    : false;

  const displayName = input.name ?? hostname();
  context.write(palette.dim(`starting a perch as ${palette.bold(displayName)}…`));

  const perch = await composePerch({
    ...perchComposeOptions(input),
    mdns,
    ...(context.deps.fetchFn === undefined ? {} : { fetch: context.deps.fetchFn }),
  });

  let stopping = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (timer !== undefined) clearInterval(timer);
    context.write();
    context.write(palette.dim(`${reason} — flying home…`));
    await perch.stop();
  };

  context.write(`${palette.green('✔')} ${perch.statusLine()}`);
  context.write(`  ${palette.dim('node')}     ${perch.node.id}`);
  context.write(`  ${palette.dim('perch')}    ${palette.cyan(perch.handle.url)}`);
  context.write(`  ${palette.dim('state')}    ${palette.dim(perch.root)}`);
  context.write(`  ${palette.dim('hub')}      ${palette.cyan(hub)}`);
  context.write(`  ${palette.dim('join code')} ${input.code ?? palette.dim('(from the hub)')}`);
  context.write();
  context.write(palette.dim('The flock can now schedule tasks here. Ctrl-C to leave.'));

  let lastLine = perch.statusLine();
  const timer = setInterval(() => {
    const line = perch.statusLine();
    if (line === lastLine) return;
    lastLine = line;
    context.write(palette.dim(`  ${line}`));
  }, STATUS_INTERVAL_MS);
  timer.unref?.();

  return await new Promise<number>((resolve) => {
    const onInterrupt = (): void => {
      void shutdown('SIGINT')
        .then(() => {
          context.write(palette.dim('Perch stopped. The flock will notice within a heartbeat.'));
          resolve(0);
        })
        .catch((err: unknown) => {
          context.writeErr(context.formatError(err));
          resolve(1);
        })
        .finally(() => {
          process.off('SIGINT', onInterrupt);
          process.off('SIGTERM', onInterrupt);
        });
    };
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onInterrupt);
  });
}
