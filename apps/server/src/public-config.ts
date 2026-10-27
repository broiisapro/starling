/**
 * `GET /api/config/public` — the small, secret-free slice of the configuration the dashboard header
 * needs.
 *
 * The hub owns the real config (API keys, provider URLs, budgets). A browser must never see that, so
 * this module projects it down to four facts: the build version, the active LLM profile, one model id
 * per role, and whether a flock hub is attached. Nothing here can leak a key: model ids and profile
 * names are already printable.
 */
import type { ModelRef, ModelRole } from '@starling/core';

export const MODEL_ROLES: readonly ModelRole[] = [
  'planner',
  'worker',
  'resolver',
  'auditor',
  'summarizer',
  'writer',
];

/** L29: the Wave 2 default profile routes every role through the user's opencode server. */
export const DEFAULT_PROFILE = 'opencode';

/** L29's model, used for every role when the profile is `opencode`. */
export const OPENCODE_MODEL = 'deepseek-v4.1-flash';

/**
 * ARCHITECTURE §2/§5 defaults for the API/Ollama profile. With `profile: 'opencode'` every role uses
 * one model instead; the profile is what the header shows in parentheses.
 */
export const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  planner: 'deepseek-v4.1-flash',
  worker: 'deepseek-v4.1-flash',
  resolver: 'deepseek-v4.1-flash',
  auditor: 'qwen3.6:35b-a3b',
  summarizer: 'qwen3.6:35b-a3b',
  writer: 'qwen3.6:35b-a3b',
};

/** The JSON body of `GET /api/config/public`. */
export interface PublicConfig {
  version: string;
  /** `opencode`, `deepseek`, `ollama`, … — the active routing profile. */
  profile: string;
  /** Model id per role. Deliberately ids only: providers are implied by the profile. */
  models: Record<ModelRole, string>;
  flockEnabled: boolean;
}

/** What a composition root may inject; everything is optional and defaulted. */
export interface PublicConfigInput {
  profile?: string;
  /** A model id string, or a `ModelRef` whose `model` half is published. */
  models?: Partial<Record<ModelRole, string | ModelRef>>;
}

/** Environment variable that selects the routing profile (L29). */
export const PROFILE_ENV = 'STARLING_LLM_PROFILE';

/** A model id from either config shape. */
export function modelIdOf(value: string | ModelRef): string {
  return typeof value === 'string' ? value : value.model;
}

/** `STARLING_LLM_PROFILE`, else `opencode` (L29). Empty strings count as unset. */
export function resolveProfile(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[PROFILE_ENV]?.trim();
  const candidate = explicit?.trim() ?? (fromEnv === undefined || fromEnv === '' ? undefined : fromEnv);
  return candidate === undefined ? DEFAULT_PROFILE : candidate;
}

/** The per-role defaults for a profile: one model for opencode, §5's split otherwise. */
export function defaultModelsFor(profile: string): Record<ModelRole, string> {
  const models = {} as Record<ModelRole, string>;
  for (const role of MODEL_ROLES) {
    models[role] = profile === DEFAULT_PROFILE ? OPENCODE_MODEL : DEFAULT_ROLE_MODELS[role];
  }
  return models;
}

/**
 * Build the published config. `flockEnabled` is derived by the caller from `deps.flock !== undefined`
 * so this module stays a pure function of its inputs.
 */
export function buildPublicConfig(
  input: PublicConfigInput | undefined,
  version: string,
  flockEnabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): PublicConfig {
  const profile = resolveProfile(input?.profile, env);
  const models = defaultModelsFor(profile);
  for (const role of MODEL_ROLES) {
    const override = input?.models?.[role];
    if (override !== undefined) models[role] = modelIdOf(override);
  }
  return { version, profile, models, flockEnabled };
}

/** One-line header label, e.g. `auditor: deepseek-v4.1-flash (opencode)`. */
export function modelLabel(config: PublicConfig, role: ModelRole): string {
  return `${role}: ${config.models[role]} (${config.profile})`;
}
