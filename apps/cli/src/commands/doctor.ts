import type { StarlingConfig } from '@starling/core';
import type { CliContext } from '../context';
import { hostIdentity, runDoctor } from '../doctor';
import { renderDoctor } from '../render/doctor';

/** `starling doctor` — clean, actionable environment report. Exits 1 when a required check fails. */
export async function doctorCommand(_options: Record<string, unknown>, context: CliContext): Promise<number> {
  const identity = hostIdentity();
  const injected = context.deps.config;
  const result = await runDoctor({
    execFn: context.execFn,
    cwd: context.cwd,
    ...(context.deps.configPath === undefined ? {} : { configPath: context.deps.configPath }),
    ...(injected === undefined
      ? {}
      : { loadConfigFn: (_path?: string, _cwd?: string): StarlingConfig => injected }),
    ...(context.deps.freeMemGb === undefined ? {} : { freeMemGb: context.deps.freeMemGb }),
    ...(context.deps.totalMemGb === undefined ? {} : { totalMemGb: context.deps.totalMemGb }),
    ...(context.deps.fetchFn === undefined ? {} : { fetchFn: context.deps.fetchFn }),
  });

  const bun = process.versions.bun ?? 'unknown';
  context.write(
    renderDoctor(result, {
      palette: context.palette,
      width: context.columns,
      banner: `${identity.platform}/${identity.arch} · bun ${bun}`,
    }),
  );
  return result.ok ? 0 : 1;
}
