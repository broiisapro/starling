import type { ModelRef, ModelRole, ModelsConfig, StarlingConfig } from '@starling/core';
import { StarlingError } from '@starling/core';

/**
 * Named routing profiles, selected with `STARLING_LLM_PROFILE`.
 *
 * - `deepseek` — the default config: planner/worker/resolver on DeepSeek, auditor/writer on Ollama.
 * - `local` — every role on Ollama, so no token leaves the laptop (the `--fully-open` promise).
 * - `mixed` — the demo default: hard reasoning (planner, worker, resolver) on DeepSeek through the
 *   user's opencode server, high-volume prose (auditor, summarizer, writer) on Ollama when it is
 *   reachable, otherwise on opencode with a warning.
 * - `opencode` — every role through the user's opencode server, for people with no direct API key.
 */
export const LLM_PROFILES = ['opencode', 'deepseek', 'local', 'mixed'] as const;
export type LLMProfileName = (typeof LLM_PROFILES)[number];

export const DEFAULT_LLM_PROFILE: LLMProfileName = 'deepseek';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4.1-flash';

/**
 * The local open-weight model Starling recommends when no benchmark recommendation exists.
 *
 * `qwen3.8:27b-mlx` measured ~18 GB resident, ~18 tok/s warm and a correct audit verdict on the M5
 * Pro (docs/epic-02-repo-ops.md, docs/epic-28-local-bench.md). `tools/local-models/recommend.ts`
 * can override this per laptop; see `profiles-recommend.ts`.
 */
export const LOCAL_DEFAULT_MODEL = 'qwen3.8:27b-mlx';
/** Provider id for Ollama, both as an OpenAI-compatible endpoint and as opencode's providerID. */
export const LOCAL_PROVIDER = 'ollama';
export const LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1';
/** `providerID/modelID` as opencode expects it; split by the router before the HTTP call. */
export const OPENCODE_DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash';

const ALL_ROLES: ModelRole[] = ['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer'];

/**
 * Roles the `mixed` profile sends to the local model.
 *
 * These are the high-volume, low-risk calls: judging a diff, summarising a file, writing a PR body.
 * Coding (worker/resolver) and planning stay on DeepSeek because a wrong diff costs more than a
 * token bill.
 */
export const MIXED_LOCAL_ROLES: ModelRole[] = ['auditor', 'summarizer', 'writer'];
/** Roles that always run through opencode for `mixed` (and therefore on DeepSeek today). */
export const MIXED_CLOUD_ROLES: ModelRole[] = ['planner', 'worker', 'resolver'];

export type ProfileWarningCode = 'local-unavailable' | 'local-model-missing';

export interface ProfileWarning {
  code: ProfileWarningCode;
  message: string;
}

export interface ProfileOptions {
  /** Ollama tag for the reasoning local roles (planner/auditor/worker/resolver). */
  localModel?: string;
  /** Ollama tag for the prose roles (summarizer/writer); defaults to `localModel`. */
  localSmallModel?: string;
  /**
   * `true` — Ollama answered and the model is present.
   * `false` — it did not; `mixed` falls back to opencode immediately.
   * `undefined` — not probed: stay local-first (the `local` promise) and let the call fail loudly.
   */
  localAvailable?: boolean;
  /** Why `localAvailable` is false; drives the warning code. Defaults to `local-unavailable`. */
  localReason?: ProfileWarningCode;
  /** Override the Ollama base URL only when the config has no `ollama` provider yet. */
  ollamaBaseUrl?: string;
}

export interface ProfileResolution {
  profile: LLMProfileName;
  config: StarlingConfig;
  warnings: ProfileWarning[];
  /** Informational lines (which local model was chosen and why); never errors. */
  notes: string[];
  /** Roles that call Ollama's OpenAI-compatible endpoint directly. */
  localRoles: ModelRole[];
  /** Roles that a worker prompt sends to the opencode server (worker/resolver) or the router does. */
  opencodeRoles: ModelRole[];
}

/** `undefined` means "not set"; an unknown value is a config error, not a silent fallback. */
export function parseProfile(value: string | undefined): LLMProfileName {
  if (value === undefined || value.trim() === '') return DEFAULT_LLM_PROFILE;
  const trimmed = value.trim();
  // `--fully-open` is the user-facing flag; accepting it as an alias keeps the two spellings honest.
  const normalised = trimmed === 'fully-open' ? 'local' : trimmed;
  const found = LLM_PROFILES.find((profile) => profile === normalised);
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

function opencodeProvider(config: StarlingConfig): StarlingConfig['providers'][string] {
  return { baseUrl: opencodeBaseUrl(config), apiKeyEnv: 'OPENCODE_SERVER_PASSWORD' };
}

/** Ollama's provider entry, keeping whatever the user already configured. */
function withOllamaProvider(config: StarlingConfig, baseUrl: string): StarlingConfig['providers'] {
  if (config.providers[LOCAL_PROVIDER] !== undefined) return config.providers;
  return { ...config.providers, [LOCAL_PROVIDER]: { baseUrl } };
}

function localModels(options: ProfileOptions): ModelsConfig {
  const large = options.localModel ?? LOCAL_DEFAULT_MODEL;
  const small = options.localSmallModel ?? large;
  const reasoning: ModelRef = { provider: LOCAL_PROVIDER, model: large };
  const prose: ModelRef = { provider: LOCAL_PROVIDER, model: small };
  return {
    planner: { ...reasoning },
    worker: { ...reasoning },
    resolver: { ...reasoning },
    auditor: { ...reasoning },
    summarizer: { ...prose },
    writer: { ...prose },
  };
}

function opencodeModel(): ModelRef {
  return { provider: 'opencode', model: OPENCODE_DEFAULT_MODEL };
}

/**
 * Build the model map and providers for a profile. Pure; never mutates the input.
 *
 * `applyProfile` drops the warnings; `resolveProfile` keeps them. Call this through
 * `resolveProfile` unless the caller genuinely only wants the config.
 */
export function resolveProfile(
  config: StarlingConfig,
  profile: LLMProfileName,
  options: ProfileOptions = {},
): ProfileResolution {
  const ollamaBaseUrl = options.ollamaBaseUrl ?? LOCAL_BASE_URL;
  const warnings: ProfileWarning[] = [];

  switch (profile) {
    case 'deepseek':
      return { profile, config, warnings, notes: [], localRoles: [], opencodeRoles: [] };

    case 'local':
      return {
        profile,
        config: {
          ...config,
          models: localModels(options),
          providers: withOllamaProvider(config, ollamaBaseUrl),
        },
        warnings,
        notes: [],
        localRoles: [...ALL_ROLES],
        // Workers and the resolver are executed by opencode, which reaches the same Ollama model
        // through its `ollama` provider — so they are local too, just by a different road.
        opencodeRoles: ['worker', 'resolver'],
      };

    case 'opencode':
      return {
        profile,
        config: {
          ...config,
          models: Object.fromEntries(ALL_ROLES.map((role) => [role, opencodeModel()])) as ModelsConfig,
          providers: { ...config.providers, opencode: opencodeProvider(config) },
        },
        warnings,
        notes: [],
        localRoles: [],
        opencodeRoles: [...ALL_ROLES],
      };

    case 'mixed': {
      const models = localModels(options);
      const opencode = opencodeModel();
      for (const role of MIXED_CLOUD_ROLES) models[role] = { ...opencode };

      if (options.localAvailable === false) {
        const code = options.localReason ?? 'local-unavailable';
        for (const role of MIXED_LOCAL_ROLES) models[role] = { ...opencode };
        warnings.push({
          code,
          message:
            `local model unavailable (${code}); ${MIXED_LOCAL_ROLES.join(', ')} fall back to ` +
            `opencode/${OPENCODE_DEFAULT_MODEL}`,
        });
      }

      return {
        profile,
        config: {
          ...config,
          models,
          providers: {
            ...withOllamaProvider(config, ollamaBaseUrl),
            opencode: { ...opencodeProvider(config), ...config.providers.opencode },
          },
        },
        warnings,
        notes: [],
        localRoles: options.localAvailable === false ? [] : [...MIXED_LOCAL_ROLES],
        opencodeRoles: options.localAvailable === false ? [...ALL_ROLES] : [...MIXED_CLOUD_ROLES],
      };
    }
  }
}

/** `resolveProfile(...).config`, for callers that only need the routing table. */
export function applyProfile(
  config: StarlingConfig,
  profile: LLMProfileName,
  options: ProfileOptions = {},
): StarlingConfig {
  return resolveProfile(config, profile, options).config;
}

/** One-line summaries for `starling doctor`, logs and the dashboard. */
export function describeProfile(resolution: ProfileResolution): string[] {
  const roles = ALL_ROLES.map((role) => {
    const ref = resolution.config.models[role];
    return `${role}=${ref.provider}/${ref.model}`;
  });
  const lines = [`profile ${resolution.profile}: ${roles.join(' ')}`];
  for (const note of resolution.notes) lines.push(`note ${note}`);
  for (const warning of resolution.warnings) lines.push(`warn ${warning.code}: ${warning.message}`);
  return lines;
}
