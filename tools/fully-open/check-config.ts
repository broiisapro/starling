/**
 * Keep `tools/fully-open/opencode-ollama.json` honest.
 *
 * The file is what makes the **workers** local: Starling hands opencode a `ModelRef` of
 * `{ provider: 'ollama', model: '<tag>' }`, opencode turns that into `providerID/modelID`, and the
 * provider entry below is where opencode learns how to reach Ollama. If the JSON drifts from the
 * profile — a stale `provider` (v1) key, `providers` spelled right but with the model under the
 * wrong id, a base URL without `/v1` — every worker fails at session start with a provider error
 * that says nothing about the real cause. So the drift is checked here, in a test, instead of on
 * demo day.
 *
 * Verified against opencode **2.1.2** (`opencode --version`), whose config schema
 * (`https://opencode.ai/config.json`) declares `providers` (plural) of `Config.ProviderEncoded`
 * (`package`, `settings`, `models[].modelID`) and whose built-in `opencode.provider.ollama` plugin
 * discovers tags from `/api/tags` and merges the result into that same entry.
 *
 *   bun tools/fully-open/check-config.ts [--file PATH] [--model TAG] [--base-url URL]
 */

import { readFileSync } from 'node:fs';

/** opencode providerID for the built-in Ollama plugin. Also the `ModelRef.provider` Starling uses. */
export const OPENCODE_PROVIDER_ID = 'ollama';
/** The client package the built-in plugin assigns to the Ollama provider. */
export const OPENCODE_PROVIDER_PACKAGE = '@opencode/ai/providers/openai-compatible';
/** Ollama's OpenAI-compatible surface; `stripPathSuffix` in the plugin strips `/v1` for discovery. */
export const OLLAMA_LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1';

export interface ConfigCheckInput {
  /** Ollama tag the `local` profile will route workers to, e.g. `qwen3.8:27b-mlx`. */
  model: string;
  /** Expected OpenAI-compatible base URL; defaults to {@link OLLAMA_LOCAL_BASE_URL}. */
  baseUrl?: string;
}

export interface ConfigCheck {
  ok: boolean;
  /** Everything that would break a local worker; empty means the file is usable. */
  problems: string[];
  /** Non-fatal remarks (missing `$schema`, extra models, …). */
  notes: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Trailing slashes never matter; a missing `/v1` always does. */
function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Check a parsed opencode config against the tag Starling's `local` profile will use.
 *
 * Pure: no I/O, no network. `ok` is true only when a worker session targeting
 * `ollama/<model>` could actually resolve a provider and a model.
 */
export function checkOpencodeConfig(raw: unknown, input: ConfigCheckInput): ConfigCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const expectedBaseUrl = normaliseUrl(input.baseUrl ?? OLLAMA_LOCAL_BASE_URL);

  const root = asRecord(raw);
  if (root === undefined) {
    return { ok: false, problems: ['config root is not a JSON object'], notes };
  }

  // opencode v1 called this key `provider`; v2 renamed it and dropped the old one.
  if (root.provider !== undefined) {
    problems.push('uses `provider` (opencode v1); opencode 2.x reads `providers` (plural)');
  }
  if (asString(root.$schema) === undefined) {
    notes.push('no `$schema`; editors cannot validate the file');
  }

  const providers = asRecord(root.providers);
  if (providers === undefined) {
    return { ok: false, problems: [...problems, 'missing `providers` object'], notes };
  }

  const provider = asRecord(providers[OPENCODE_PROVIDER_ID]);
  if (provider === undefined) {
    return {
      ok: false,
      problems: [...problems, `missing \`providers.${OPENCODE_PROVIDER_ID}\``],
      notes,
    };
  }

  const pkg = asString(provider.package);
  if (pkg !== OPENCODE_PROVIDER_PACKAGE) {
    problems.push(
      `providers.${OPENCODE_PROVIDER_ID}.package is ${pkg ?? 'missing'}, expected ${OPENCODE_PROVIDER_PACKAGE}`,
    );
  }

  const settings = asRecord(provider.settings);
  const baseUrl = settings === undefined ? undefined : asString(settings.baseURL);
  if (baseUrl === undefined) {
    problems.push(`providers.${OPENCODE_PROVIDER_ID}.settings.baseURL is missing`);
  } else if (normaliseUrl(baseUrl) !== expectedBaseUrl) {
    problems.push(`settings.baseURL is ${baseUrl}, expected ${expectedBaseUrl}`);
  }

  const models = asRecord(provider.models);
  const model = models === undefined ? undefined : asRecord(models[input.model]);
  if (model === undefined) {
    problems.push(
      `providers.${OPENCODE_PROVIDER_ID}.models has no \`${input.model}\` entry, so a worker on ` +
        'that tag depends on live discovery (Ollama must be up before opencode starts)',
    );
  } else {
    const modelID = asString(model.modelID);
    if (modelID !== undefined && modelID !== input.model) {
      problems.push(`models["${input.model}"].modelID is ${modelID}; the map key and the tag must match`);
    }
    const capabilities = asRecord(model.capabilities);
    if (capabilities?.tools !== true) {
      problems.push(`models["${input.model}"].capabilities.tools must be true — workers call tools`);
    }
    if (asString(model.name) === undefined) {
      notes.push(`models["${input.model}"].name is missing; the TUI will show the raw tag`);
    }
  }

  if (models !== undefined) {
    const keys = Object.keys(models);
    if (keys.length > 1) notes.push(`declares ${keys.length} models: ${keys.join(', ')}`);
  }

  const defaultModel = asString(root.model);
  const expectedDefault = `${OPENCODE_PROVIDER_ID}/${input.model}`;
  if (defaultModel !== undefined && defaultModel !== expectedDefault) {
    problems.push(`top-level \`model\` is ${defaultModel}, expected ${expectedDefault}`);
  }

  return { ok: problems.length === 0, problems, notes };
}

export interface ConfigFileCheck extends ConfigCheck {
  path: string;
}

/** Read + parse + check, folding I/O and JSON errors into `problems` instead of throwing. */
export function checkOpencodeConfigFile(path: string, input: ConfigCheckInput): ConfigFileCheck {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { path, ok: false, problems: [`cannot read ${path}: ${reason}`], notes: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { path, ok: false, problems: [`${path} is not valid JSON: ${reason}`], notes: [] };
  }
  return { path, ...checkOpencodeConfig(parsed, input) };
}

function argValue(argv: string[], name: string, fallback: string): string {
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1] as string;
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const here = new URL('.', import.meta.url).pathname;
  const result = checkOpencodeConfigFile(argValue(argv, 'file', `${here}opencode-ollama.json`), {
    model: argValue(argv, 'model', 'qwen3.8:27b-mlx'),
    baseUrl: argValue(argv, 'base-url', OLLAMA_LOCAL_BASE_URL),
  });
  for (const note of result.notes) console.error(`note: ${note}`);
  for (const problem of result.problems) console.error(`problem: ${problem}`);
  if (result.ok) console.log(`ok: ${result.path} can run ollama/${argValue(argv, 'model', 'qwen3.8:27b-mlx')}`);
  else process.exitCode = 1;
}
