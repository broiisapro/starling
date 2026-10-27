import type { StarlingConfig } from '@starling/core';
import type { ComposePerchOptions } from '@starling/perch';

export type { ComposePerchOptions, RealPerch } from '@starling/perch';
/**
 * Real perch wiring for `starling perch` (Epic 42).
 *
 * The composition itself lives in `@starling/perch` (`composePerch`) so it can be unit-tested without
 * spawning `opencode` or binding a port; this module is the CLI-shaped part: it turns
 * `starling.config.yaml` plus the command's flags into `ComposePerchOptions`.
 *
 * Not to be confused with `apps/cli/src/compose.ts`, which is the *engine* composition root (Epic 40's
 * lane). A perch never runs the engine: it only lends this machine's agent sessions to someone else's.
 */
export { composePerch, perchStatusLine } from '@starling/perch';

export interface PerchFlagOptions {
  hub?: string;
  code?: string;
  port?: number;
  maxSessions?: number;
  name?: string;
}

export interface PerchComposeInput {
  hub?: string;
  code?: string;
  port: number;
  maxSessions: number;
  name?: string;
  cacheDir: string;
  lendModels: boolean;
  heartbeatMs: number;
}

/**
 * Flags win over config; `name: 'auto'` means "let the OS tell us" (ComputerName, then hostname).
 *
 * `STARLING_HUB_URL` is an escape hatch for a hub that is not on the default `127.0.0.1:<server.port>`
 * (and for the loopback tools), without adding a flag to the locked CLI surface.
 */
export function perchComposeInput(
  config: StarlingConfig,
  flags: PerchFlagOptions,
  env: Record<string, string | undefined> = process.env,
): PerchComposeInput {
  const configuredName = config.perch.name.trim();
  return {
    hub: flags.hub ?? env.STARLING_HUB_URL,
    code: flags.code,
    port: flags.port ?? config.perch.port,
    maxSessions: flags.maxSessions ?? config.perch.maxSessions,
    name: flags.name ?? (configuredName === '' || configuredName === 'auto' ? undefined : configuredName),
    cacheDir: config.perch.cacheDir,
    lendModels: config.perch.lendModels,
    heartbeatMs: config.flock.heartbeatMs,
  };
}

/** The options `composePerch` needs, minus the pieces the command injects (mDNS, transport). */
export function perchComposeOptions(input: PerchComposeInput): ComposePerchOptions {
  return {
    ...(input.hub === undefined ? {} : { hub: input.hub }),
    ...(input.code === undefined ? {} : { code: input.code }),
    port: input.port,
    maxSessions: input.maxSessions,
    ...(input.name === undefined ? {} : { name: input.name }),
    cacheDir: input.cacheDir,
    lendModels: input.lendModels,
    heartbeatMs: input.heartbeatMs,
  };
}
