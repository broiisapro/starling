import type { LLMRequest, ModelRole, StarlingConfig } from '@starling/core';
import { loadConfig, systemClock } from '@starling/core';
import type { ZodType } from 'zod';
import type { ProfileResolution, ProfileWarning } from './profiles';
import {
  describeProfile,
  MIXED_LOCAL_ROLES,
  OPENCODE_DEFAULT_MODEL,
  parseProfile,
  resolveProfile,
} from './profiles';
import { type OllamaProbeOptions, probeOllama } from './profiles-probe';
import { chooseLocalModel, type LocalHostProfile } from './profiles-recommend';
import { createLLM } from './router';
import type { CallOptions, LLMClient, LLMFromEnvOptions } from './types';

/** How long a `mixed` probe result is trusted before Ollama is asked again. */
export const MIXED_PROBE_TTL_MS = 60_000;

export interface EnvProfileOptions extends LLMFromEnvOptions {
  /** Recommendation file; defaults to `<cwd>/tools/local-models/results/recommendation.json`. */
  recommendationPath?: string;
  /** Force the laptop profile instead of deriving it from RAM / `STARLING_LOCAL_PROFILE`. */
  localProfile?: LocalHostProfile;
  /** Force the local model, beating both the env var and the recommendation file. */
  localModel?: string;
  /** Ignore `tools/local-models/results/recommendation.json` (hermetic tests, CI, air-gapped hosts). */
  skipRecommendation?: boolean;
  /** Set by a preflight; `mixed` falls back to opencode immediately when false. */
  localAvailable?: boolean;
  /** Skip the lazy Ollama probe: `mixed` stays local-first (tests, or a host that just probed). */
  skipLocalProbe?: boolean;
  /** Ollama probe knobs (base URL, fetch, timeout) for the `mixed` fallback. */
  ollama?: Omit<OllamaProbeOptions, 'model'>;
  /** Receives warnings when there is no `EventBus` (the CLI prints them, the engine logs them). */
  onWarning?: (warning: ProfileWarning) => void;
}

function emitLog(opts: EnvProfileOptions, level: 'debug' | 'info' | 'warn', msg: string): void {
  opts.bus?.publish({
    type: 'log',
    runId: '*',
    ts: (opts.clock ?? systemClock).now(),
    payload: { level, msg },
  });
}

/**
 * Resolve `STARLING_LLM_PROFILE` (plus the local-model recommendation) into a routing table.
 *
 * Synchronous and side-effect free: it reads the recommendation file, but never touches Ollama.
 * Use this for `starling doctor`, plan previews and tests.
 */
export function resolveLLMProfile(opts: EnvProfileOptions = {}): ProfileResolution {
  const env = opts.env ?? process.env;
  const config = opts.config ?? loadConfig(opts.configPath, opts.cwd);
  const profile = parseProfile(env.STARLING_LLM_PROFILE);
  if (profile === 'deepseek' || profile === 'opencode') return resolveProfile(config, profile);

  const choice = chooseLocalModel({
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.recommendationPath === undefined ? {} : { recommendationPath: opts.recommendationPath }),
    ...(opts.localProfile === undefined ? {} : { host: opts.localProfile }),
    ...(opts.skipRecommendation === undefined ? {} : { skipRecommendation: opts.skipRecommendation }),
    env,
  });
  const resolution = resolveProfile(config, profile, {
    localModel: opts.localModel ?? choice.model,
    localSmallModel: opts.localModel ?? choice.smallModel,
    ...(opts.ollama?.baseUrl === undefined ? {} : { ollamaBaseUrl: opts.ollama.baseUrl }),
    ...(opts.localAvailable === undefined ? {} : { localAvailable: opts.localAvailable }),
  });
  resolution.notes = [
    `local model ${choice.model} (${choice.source}, host ${choice.host})`,
    ...choice.warnings,
  ];
  return resolution;
}

/** Emit every warning on the bus (and to `onWarning`), once per resolution. */
export function reportProfile(resolution: ProfileResolution, opts: EnvProfileOptions = {}): void {
  for (const note of resolution.notes) emitLog(opts, 'info', note);
  for (const warning of resolution.warnings) {
    emitLog(opts, 'warn', warning.message);
    opts.onWarning?.(warning);
  }
}

/** The `mixed` fallback table: the prose roles move to opencode, everything else is unchanged. */
export function opencodeFallbackConfig(
  config: StarlingConfig,
  roles: ModelRole[] = MIXED_LOCAL_ROLES,
): StarlingConfig {
  const models = { ...config.models };
  for (const role of roles) models[role] = { provider: 'opencode', model: OPENCODE_DEFAULT_MODEL };
  return { ...config, models };
}

/**
 * Convenience wiring for the CLI and the server: load `starling.config.yaml` from `cwd` (or use the
 * defaults), apply `STARLING_LLM_PROFILE`, and read the local-model recommendation.
 *
 * `mixed` is the one profile with a runtime decision, so it is wrapped: the first call to a local
 * role probes Ollama (cached for {@link MIXED_PROBE_TTL_MS}) and, if the daemon is down or the model
 * is missing, that call — and every later one — goes to opencode with a `log`/`warn` event. Probing
 * lazily means a run never fails to *start* because Ollama was slow, and a model pulled mid-run is
 * picked up without a restart.
 */
export function createLLMFromEnv(opts: EnvProfileOptions = {}): LLMClient {
  const env = opts.env ?? process.env;
  const resolution = resolveLLMProfile(opts);
  reportProfile(resolution, opts);

  const primary = createLLM(resolution.config, { ...opts, env });
  if (resolution.profile !== 'mixed') return primary;

  const localRoles = new Set<ModelRole>(resolution.localRoles);
  if (localRoles.size === 0 || opts.skipLocalProbe === true) return primary;

  const fallback = createLLM(opencodeFallbackConfig(resolution.config, [...localRoles]), { ...opts, env });
  const clock = opts.clock ?? systemClock;
  const model = resolution.config.models.auditor.model;
  let available: boolean | undefined;
  let probedAt = Number.NEGATIVE_INFINITY;

  const probe = async (): Promise<boolean> => {
    const now = clock.now();
    if (available !== undefined && now - probedAt < MIXED_PROBE_TTL_MS) return available;
    const result = await probeOllama({
      ...opts.ollama,
      ...(opts.ollama?.baseUrl === undefined && resolution.config.providers.ollama !== undefined
        ? { baseUrl: resolution.config.providers.ollama.baseUrl }
        : {}),
      ...(opts.ollama?.fetch === undefined && opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
      model,
    });
    available = result.ok;
    probedAt = now;
    if (!result.ok) {
      const warning: ProfileWarning = {
        code: result.code ?? 'local-unavailable',
        message: `${result.detail}; falling back to opencode/${OPENCODE_DEFAULT_MODEL} for ${[
          ...localRoles,
        ].join(', ')}`,
      };
      emitLog(opts, 'warn', warning.message);
      opts.onWarning?.(warning);
    } else {
      emitLog(opts, 'info', result.detail);
    }
    return result.ok;
  };

  const pick = async (role: ModelRole): Promise<LLMClient> => {
    if (!localRoles.has(role)) return primary;
    return (await probe()) ? primary : fallback;
  };

  return {
    async complete(req: LLMRequest, callOpts: CallOptions = {}) {
      const llm = await pick(req.role);
      return llm.complete(req, callOpts);
    },
    async completeJson<T>(req: LLMRequest, schema: ZodType<T>, callOpts: CallOptions = {}) {
      const llm = await pick(req.role);
      return llm.completeJson(req, schema, callOpts);
    },
  };
}

/** Re-exported so a caller can log the resolved profile without importing three modules. */
export { describeProfile };
