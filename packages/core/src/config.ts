import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ModelRef } from './contracts';
import { ModelRefSchema } from './contracts';
import { StarlingError } from './errors';

/** A provider endpoint. `apiKeyEnv` names the env var to read; local providers have none. */
export const ProviderConfigSchema = z.object({
  baseUrl: z.string(),
  apiKeyEnv: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const OpencodeConfigSchema = z.object({
  mode: z.enum(['spawn', 'attach']).default('spawn'),
  port: z.number().int().positive().default(4096),
  url: z.string().nullable().default(null),
});
export type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;

export const ModelsConfigSchema = z.object({
  planner: ModelRefSchema.default({ provider: 'deepseek', model: 'deepseek-v4.1-flash' }),
  worker: ModelRefSchema.default({ provider: 'deepseek', model: 'deepseek-v4.1-flash' }),
  resolver: ModelRefSchema.default({ provider: 'deepseek', model: 'deepseek-v4.1-flash' }),
  auditor: ModelRefSchema.default({ provider: 'ollama', model: 'qwen3.6:35b-a3b' }),
  summarizer: ModelRefSchema.default({ provider: 'ollama', model: 'qwen3.6:35b-a3b' }),
  writer: ModelRefSchema.default({ provider: 'ollama', model: 'qwen3.6:35b-a3b' }),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

export const FlockConfigSchema = z.object({
  enabled: z.boolean().default(true),
  hubMaxSessions: z.number().int().nonnegative().default(8),
  mdns: z.boolean().default(true),
  heartbeatMs: z.number().int().positive().default(3000),
  offlineAfterMs: z.number().int().positive().default(15000),
});
export type FlockConfig = z.infer<typeof FlockConfigSchema>;

export const PerchConfigSchema = z.object({
  port: z.number().int().positive().default(7778),
  maxSessions: z.number().int().positive().default(5),
  name: z.string().default('auto'),
  cacheDir: z.string().default('~/.starling/perch'),
  lendModels: z.boolean().default(true),
});
export type PerchConfig = z.infer<typeof PerchConfigSchema>;

export const StarlingConfigSchema = z.object({
  maxParallel: z.number().int().positive().default(8),
  maxAttempts: z.number().int().positive().default(3),
  baseBranch: z.string().default('main'),
  integrationBranch: z.string().default('auto'),
  worktreeRoot: z.string().default('../.starling-worktrees'),
  testCommand: z.string().default('auto'),
  lintCommand: z.string().default('auto'),
  opencode: OpencodeConfigSchema.default({ mode: 'spawn', port: 4096, url: null }),
  models: ModelsConfigSchema.default({
    planner: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    worker: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    resolver: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    auditor: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
    summarizer: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
    writer: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
  }),
  providers: z.record(z.string(), ProviderConfigSchema).default({
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    ollama: { baseUrl: 'http://127.0.0.1:11434/v1' },
  }),
  github: z
    .object({ enabled: z.boolean().default(false), repo: z.string().nullable().default(null) })
    .default({ enabled: false, repo: null }),
  budget: z.object({ maxUsd: z.number().nonnegative().default(5) }).default({ maxUsd: 5 }),
  server: z.object({ port: z.number().int().positive().default(7777) }).default({ port: 7777 }),
  flock: FlockConfigSchema.default({
    enabled: true,
    hubMaxSessions: 8,
    mdns: true,
    heartbeatMs: 3000,
    offlineAfterMs: 15000,
  }),
  perch: PerchConfigSchema.default({
    port: 7778,
    maxSessions: 5,
    name: 'auto',
    cacheDir: '~/.starling/perch',
    lendModels: true,
  }),
});
export type StarlingConfig = z.infer<typeof StarlingConfigSchema>;

export const defaultConfig: StarlingConfig = StarlingConfigSchema.parse({});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge a partial YAML object over defaults; arrays and scalars from `override` win outright. */
function mergeDeep(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? mergeDeep(out[key], value) : value;
  }
  return out;
}

/** The config file `loadConfig()` looks for when no path is given. */
export const CONFIG_FILENAMES = ['starling.config.yaml', 'starling.config.yml'] as const;

function findDefaultConfig(cwd: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Read a YAML config, merge it over `defaultConfig`, and validate it.
 *
 * - With an explicit `path`, a missing file is an error (`CONFIG_INVALID`); silence would hide typos.
 * - Without one, `starling.config.yaml` / `.yml` in `cwd` is used when present, else defaults.
 */
export function loadConfig(path?: string, cwd = process.cwd()): StarlingConfig {
  const file = path === undefined ? findDefaultConfig(cwd) : resolve(cwd, path);
  if (file === undefined) return StarlingConfigSchema.parse(defaultConfig);
  if (!existsSync(file)) {
    throw new StarlingError('CONFIG_INVALID', `Config file not found: ${file}`, { details: { path: file } });
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new StarlingError('CONFIG_INVALID', `Could not parse YAML config at ${file}`, { cause: err });
  }
  if (raw !== null && raw !== undefined && !isPlainObject(raw)) {
    throw new StarlingError('CONFIG_INVALID', `Config at ${file} must be a YAML mapping`);
  }

  const merged = mergeDeep(defaultConfig, raw ?? {});
  const parsed = StarlingConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new StarlingError('CONFIG_INVALID', `Invalid config at ${file}: ${parsed.error.message}`, {
      cause: parsed.error,
      details: { path: file, issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

/** Resolve a model role to its `ModelRef`, for code that would otherwise reach into config internals. */
export function modelFor(config: StarlingConfig, role: keyof ModelsConfig): ModelRef {
  return config.models[role];
}
