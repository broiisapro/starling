import type { ModelRef, ModelRole, ModelsConfig, StarlingConfig } from '@starling/core';
import { StarlingError } from '@starling/core';

/**
 * Named routing profiles, selected with `STARLING_LLM_PROFILE`.
 *
 * - `deepseek` — the default config: planner/worker/resolver on DeepSeek, auditor/writer on Ollama.
 * - `local` — every role to Ollama, so no token leaves the laptop (the `--fully-open` promise).
 * - `opencode` — every role through the user's opencode server, for people with no direct API key.
 */
export const LLM_PROFILES = ['opencode', 'deepseek', 'local'] as const;
export type LLMProfileName = (typeof LLM_PROFILES)[number];

export const DEFAULT_LLM_PROFILE: LLMProfileName = 'deepseek';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4.1-flash';
export const LOCAL_DEFAULT_MODEL = 'qwen3.6:35b-a3b';
/** `providerID/modelID` as opencode expects it; split by the router before the HTTP call. */
export const OPENCODE_DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash';

const ALL_ROLES: ModelRole[] = ['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer'];

function everyRole(ref: ModelRef): ModelsConfig {
  return Object.fromEntries(ALL_ROLES.map((role) => [role, { ...ref }])) as ModelsConfig;
}

/** `undefined` means "not set"; an unknown value is a config error, not a silent fallback. */
export function parseProfile(value: string | undefined): LLMProfileName {
  if (value === undefined || value.trim() === '') return DEFAULT_LLM_PROFILE;
  const found = LLM_PROFILES.find((profile) => profile === value.trim());
  if (found === undefined) {
    throw new StarlingError(
      'CONFIG_INVALID',
      `Unknown STARLING_LLM_PROFILE "${value}" (expected one of: ${LLM_PROFILES.join(', ')})`,
      { details: { value, profiles: [...LLM_PROFILES] } },
    );
  }
  return found;
}

function opencodeBaseUrl(config: StarlingConfig): string {
  if (config.opencode.url !== null && config.opencode.url !== '') return config.opencode.url;
  return `http://127.0.0.1:${config.opencode.port}`;
}

/** Apply a routing profile over an already-valid config. Pure; never mutates the input. */
export function applyProfile(config: StarlingConfig, profile: LLMProfileName): StarlingConfig {
  switch (profile) {
    case 'deepseek':
      return config;
    case 'local':
      return {
        ...config,
        models: everyRole({ provider: 'ollama', model: LOCAL_DEFAULT_MODEL }),
        providers: {
          ollama: { baseUrl: 'http://127.0.0.1:11434/v1' },
          ...config.providers,
        },
      };
    case 'opencode':
      return {
        ...config,
        models: everyRole({ provider: 'opencode', model: OPENCODE_DEFAULT_MODEL }),
        providers: {
          ...config.providers,
          opencode: {
            baseUrl: opencodeBaseUrl(config),
            apiKeyEnv: 'OPENCODE_SERVER_PASSWORD',
          },
        },
      };
  }
}
