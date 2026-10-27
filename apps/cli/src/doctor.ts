import { existsSync } from 'node:fs';
import { freemem, arch as osArch, platform as osPlatform, totalmem } from 'node:os';
import { resolve } from 'node:path';
import {
  CONFIG_FILENAMES,
  defaultConfig,
  type ExecOptions,
  type ExecResult,
  isStarlingError,
  loadConfig,
  type StarlingConfig,
} from '@starling/core';

export type DoctorStatus = 'ok' | 'fail' | 'warn';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ok: boolean;
  okCount: number;
  failCount: number;
  warnCount: number;
}

export type DoctorExec = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

export interface DoctorDeps {
  execFn: DoctorExec;
  cwd?: string;
  configPath?: string;
  loadConfigFn?: (path?: string, cwd?: string) => StarlingConfig;
  freeMemGb?: () => number;
  totalMemGb?: () => number;
  /** Injected so unit tests never touch the network. */
  fetchFn?: typeof fetch;
  bunVersion?: string | null;
  platform?: string;
  arch?: string;
}

const MIN_GIT: [number, number] = [2, 38];
const FLASH_ID = /deepseek[\w.-]*v4[.-]?1[\w.-]*flash/i;
const OLLAMA_TIMEOUT_MS = 1500;

/**
 * Every environment check `starling doctor` performs.
 *
 * Side-effect free apart from the injected `exec`/`fetch` calls, so tests can drive every branch.
 * A missing optional dependency (Ollama) is a warning; a broken required one is a failure.
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult> {
  const cwd = deps.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];

  checks.push(await checkBun(deps));
  checks.push(await checkGit(deps, cwd));

  const opencode = await checkOpencode(deps, cwd);
  checks.push(opencode.check);
  checks.push(await checkFlashModel(deps, cwd, opencode.available));
  checks.push(await checkGh(deps, cwd));

  const config = safeConfig(deps, cwd);
  checks.push(config.check);

  checks.push(await checkOllama(deps, config.value));
  checks.push(checkRam(deps));

  const okCount = checks.filter((check) => check.status === 'ok').length;
  const failCount = checks.filter((check) => check.status === 'fail').length;
  const warnCount = checks.filter((check) => check.status === 'warn').length;

  return { checks, ok: failCount === 0, okCount, failCount, warnCount };
}

async function checkBun(deps: DoctorDeps): Promise<DoctorCheck> {
  const version = deps.bunVersion === null ? undefined : (deps.bunVersion ?? process.versions.bun);
  if (version === undefined) {
    return {
      name: 'bun',
      status: 'fail',
      detail: 'not running under Bun',
      hint: 'install Bun ≥ 1.3 from https://bun.sh',
    };
  }
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (major > 1 || (major === 1 && minor >= 3)) {
    return { name: 'bun', status: 'ok', detail: `${version} (needs ≥ 1.3)` };
  }
  return {
    name: 'bun',
    status: 'fail',
    detail: `${version} is too old (needs ≥ 1.3)`,
    hint: 'bun upgrade',
  };
}

async function checkGit(deps: DoctorDeps, cwd: string): Promise<DoctorCheck> {
  const result = await safeExec(deps, ['git', '--version'], cwd);
  if (result.code !== 0) {
    return { name: 'git', status: 'fail', detail: 'git not found on PATH', hint: 'install git ≥ 2.38' };
  }
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(result.stdout);
  if (match === null) {
    return { name: 'git', status: 'fail', detail: `unexpected version output: ${result.stdout.trim()}` };
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const version = `${major}.${minor}${match[3] === undefined ? '' : `.${match[3]}`}`;
  const ok = major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
  return ok
    ? { name: 'git', status: 'ok', detail: `${version} (needs ≥ ${MIN_GIT.join('.')})` }
    : {
        name: 'git',
        status: 'fail',
        detail: `${version} is too old (needs ≥ ${MIN_GIT.join('.')})`,
        hint: 'brew upgrade git',
      };
}

async function checkOpencode(
  deps: DoctorDeps,
  cwd: string,
): Promise<{ check: DoctorCheck; available: boolean }> {
  const result = await safeExec(deps, ['opencode', '--version'], cwd);
  if (result.code !== 0) {
    return {
      available: false,
      check: {
        name: 'opencode',
        status: 'fail',
        detail: 'opencode not found on PATH',
        hint: 'install opencode from https://opencode.ai',
      },
    };
  }
  const version = (result.stdout || result.stderr).trim().split('\n')[0] ?? 'installed';
  return { available: true, check: { name: 'opencode', status: 'ok', detail: version } };
}

async function checkFlashModel(
  deps: DoctorDeps,
  cwd: string,
  opencodeAvailable: boolean,
): Promise<DoctorCheck> {
  if (!opencodeAvailable) {
    return {
      name: 'deepseek',
      status: 'warn',
      detail: 'model listing skipped — opencode is not available',
    };
  }
  const result = await safeExec(deps, ['opencode', 'models'], cwd, 15_000);
  if (result.code !== 0) {
    return {
      name: 'deepseek',
      status: 'fail',
      detail: 'could not list opencode models',
      hint: 'opencode models',
    };
  }
  const line = result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => FLASH_ID.test(entry));
  if (line === undefined) {
    return {
      name: 'deepseek',
      status: 'fail',
      detail: 'no DeepSeek V4.1 Flash id in `opencode models`',
      hint: 'opencode auth login  (or set DEEPSEEK_API_KEY for the direct API provider)',
    };
  }
  return { name: 'deepseek', status: 'ok', detail: `${line} (any provider is fine)` };
}

async function checkGh(deps: DoctorDeps, cwd: string): Promise<DoctorCheck> {
  const result = await safeExec(deps, ['gh', 'auth', 'status'], cwd);
  if (result.code === 0) return { name: 'gh', status: 'ok', detail: 'authenticated' };
  return {
    name: 'gh',
    status: 'fail',
    detail: 'not authenticated',
    hint: 'gh auth login',
  };
}

interface ConfigProbe {
  check: DoctorCheck;
  value: StarlingConfig;
}

function safeConfig(deps: DoctorDeps, cwd: string): ConfigProbe {
  const loader = deps.loadConfigFn ?? loadConfig;
  const explicit = deps.configPath;
  const hasFile =
    explicit !== undefined
      ? existsSync(resolve(cwd, explicit))
      : CONFIG_FILENAMES.some((name) => existsSync(resolve(cwd, name)));

  try {
    const value = loader(explicit, cwd);
    return {
      check: {
        name: 'config',
        status: 'ok',
        detail: hasFile
          ? `${explicit ?? CONFIG_FILENAMES.find((name) => existsSync(resolve(cwd, name)))} is valid`
          : 'defaults (no starling.config.yaml yet — run `starling init`)',
      },
      value,
    };
  } catch (err) {
    return {
      check: {
        name: 'config',
        status: 'fail',
        detail: isStarlingError(err) ? err.message : String(err),
        hint: 'fix the YAML or rerun `starling init --force`',
      },
      value: defaultConfig,
    };
  }
}

async function checkOllama(deps: DoctorDeps, config: StarlingConfig): Promise<DoctorCheck> {
  const baseUrl = config.providers.ollama?.baseUrl ?? 'http://127.0.0.1:11434/v1';
  const tagsUrl = `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/tags`;
  const fetchFn = deps.fetchFn ?? fetch;

  try {
    const response = await fetchFn(tagsUrl, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
    if (!response.ok) {
      return {
        name: 'ollama',
        status: 'warn',
        detail: `${tagsUrl} answered ${response.status} (optional)`,
        hint: 'ollama serve',
      };
    }
    const body: unknown = await response.json();
    const models = isTagsBody(body) ? body.models.length : 0;
    return {
      name: 'ollama',
      status: 'ok',
      detail: `reachable at ${tagsUrl} · ${models} local model${models === 1 ? '' : 's'}`,
    };
  } catch {
    return {
      name: 'ollama',
      status: 'warn',
      detail: `not reachable at ${tagsUrl} (optional — only needed for local roles)`,
      hint: 'ollama serve',
    };
  }
}

function isTagsBody(value: unknown): value is { models: unknown[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { models?: unknown }).models);
}

function checkRam(deps: DoctorDeps): DoctorCheck {
  const totalGb = deps.totalMemGb?.() ?? totalmem() / 1024 ** 3;
  const freeGb = deps.freeMemGb?.() ?? freemem() / 1024 ** 3;
  const detail = `${freeGb.toFixed(1)} GB free of ${totalGb.toFixed(0)} GB`;
  if (freeGb < 2) {
    return {
      name: 'ram',
      status: 'warn',
      detail: `${detail} — tight for a big flock`,
      hint: 'close unused apps or lower maxParallel',
    };
  }
  return { name: 'ram', status: 'ok', detail };
}

async function safeExec(deps: DoctorDeps, cmd: string[], cwd: string, timeoutMs = 5000): Promise<ExecResult> {
  try {
    return await deps.execFn(cmd, { cwd, timeoutMs });
  } catch (err) {
    return {
      code: 127,
      stdout: '',
      stderr: isStarlingError(err) ? err.message : String(err),
      durationMs: 0,
    };
  }
}

/** The actual operating system, used only for the doctor banner. */
export function hostIdentity(): { platform: string; arch: string } {
  return { platform: osPlatform(), arch: osArch() };
}
