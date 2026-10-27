import { existsSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { CONFIG_FILENAMES, defaultConfig, StarlingError } from '@starling/core';
import type { DoctorExec } from './doctor';
import { suggestMaxParallel } from './doctor';
import { measureAvailableMemGb, parseFlashModelIds } from './doctor-probes';

export type ModelProfile = 'opencode' | 'deepseek' | 'local';

export const CONFIG_FILE = CONFIG_FILENAMES[0];

/** The model id Starling uses when `opencode models` lists nothing DeepSeek-shaped. */
export const OPENCODE_MODEL = 'opencode-go/deepseek-v4.1-flash';
export const DEEPSEEK_MODEL = 'deepseek-v4.1-flash';
export const LOCAL_MODEL = 'qwen3.6:35b-a3b';

export interface HardwareInfo {
  cpuCores: number;
  freeMemGb: number;
  totalMemGb: number;
  /** From `suggestMaxParallel` in `doctor.ts` — the same number `starling doctor` prints. */
  suggestedMaxParallel: number;
}

export interface HardwareProbes {
  cpuCores?: () => number;
  /** Sync override for tests; otherwise the macOS-aware probe in `doctor-probes` runs. */
  freeMemGb?: () => number;
  totalMemGb?: () => number;
  execFn?: DoctorExec;
  cwd?: string;
  platform?: string;
}

/** The hardware numbers `init` writes into `maxParallel` and the comments around it. */
export async function detectHardware(probes: HardwareProbes = {}): Promise<HardwareInfo> {
  const cpuCores = (probes.cpuCores ?? (() => cpus().length))();
  const freeMemGb = await measureAvailableMemGb({
    cwd: probes.cwd ?? process.cwd(),
    ...(probes.freeMemGb === undefined ? {} : { freeMemGb: probes.freeMemGb }),
    ...(probes.execFn === undefined ? {} : { execFn: probes.execFn }),
    ...(probes.platform === undefined ? {} : { platform: probes.platform }),
  });
  const totalMemGb = (probes.totalMemGb ?? (() => totalmem() / 1024 ** 3))();
  return {
    cpuCores,
    freeMemGb,
    totalMemGb,
    suggestedMaxParallel: suggestMaxParallel({ cpuCores, freeMemGb }),
  };
}

export interface InitOptions {
  cwd: string;
  force?: boolean;
  profile?: ModelProfile | 'auto';
  /** Override the hardware suggestion (the interactive prompt fills this in). */
  maxParallel?: number;
  flockEnabled?: boolean;
  /** Print the config instead of writing it; never touches the filesystem. */
  dryRun?: boolean;
  execFn: DoctorExec;
  env?: Record<string, string | undefined>;
  hardware?: HardwareInfo;
  /** Pre-computed detection (the interactive command asks first, then writes). */
  detected?: DetectedProfile;
}

export interface InitResult {
  path: string;
  profile: ModelProfile;
  maxParallel: number;
  flockEnabled: boolean;
  overwrote: boolean;
  /** `false` for a dry run. */
  written: boolean;
  yaml: string;
}

/** What `detectProfile` found, and where it found it. */
export interface DetectedProfile {
  profile: ModelProfile;
  /** The exact `providerID/modelID` opencode reported; only for the `opencode` profile. */
  opencodeModel?: string;
  source: 'opencode' | 'deepseek-key' | 'fallback';
}

/**
 * Write `starling.config.yaml`, auto-detecting the friendliest model profile.
 *
 * Order matters: an existing opencode login is the least setup (ARCHITECTURE L25/L29 — no API key
 * needed), a direct DeepSeek key is next, and a fully local profile is the always-works fallback.
 * The generated file is ordinary YAML parsed by `loadConfig`, so it can never drift from the zod
 * schema's defaults for the scalar fields.
 */
export async function initConfig(options: InitOptions): Promise<InitResult> {
  const target = resolve(options.cwd, CONFIG_FILE);
  const existed = existsSync(target);
  const dryRun = options.dryRun === true;
  if (existed && options.force !== true && !dryRun) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `${CONFIG_FILE} already exists at ${target} — rerun with --force to overwrite it`,
      { details: { path: target } },
    );
  }

  const detected =
    options.detected ??
    (options.profile === undefined || options.profile === 'auto' ? await detectProfile(options) : undefined);
  const profile: ModelProfile =
    options.profile === undefined || options.profile === 'auto'
      ? (detected?.profile ?? 'local')
      : options.profile;
  const hardware = options.hardware ?? (await detectHardware());
  const maxParallel = options.maxParallel ?? hardware.suggestedMaxParallel;
  const flockEnabled = options.flockEnabled ?? defaultConfig.flock.enabled;

  const yaml = renderConfigYaml(profile, {
    maxParallel,
    flockEnabled,
    hardware,
    ...(profile === 'opencode' && detected?.profile === 'opencode' && detected.opencodeModel !== undefined
      ? { opencodeModel: detected.opencodeModel }
      : {}),
  });

  if (!dryRun) writeFileSync(target, yaml, 'utf8');
  return {
    path: target,
    profile,
    maxParallel,
    flockEnabled,
    overwrote: existed,
    written: !dryRun,
    yaml,
  };
}

/** Detect the model profile without ever throwing: an unavailable probe is just a fallback. */
export async function detectModelProfile(options: {
  execFn: DoctorExec;
  env?: Record<string, string | undefined>;
  cwd: string;
}): Promise<ModelProfile> {
  return (await detectProfile(options)).profile;
}

/**
 * The same detection, plus the model id to write into the config.
 *
 * Any DeepSeek V4.1 Flash in `opencode models` wins — whatever the provider prefix — because it
 * means opencode is already logged in somewhere and Starling needs no key at all. A direct
 * `DEEPSEEK_API_KEY` is the next best thing; a machine with neither gets the local profile.
 */
export async function detectProfile(options: {
  execFn: DoctorExec;
  env?: Record<string, string | undefined>;
  cwd: string;
}): Promise<DetectedProfile> {
  try {
    const result = await options.execFn(['opencode', 'models'], {
      cwd: options.cwd,
      timeoutMs: 15_000,
    });
    if (result.code === 0) {
      const [first] = parseFlashModelIds(result.stdout);
      if (first !== undefined) {
        return { profile: 'opencode', opencodeModel: first, source: 'opencode' };
      }
    }
  } catch {
    // No opencode on this machine — fall through to the API key / local checks.
  }

  const key = options.env?.DEEPSEEK_API_KEY;
  if (key !== undefined && key.length > 0) return { profile: 'deepseek', source: 'deepseek-key' };
  return { profile: 'local', source: 'fallback' };
}

export interface ConfigRenderOptions {
  maxParallel?: number;
  flockEnabled?: boolean;
  perchMaxSessions?: number;
  hardware?: HardwareInfo;
  /** `providerID/modelID` from `opencode models`; defaults to the opencode-go Flash. */
  opencodeModel?: string;
}

interface RoleRef {
  provider: string;
  model: string;
}

const ROLES = ['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer'] as const;
type Role = (typeof ROLES)[number];
type RoleModels = Record<Role, RoleRef>;

/** Six copies of the same ref, spelled out so the type stays a total record of the roles. */
function everyRole(ref: RoleRef): RoleModels {
  return {
    planner: { ...ref },
    worker: { ...ref },
    resolver: { ...ref },
    auditor: { ...ref },
    summarizer: { ...ref },
    writer: { ...ref },
  };
}

function modelRefs(profile: ModelProfile, opencodeModel?: string): RoleModels {
  if (profile === 'local') return everyRole({ provider: 'ollama', model: LOCAL_MODEL });
  if (profile === 'deepseek') {
    return {
      ...everyRole({ provider: 'ollama', model: LOCAL_MODEL }),
      planner: { provider: 'deepseek', model: DEEPSEEK_MODEL },
      worker: { provider: 'deepseek', model: DEEPSEEK_MODEL },
      resolver: { provider: 'deepseek', model: DEEPSEEK_MODEL },
    };
  }
  // `opencode`: every role through the user's server. This mirrors `applyProfile(config,'opencode')`
  // in @starling/llm, so `STARLING_LLM_PROFILE=opencode` changes nothing about a generated config.
  return everyRole({ provider: 'opencode', model: opencodeModel ?? OPENCODE_MODEL });
}

const PROFILE_NOTES: Record<ModelProfile, string[]> = {
  opencode: [
    'every role goes through your local opencode server and the model you are already',
    'logged in to, so Starling reads no API keys. The provider *name* must stay',
    '`opencode` (it selects the opencode client); the model is `providerID/modelID`.',
    'Equivalent one-liner: STARLING_LLM_PROFILE=opencode starling run "…"',
  ],
  deepseek: [
    'planner/worker/resolver call the DeepSeek API with DEEPSEEK_API_KEY;',
    'auditor/summarizer/writer stay on local Ollama.',
    'Equivalent one-liner: STARLING_LLM_PROFILE=deepseek starling run "…"',
  ],
  local: [
    'every role on Ollama, nothing leaves the laptop (the --fully-open promise).',
    'Equivalent one-liner: STARLING_LLM_PROFILE=local starling run "…" --fully-open',
  ],
};

/**
 * Render the config template. Scalar values come from `defaultConfig`; the profile-dependent bits
 * are the model refs, the provider entries and the comments that explain them.
 */
export function renderConfigYaml(profile: ModelProfile, options: ConfigRenderOptions = {}): string {
  const base = defaultConfig;
  const maxParallel = options.maxParallel ?? base.maxParallel;
  const flockEnabled = options.flockEnabled ?? base.flock.enabled;
  const perchMaxSessions = options.perchMaxSessions ?? base.perch.maxSessions;
  const models = modelRefs(profile, options.opencodeModel);
  const note = PROFILE_NOTES[profile].join('\n');

  const providerLines: string[] = [];
  if (profile === 'opencode') {
    providerLines.push(
      `  opencode: { baseUrl: http://127.0.0.1:${base.opencode.port}, apiKeyEnv: OPENCODE_SERVER_PASSWORD }`,
      '  # ↑ `starling run` spawns `opencode serve` on this port; use `opencode.url` to attach instead.',
    );
  } else if (profile === 'deepseek') {
    providerLines.push(
      `  deepseek: { baseUrl: ${base.providers.deepseek?.baseUrl ?? 'https://api.deepseek.com/v1'}, apiKeyEnv: DEEPSEEK_API_KEY }`,
    );
  }
  providerLines.push(
    '  ollama: { baseUrl: http://127.0.0.1:11434/v1 }   # local auditor/writer/--fully-open',
  );

  const role = (name: Role): string => {
    const ref = models[name];
    const label = `  ${name}:`.padEnd(15);
    return `${label}{ provider: ${ref.provider}, model: ${ref.model} }`;
  };

  const hardware = options.hardware;
  const hardwareNote =
    hardware === undefined
      ? ''
      : `\n# Hardware: ${hardware.cpuCores} cores, ${hardware.freeMemGb.toFixed(1)} GB RAM available of ${hardware.totalMemGb.toFixed(0)} GB\n# → ${hardware.suggestedMaxParallel} parallel agents (≈2 GB and one core each; the hub keeps one core).`;

  return `# Starling config — generated by \`starling init\`.
# Every field is optional; delete anything you are happy to inherit. See starling.config.example.yaml.
#
# Model profile: ${profile}
${note
  .split('\n')
  .map((line) => `#   ${line}`)
  .join('\n')}${hardwareNote}

# ── the flock ────────────────────────────────────────────────────────────────────────────
maxParallel: ${maxParallel}                      # agents running at once; hardware suggestion, override freely
maxAttempts: ${base.maxAttempts}                            # audit → fix rounds before a task is marked failed
baseBranch: ${base.baseBranch}                     # the branch a run starts from
integrationBranch: ${base.integrationBranch}            # starling/<runShort>/integration when "auto"
worktreeRoot: ${base.worktreeRoot}     # sibling of the repo; one git worktree per task
testCommand: ${base.testCommand}                   # "auto" lets the repo map detect it
lintCommand: ${base.lintCommand}

# ── the opencode server that hosts every worker session ─────────────────────────────────
opencode:
  mode: ${base.opencode.mode}                      # spawn | attach
  port: ${base.opencode.port}                     # spawn mode binds this port on 127.0.0.1
  url: null                    # attach mode only, e.g. http://127.0.0.1:4096

# ── which model each role uses ───────────────────────────────────────────────────────────
# opencode models are "providerID/modelID" when provider is \`opencode\`.
models:
${role('planner')}
${role('worker')}   # the role opencode agents run as
${role('resolver')}
${role('auditor')}
${role('summarizer')}
${role('writer')}

# ── endpoints ────────────────────────────────────────────────────────────────────────────
providers:
${providerLines.join('\n')}

github: { enabled: ${base.github.enabled}, repo: null }          # --github syncs issues/PRs via the gh CLI
budget: { maxUsd: ${base.budget.maxUsd} }                       # stop before spending more than this on the API
server: { port: ${base.server.port} }                     # the dashboard (starling dash) and the flock hub

# ── flock: lend this machine's slots, or join another hub as a perch ─────────────────────
flock:
  enabled: ${flockEnabled}
  hubMaxSessions: ${maxParallel}          # LocalNode capacity on this machine (maxParallel is the run-wide cap)
  mdns: ${base.flock.mdns}                     # advertise _starling._tcp so other laptops find the hub
  heartbeatMs: ${base.flock.heartbeatMs}                # perch → hub ping interval
  offlineAfterMs: ${base.flock.offlineAfterMs}            # a perch silent this long is offline; its tasks are rescheduled

perch:                       # used by \`starling perch\`
  port: ${base.perch.port}                    # this machine's Perch API port (server.port + 1)
  maxSessions: ${perchMaxSessions}               # sessions this machine lends when it is a perch
  name: ${base.perch.name}                 # "auto" → hostname
  cacheDir: ${base.perch.cacheDir}
  lendModels: ${base.perch.lendModels}            # expose local Ollama models to the hub
`;
}
