import type { CliContext } from '../context';
import { readNumber, requirePositiveInteger } from './options';

/** `starling dash` — print where the dashboard will be and how to boot it until Wave 2. */
export async function dashCommand(options: Record<string, unknown>, context: CliContext): Promise<number> {
  const config = context.loadStarlingConfig();
  const port = requirePositiveInteger(readNumber(options, 'port', config.server.port), '--port');
  const url = `http://localhost:${port}`;
  const { palette } = context;

  context.write(`${palette.bold('Starling dashboard')}`);
  context.write(`  ${palette.dim('url')}     ${palette.cyan(url)}`);
  context.write(`  ${palette.dim('api')}     ${palette.cyan(`${url}/api/health`)}`);
  context.write(
    `  ${palette.dim('state')}   ${palette.yellow('waiting for apps/server + apps/web (wave 2)')}`,
  );
  context.write(`  ${palette.dim('boot')}    bun run dev:server  ${palette.dim('·')}  bun run dev:web`);
  context.write(`  ${palette.dim('flock')}   starling flock`);
  context.write();
  context.write(palette.dim('Tip: `starling run "<goal>" --no-dash` skips this hint. 🐦'));
  return 0;
}
