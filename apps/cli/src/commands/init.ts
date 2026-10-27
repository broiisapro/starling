import { basename } from 'node:path';
import type { CliContext } from '../context';
import { initConfig, type ModelProfile } from '../init';
import { failWith, readBoolean, readString } from './options';

const PROFILES = ['auto', 'opencode', 'deepseek', 'local'] as const;

/** `starling init` — write a commented, profile-aware `starling.config.yaml`. */
export async function initCommand(options: Record<string, unknown>, context: CliContext): Promise<number> {
  const requested = readString(options, 'profile') ?? 'auto';
  if (!(PROFILES as readonly string[]).includes(requested)) {
    failWith('INVALID_ARGUMENT', `--profile must be one of ${PROFILES.join(', ')}`);
  }

  const result = await initConfig({
    cwd: context.cwd,
    force: readBoolean(options, 'force'),
    profile: requested as ModelProfile | 'auto',
    execFn: context.execFn,
    env: context.env,
  });

  const label = result.profile === 'opencode' ? 'opencode-go' : result.profile;
  const verb = result.overwrote ? 'overwrote' : 'wrote';
  context.write(
    `${context.palette.green('✔')} ${verb} ${context.palette.bold(basename(result.path))}  ${context.palette.dim(`profile ${label}`)}`,
  );
  context.write(`  ${context.palette.dim('path')} ${result.path}`);
  context.write();
  context.write(context.palette.dim('Next:'));
  context.write(`  starling doctor`);
  context.write(`  starling plan "add dark mode"`);
  return 0;
}
