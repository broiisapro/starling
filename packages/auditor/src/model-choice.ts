import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import type { LLM, ModelRef, StarlingConfig } from '@starling/core';
import { loadConfig, StarlingError } from '@starling/core';
import { applyProfile, createLLM } from '@starling/llm';

/**
 * Which model judges an audit, per routing profile (Epic 44).
 *
 * The auditor is the only role whose *default* differs between the demo profiles:
 *
 * | profile    | auditor                                                   | why                                     |
 * | ---------- | --------------------------------------------------------- | --------------------------------------- |
 * | `opencode` | DeepSeek V4.1 Flash through the user's opencode server    | no API key needed, best judgment today  |
 * | `local`    | the recommended Ollama model for this laptop              | private, $0, the `--fully-open` promise |
 * | `mixed`    | local *if* Ollama is up and the model is pulled, else opencode | workers on DeepSeek, judgment local |
 *
 * `deepseek` (core's default profile name) is accepted as an alias for `mixed`, because the demo
 * default config routes workers to DeepSeek and the auditor to Ollama.
 *
 * Epic 51 owns `@starling/llm`'s profiles; this module only *maps* them for the auditor role and
 * never changes them.
 */
export const AUDITOR_PROFILES = ['opencode', 'local', 'mixed'] as const;
export type AuditorProfile = (typeof AUDITOR_PROFILES)[number];

/** The config file changes rarely; this is what the auditor falls back to when nothing says otherwise. */
export const DEFAULT_AUDITOR_PROFILE: AuditorProfile = 'mixed';

/** `providerID/modelID` as opencode's API wants it (matches `@starling/llm`'s profile default). */
export const OPENCODE_AUDITOR_MODEL: ModelRef = {
  provider: 'opencode',
  model: 'opencode-go/deepseek-v4.1-flash',
};

/**
 * Last-resort local pick when `tools/local-models/results/recommendation.json` is absent and
 * `STARLING_AUDITOR_MODEL` is unset: the only model this repo has measured on the target laptop
 * (ARCHITECTURE L24, docs/epic-02-repo-ops.md).
 */
export const RECOMMENDED_LOCAL_AUDITOR_MODEL = 'qwen3.8:27b-mlx';

/** Where Epic 28's recommendation step writes its pick, relative to the repo root. */
export const RECOMMENDATION_PATH = join('tools', 'local-models', 'results', 'recommendation.json');

export type EnvSource = Record<string, string | undefined>;

export interface AuditorModelOptions {
  /** Raw profile name; defaults to `STARLING_AUDITOR_PROFILE` then `STARLING_LLM_PROFILE`. */
  profile?: string;
  /** Already-validated config; defaults to `loadConfig(cwd)`. */
  config?: StarlingConfig;
  env?: EnvSource;
  cwd?: string;
  /** Total RAM in GB, used to pick the mbp/air recommendation. Defaults to this machine's. */
  ramGb?: number;
  /** "Is this model usable right now?" Defaults to a real Ollama probe. Injected by tests. */
  probe?: (model: ModelRef, config: StarlingConfig) => Promise<boolean>;
}

export interface AuditorModelChoice {
  profile: AuditorProfile;
  /** The model that will judge, and the config that routes the `auditor` role to it. */
  model: ModelRef;
  config: StarlingConfig;
  /** True when the endpoint is loopback, so the call is free. */
  local: boolean;
  /** Set only when `mixed` wanted local and had to fall back (the caller logs it). */
  warning?: string;
}

function envValue(env: EnvSource, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * `undefined` means "use the default"; an unknown value is a config error, never a silent fallback.
 * `deepseek` is the core profile name for the demo default (mixed).
 */
export function parseAuditorProfile(raw: string | undefined): AuditorProfile {
  const value = raw?.trim();
  if (value === undefined || value === '') return DEFAULT_AUDITOR_PROFILE;
  if (value === 'deepseek') return 'mixed';
  const found = AUDITOR_PROFILES.find((profile) => profile === value);
  if (found === undefined) {
    throw new StarlingError(
      'CONFIG_INVALID',
      `Unknown auditor profile "${value}" (expected one of: ${AUDITOR_PROFILES.join(', ')}, deepseek)`,
      { details: { value, profiles: [...AUDITOR_PROFILES] } },
    );
  }
  return found;
}

/** `off` keeps the auditor fully deterministic (no model call). */
export type AuditorLlmMode = LLM | 'auto' | 'off';

/**
 * The default for `CreateAuditorOptions.llm`: auto-wire a model **only when the operator asked for a
 * profile**. Unit tests and the deterministic demo never set one, so `createAuditor()` stays offline
 * unless `STARLING_LLM_PROFILE`/`STARLING_AUDITOR_PROFILE` says otherwise.
 */
export function defaultLlmMode(env: EnvSource): AuditorLlmMode {
  return envValue(env, 'STARLING_AUDITOR_PROFILE') !== undefined ||
    envValue(env, 'STARLING_LLM_PROFILE') !== undefined
    ? 'auto'
    : 'off';
}

function stripProviderPrefix(model: string): string {
  return model.startsWith('ollama/') ? model.slice('ollama/'.length) : model;
}

interface Recommendation {
  mbp?: { auditor?: unknown };
  air?: { auditor?: unknown };
}

function readRecommendation(cwd: string): Recommendation | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, RECOMMENDATION_PATH), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Recommendation) : undefined;
  } catch {
    // Absent or unreadable is the normal case before Epic 28's bench has run.
    return undefined;
  }
}

/**
 * The Ollama tag this laptop should audit with: `STARLING_AUDITOR_MODEL` wins, then Epic 28's
 * `recommendation.json` for the matching RAM profile, then the measured 27B fallback.
 */
export function localAuditorModel(
  opts: Omit<AuditorModelOptions, 'probe' | 'config' | 'profile'> = {},
): string {
  const env = opts.env ?? process.env;
  const override = envValue(env, 'STARLING_AUDITOR_MODEL');
  if (override !== undefined) return stripProviderPrefix(override);

  const recommendation = readRecommendation(opts.cwd ?? process.cwd());
  const ramGb = opts.ramGb ?? totalmem() / 1024 ** 3;
  const picked = ramGb >= 24 ? recommendation?.mbp?.auditor : recommendation?.air?.auditor;
  return typeof picked === 'string' && picked.trim() !== ''
    ? stripProviderPrefix(picked.trim())
    : RECOMMENDED_LOCAL_AUDITOR_MODEL;
}

function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function sameTag(installed: string, wanted: string): boolean {
  if (installed === wanted) return true;
  const normalize = (tag: string): string => (tag.includes(':') ? tag : `${tag}:latest`);
  return normalize(installed) === normalize(wanted);
}

/**
 * Is this Ollama tag installed and is the daemon up? `/api/tags` needs no model load, so the probe
 * is cheap and does not warm a 27B model the rails would object to (L31).
 */
export async function probeOllamaModel(
  model: ModelRef,
  config: StarlingConfig,
  fetcher: typeof fetch = fetch,
  timeoutMs = 1_500,
): Promise<boolean> {
  const provider = config.providers[model.provider];
  if (provider === undefined) return false;
  try {
    const res = await fetcher(`${ollamaRoot(provider.baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: Array<{ name?: unknown; model?: unknown }> };
    return (body.models ?? []).some((entry) => {
      const name = typeof entry.name === 'string' ? entry.name : entry.model;
      return typeof name === 'string' && sameTag(name, model.model);
    });
  } catch {
    // Unreachable daemon is an answer ("use the fallback"), not an error to throw at the caller.
    return false;
  }
}

function localChoice(base: StarlingConfig, model: string): AuditorModelChoice {
  const config = applyProfile(base, 'local');
  return {
    profile: 'local',
    model: { provider: 'ollama', model },
    config: { ...config, models: { ...config.models, auditor: { provider: 'ollama', model } } },
    local: true,
  };
}

function opencodeChoice(base: StarlingConfig): AuditorModelChoice {
  const config = applyProfile(base, 'opencode');
  return {
    profile: 'opencode',
    model: { ...OPENCODE_AUDITOR_MODEL },
    config: { ...config, models: { ...config.models, auditor: { ...OPENCODE_AUDITOR_MODEL } } },
    local: false,
  };
}

/** Resolve the profile to a model and to the config that routes the `auditor` role to it. */
export async function chooseAuditorModel(opts: AuditorModelOptions = {}): Promise<AuditorModelChoice> {
  const env = opts.env ?? process.env;
  const base = opts.config ?? loadConfig(undefined, opts.cwd ?? process.cwd());
  const rawProfile =
    opts.profile ?? envValue(env, 'STARLING_AUDITOR_PROFILE') ?? envValue(env, 'STARLING_LLM_PROFILE');
  const profile = parseAuditorProfile(rawProfile);

  switch (profile) {
    case 'opencode':
      return opencodeChoice(base);
    case 'local':
      return localChoice(base, localAuditorModel({ ...opts, env }));
    case 'mixed': {
      const model = localAuditorModel({ ...opts, env });
      const probe = opts.probe ?? ((ref: ModelRef, config: StarlingConfig) => probeOllamaModel(ref, config));
      if (await probe({ provider: 'ollama', model }, base)) return localChoice(base, model);
      return {
        ...opencodeChoice(base),
        warning:
          `auditor profile "mixed" fell back to the opencode profile: ollama/${model} is not reachable ` +
          'or not pulled (`ollama ps` / `ollama list`). Audits will use the opencode server until it is.',
      };
    }
  }
}

/** Build the `LLM` for a choice. Kept separate so tests can inspect a choice without a provider. */
export function createLlmFor(choice: AuditorModelChoice, opts: { env?: EnvSource } = {}): LLM {
  return createLLM(choice.config, { env: opts.env ?? process.env });
}
