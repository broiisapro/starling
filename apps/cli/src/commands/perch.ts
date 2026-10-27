import { cpus, hostname, totalmem } from 'node:os';
import { makeNodeInfo } from '@starling/core/testing';
import type { CliContext } from '../context';
import { failWith, readNumber, readString, requirePositiveInteger } from './options';

/**
 * `starling perch` — the flags and the join UX.
 *
 * Wave 1 composes the mock FlockHub: the node really is registered in the in-memory registry and
 * shows up in `starling flock`, but no HTTP server or mDNS advert is started (that is Epic 19).
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
  const name = readString(options, 'name') ?? (config.perch.name === 'auto' ? hostname() : config.perch.name);

  if (hub === undefined) {
    context.write(palette.bold('Perch — lend this machine to the flock'));
    context.write();
    context.write('Give me the hub URL and join code from the hub machine:');
    context.write(`  ${palette.cyan('starling perch --hub http://192.168.1.20:7777 --code ABCD-EFGH')}`);
    context.write();
    context.write(
      palette.dim('On the hub, `starling flock` prints both. mDNS can find the hub automatically in wave 2.'),
    );
    return 0;
  }

  const composition = context.composition();
  const flock = composition.flock;
  if (flock === undefined) failWith('INVALID_ARGUMENT', 'Flocking is disabled in this config');

  const code = readString(options, 'code') ?? flock.joinInfo().code;
  const info = makeNodeInfo({
    id: `perch-${port}`,
    name,
    kind: 'remote',
    url: `http://0.0.0.0:${port}`,
    platform: process.platform,
    arch: process.arch,
    cpuCores: cpus().length,
    memGb: Math.round(totalmem() / 1024 ** 3),
    maxSessions,
    activeSessions: 0,
    localModels: config.perch.lendModels ? ['qwen3.6:35b-a3b'] : [],
    status: 'online',
    lastSeen: context.now(),
    latencyMs: 0,
  });

  const { nodeId } = await flock.register({ url: info.url ?? `http://0.0.0.0:${port}`, info });

  context.write(`${palette.green('✔')} Joined the flock as ${palette.bold(name)}`);
  context.write(`  ${palette.dim('node')}      ${nodeId}`);
  context.write(`  ${palette.dim('hub')}       ${palette.cyan(hub)}`);
  context.write(
    `  ${palette.dim('perch')}     ${palette.cyan(`http://0.0.0.0:${port}`)} ${palette.dim('(API lands in wave 2)')}`,
  );
  context.write(`  ${palette.dim('sessions')}  ${maxSessions} slots · 0 active`);
  context.write(
    `  ${palette.dim('models')}    ${info.localModels.length === 0 ? 'none lent' : info.localModels.join(', ')}`,
  );
  context.write(`  ${palette.dim('code')}      ${code}`);
  context.write();
  context.write(palette.dim('The daemon does not stay alive yet — this is the join handshake only.'));
  return 0;
}
