import type { StarlingConfig } from '@starling/core';
import type { CliContext } from '../context';
import type { DoctorDeps, DoctorHost } from '../doctor';
import { doctorJson, hostIdentity, runDoctor } from '../doctor';
import { renderDoctor } from '../render/doctor';

/**
 * Test hooks: the real probes spawn a child process and bind ports, which unit tests must never do.
 * Production calls pass nothing and get the real `opencode serve` probe.
 */
export type DoctorCommandOverrides = Pick<
  DoctorDeps,
  'spawnFn' | 'freePort' | 'portFree' | 'networkInterfacesFn' | 'readFileFn' | 'rootDir' | 'cpuCores'
> & {
  serverProbe?: boolean;
  host?: DoctorHost;
};

/**
 * `starling doctor` — an actionable environment report.
 *
 * `--json` prints one object on stdout and nothing else (for CI and `jq`); the human report is the
 * default. Exit code 1 when a required check fails, so `starling doctor` works as a preflight step.
 */
export async function doctorCommand(
  options: Record<string, unknown>,
  context: CliContext,
  overrides: DoctorCommandOverrides = {},
): Promise<number> {
  const { host: injectedHost, ...probes } = overrides;
  const host = injectedHost ?? hostIdentity();
  const injected: StarlingConfig | undefined = context.deps.config;

  const result = await runDoctor({
    ...probes,
    execFn: context.execFn,
    cwd: context.cwd,
    env: context.env,
    ...(context.deps.configPath === undefined ? {} : { configPath: context.deps.configPath }),
    ...(injected === undefined
      ? {}
      : { loadConfigFn: (_path?: string, _cwd?: string): StarlingConfig => injected }),
    ...(context.deps.freeMemGb === undefined ? {} : { freeMemGb: context.deps.freeMemGb }),
    ...(context.deps.totalMemGb === undefined ? {} : { totalMemGb: context.deps.totalMemGb }),
    ...(context.deps.fetchFn === undefined ? {} : { fetchFn: context.deps.fetchFn }),
  });

  if (options.json === true) {
    context.write(doctorJson(result, host));
    return result.ok ? 0 : 1;
  }

  context.write(
    renderDoctor(result, {
      palette: context.palette,
      width: context.columns,
      banner: `${host.platform}/${host.arch} · bun ${host.bun ?? 'unknown'}`,
    }),
  );
  return result.ok ? 0 : 1;
}
