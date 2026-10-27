import { loadConfig } from '@starling/core';
import { applyProfile, parseProfile } from './profiles';
import { createLLM } from './router';
import type { LLMClient, LLMFromEnvOptions } from './types';

/**
 * Convenience wiring for the CLI and the server: load `starling.config.yaml` from `cwd` (or use the
 * defaults), then apply `STARLING_LLM_PROFILE=opencode|deepseek|local`.
 */
export function createLLMFromEnv(opts: LLMFromEnvOptions = {}): LLMClient {
  const env = opts.env ?? process.env;
  const config = opts.config ?? loadConfig(opts.configPath, opts.cwd);
  const profile = parseProfile(env.STARLING_LLM_PROFILE);
  return createLLM(applyProfile(config, profile), { ...opts, env });
}
