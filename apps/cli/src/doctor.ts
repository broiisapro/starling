import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  cpus,
  arch as osArch,
  networkInterfaces as osNetworkInterfaces,
  platform as osPlatform,
  totalmem,
} from 'node:os';
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
import {
  type DoctorProc,
  type DoctorSpawn,
  defaultDoctorSpawn,
  defaultPortFree,
  freeLoopbackPort,
  hasOllamaModel,
  measureAvailableMemGb,
  type NetworkInterfaces,
  parseDfAvailableGb,
  parseFlashModelIds,
  parseLanAddress,
  parseOllamaModelNames,
  parseOpenFiles,
  parseRecommendation,
  profileForRam,
  type RecommendationPicks,
} from './doctor-probes';

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
  /** How many agents this machine can carry (see `suggestMaxParallel`). */
  suggestedMaxParallel?: number;
}

export type DoctorExec = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

export interface DoctorDeps {
  execFn: DoctorExec;
  cwd?: string;
  configPath?: string;
  loadConfigFn?: (path?: string, cwd?: string) => StarlingConfig;
  env?: Record<string, string | undefined>;
  freeMemGb?: () => number;
  totalMemGb?: () => number;
  cpuCores?: () => number;
  /** Injected so unit tests never touch the network. */
  fetchFn?: typeof fetch;
  /** Injected so unit tests never spawn a real `opencode serve`. */
  spawnFn?: DoctorSpawn;
  freePort?: () => number;
  portFree?: (port: number) => Promise<boolean>;
  networkInterfacesFn?: () => NetworkInterfaces;
  readFileFn?: (path: string) => string | undefined;
  /** Root of the Starling checkout, for `tools/local-models/results/recommendation.json`. */
  rootDir?: string;
  now?: () => number;
  bunVersion?: string | null;
  platform?: string;
  arch?: string;
  /** Default 10 s: long enough for a cold `opencode serve`, short enough for a doctor run. */
  serverTimeoutMs?: number;
  /** `false` skips the start/stop probe (tests, CI, `--json` without a server). */
  serverProbe?: boolean;
}

const MIN_GIT: [number, number] = [2, 38];
const MIN_FREE_DISK_GB = 5;
const MIN_OPEN_FILES = 1024;
const OLLAMA_TIMEOUT_MS = 1500;

/** One opencode worker (server session + tool subprocesses) peaks around this much RAM. */
export const AGENT_MEMORY_GB = 2;
/** Ceiling for the suggestion: matches the default `flock.hubMaxSessions` (ARCHITECTURE §5). */
export const MAX_SUGGESTED_PARALLEL = 8;

export const PARALLELISM_RULE =
  'rule of thumb: one worker ≈ 2 GB RAM and one core, and the hub keeps a core for itself';

/**
 * Suggested `maxParallel` for this machine.
 *
 * RAM is the binding constraint on a laptop running opencode sessions; the CPU bound (one core left
 * for the hub and the dashboard) stops a many-core machine from thrashing. Both are capped at
 * `MAX_SUGGESTED_PARALLEL`, and the answer is never below 1 — a single slow agent beats no agent.
 */
export function suggestMaxParallel(input: { cpuCores: number; freeMemGb: number }): number {
  const byMemory = Math.floor(input.freeMemGb / AGENT_MEMORY_GB);
  const byCpu = Math.max(1, input.cpuCores - 1);
  return Math.max(1, Math.min(byMemory, byCpu, MAX_SUGGESTED_PARALLEL));
}

/**
 * Every environment check `starling doctor` performs, in the order a new user hits them.
 *
 * Side-effect free apart from the injected `exec`/`fetch`/`spawn` calls, so tests can drive every
 * branch. A missing optional dependency (Ollama, `gh`, a local benchmark) is a warning; a broken
 * required one (bun, git, opencode, config) is a failure.
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult> {
  const cwd = deps.cwd ?? process.cwd();
  const totalGb = (deps.totalMemGb ?? (() => totalmem() / 1024 ** 3))();
  const freeGb = await availableMemGb(deps, cwd);
  const cpuCores = (deps.cpuCores ?? (() => cpus().length))();
  const checks: DoctorCheck[] = [];

  checks.push(checkBun(deps));
  checks.push(await checkGit(deps, cwd));

  const opencode = await checkOpencode(deps, cwd);
  checks.push(opencode.check);
  checks.push(await checkOpencodeServer(deps, cwd, opencode));
  checks.push(await checkFlashModels(deps, cwd, opencode.available));
  checks.push(checkDeepseekKey(deps));
  checks.push(await checkGh(deps, cwd));

  const config = safeConfig(deps, cwd);
  checks.push(config.check);

  checks.push(await checkOllama(deps, config.value, totalGb));
  checks.push(checkRam({ freeGb, totalGb, cpuCores }));
  checks.push(await checkDisk(deps, cwd));
  checks.push(await checkNetwork(deps, config.value));
  checks.push(await checkUlimit(deps, cwd));

  const okCount = checks.filter((check) => check.status === 'ok').length;
  const failCount = checks.filter((check) => check.status === 'fail').length;
  const warnCount = checks.filter((check) => check.status === 'warn').length;

  return {
    checks,
    ok: failCount === 0,
    okCount,
    failCount,
    warnCount,
    suggestedMaxParallel: suggestMaxParallel({ cpuCores, freeMemGb: freeGb }),
  };
}

function checkBun(deps: DoctorDeps): DoctorCheck {
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

interface OpencodeProbe {
  check: DoctorCheck;
  available: boolean;
  version?: string;
}

async function checkOpencode(deps: DoctorDeps, cwd: string): Promise<OpencodeProbe> {
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
  return { available: true, version, check: { name: 'opencode', status: 'ok', detail: version } };
}

/**
 * Start a private `opencode serve` on a free loopback port, wait until it answers `GET /api/info`,
 * then stop it. This is the check that catches the failure mode `opencode --version` cannot: a CLI
 * that is installed but whose server cannot boot (bad auth store, port squatter, corrupt config).
 *
 * On opencode 2.1.2 `serve` is already a standalone private server (`--standalone` is a root flag the
 * subcommand rejects — see `docs/epic-15-runner.md`), so no extra flag is passed.
 */
async function checkOpencodeServer(
  deps: DoctorDeps,
  cwd: string,
  opencode: OpencodeProbe,
): Promise<DoctorCheck> {
  const name = 'opencode server';
  if (deps.serverProbe === false) {
    return { name, status: 'warn', detail: 'probe skipped' };
  }
  if (!opencode.available) {
    return { name, status: 'warn', detail: 'skipped — opencode is not available' };
  }

  const port = (deps.freePort ?? freeLoopbackPort)();
  const password = randomUUID();
  const spawn = deps.spawnFn ?? defaultDoctorSpawn;
  const timeoutMs = deps.serverTimeoutMs ?? 10_000;
  const now = deps.now ?? (() => Date.now());
  const started = now();

  let proc: DoctorProc;
  try {
    proc = spawn(['opencode', 'serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd,
      env: { OPENCODE_SERVER_PASSWORD: password },
    });
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: `could not spawn \`opencode serve\`: ${errorText(err)}`,
      hint: 'run `opencode serve` by hand to see the error',
    };
  }

  try {
    const listening = await waitForListening(proc, timeoutMs);
    if (listening === undefined) {
      const exit = await raceExit(proc, 200);
      return exit === undefined
        ? {
            name,
            status: 'fail',
            detail: `did not start within ${timeoutMs} ms on 127.0.0.1:${port}`,
            hint: 'run `opencode serve` by hand to see the error',
          }
        : {
            name,
            status: 'fail',
            detail: `exited with code ${exit} before it started listening`,
            hint: 'run `opencode serve` by hand to see the error',
          };
    }

    const response = await httpProbe(deps, `${listening}/api/info`, password);
    if (!response.ok) {
      return {
        name,
        status: 'fail',
        detail: `${listening} answered ${response.status}`,
        hint: 'check the opencode logs (`--print-logs --standalone`)',
      };
    }
    const elapsed = now() - started;
    const version = opencode.version === undefined ? 'opencode' : opencode.version;
    return {
      name,
      status: 'ok',
      detail: `${version} answered /api/info in ${elapsed} ms · stopped`,
    };
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: `server probe failed: ${errorText(err)}`,
      hint: 'run `opencode serve` by hand to see the error',
    };
  } finally {
    await stopProc(proc);
  }
}

async function httpProbe(deps: DoctorDeps, url: string, password: string): Promise<Response> {
  const fetchFn = deps.fetchFn ?? fetch;
  return fetchFn(url, {
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    signal: AbortSignal.timeout(5000),
  });
}

/** Resolve with the URL from `server listening on <url>`, or `undefined` on timeout / closed pipe. */
async function waitForListening(proc: DoctorProc, timeoutMs: number): Promise<string | undefined> {
  const stream = proc.stdout;
  if (stream === null) return undefined;
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const read = (async (): Promise<string | undefined> => {
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return undefined;
        buffer += decoder.decode(value, { stream: true });
        const match = /server listening on (\S+)/.exec(buffer);
        if (match?.[1] !== undefined) return match[1];
      }
    } catch {
      return undefined;
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), timeoutMs);
  });

  const found = await Promise.race([read, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  reader.cancel().catch(() => {});
  return found;
}

/** The exit code if the process is already gone, else `undefined` (after at most `waitMs`). */
async function raceExit(proc: DoctorProc, waitMs: number): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), waitMs);
  });
  const code = await Promise.race([proc.exited, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return code;
}

/** SIGTERM, then SIGKILL if the child is still around; never throws. */
async function stopProc(proc: DoctorProc): Promise<void> {
  try {
    proc.kill('SIGTERM');
  } catch {
    // Already gone — nothing to stop.
  }
  const code = await raceExit(proc, 1500);
  if (code !== undefined) return;
  try {
    proc.kill('SIGKILL');
  } catch {
    // Raced with the OS reaping it.
  }
  await raceExit(proc, 500);
}

async function checkFlashModels(
  deps: DoctorDeps,
  cwd: string,
  opencodeAvailable: boolean,
): Promise<DoctorCheck> {
  const name = 'deepseek';
  if (!opencodeAvailable) {
    return { name, status: 'warn', detail: 'model listing skipped — opencode is not available' };
  }
  const result = await safeExec(deps, ['opencode', 'models'], cwd, 15_000);
  if (result.code !== 0) {
    return { name, status: 'fail', detail: 'could not list opencode models', hint: 'opencode models' };
  }
  const ids = parseFlashModelIds(result.stdout);
  if (ids.length === 0) {
    return {
      name,
      status: 'fail',
      detail: 'no DeepSeek V4.1 Flash id in `opencode models`',
      hint: 'opencode auth login  (or set DEEPSEEK_API_KEY for the direct API provider)',
    };
  }
  return {
    name,
    status: 'ok',
    detail: formatIds(ids),
  };
}

/** Two ids fit a terminal line; the rest are summarised so the detail never gets truncated. */
function formatIds(ids: string[]): string {
  const shown = ids.slice(0, 2).join(', ');
  return ids.length <= 2 ? shown : `${shown} (+${ids.length - 2} more)`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function checkDeepseekKey(deps: DoctorDeps): DoctorCheck {
  const key = deps.env?.DEEPSEEK_API_KEY;
  if (key !== undefined && key.length > 0) {
    return { name: 'deepseek key', status: 'ok', detail: 'DEEPSEEK_API_KEY is set (direct API available)' };
  }
  return {
    name: 'deepseek key',
    status: 'warn',
    detail: 'DEEPSEEK_API_KEY not set — optional: the opencode profile needs no key',
    hint: 'export DEEPSEEK_API_KEY=…  (only for the direct `deepseek` profile)',
  };
}

async function checkGh(deps: DoctorDeps, cwd: string): Promise<DoctorCheck> {
  const result = await safeExec(deps, ['gh', 'auth', 'status'], cwd);
  if (result.code === 0) return { name: 'gh', status: 'ok', detail: 'authenticated' };
  const missing = /not found|ENOENT/i.test(result.stderr) || result.code === 127;
  return {
    name: 'gh',
    status: 'warn',
    detail: missing ? 'GitHub CLI not installed — optional, only for --github' : 'not authenticated',
    hint: missing ? 'brew install gh' : 'gh auth login',
  };
}

interface ConfigProbe {
  check: DoctorCheck;
  value: StarlingConfig;
}

function safeConfig(deps: DoctorDeps, cwd: string): ConfigProbe {
  const loader = deps.loadConfigFn ?? loadConfig;
  const explicit = deps.configPath;
  const found = explicit ?? CONFIG_FILENAMES.find((name) => existsSync(resolve(cwd, name)));
  const hasFile = found !== undefined && existsSync(resolve(cwd, found));

  try {
    const value = loader(explicit, cwd);
    return {
      check: {
        name: 'config',
        status: 'ok',
        detail: hasFile
          ? `${found} is valid`
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

async function checkOllama(deps: DoctorDeps, config: StarlingConfig, totalGb: number): Promise<DoctorCheck> {
  const name = 'ollama';
  const baseUrl = config.providers.ollama?.baseUrl ?? 'http://127.0.0.1:11434/v1';
  const tagsUrl = `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/tags`;
  const fetchFn = deps.fetchFn ?? fetch;

  let installed: string[];
  try {
    const response = await fetchFn(tagsUrl, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
    if (!response.ok) {
      return {
        name,
        status: 'warn',
        detail: `${tagsUrl} answered ${response.status} (optional)`,
        hint: 'ollama serve',
      };
    }
    installed = parseOllamaModelNames(await response.json());
  } catch {
    return {
      name,
      status: 'warn',
      detail: `not reachable at ${tagsUrl} (optional — only needed for local roles)`,
      hint: 'ollama serve',
    };
  }

  const picks = readRecommendation(deps, totalGb);
  if (picks === undefined) {
    return {
      name,
      status: 'ok',
      detail: `reachable · ${count(installed.length, 'local model')} · no local benchmark yet`,
    };
  }

  const wanted = [...new Set([picks.auditor, picks.summarizer])];
  const missing = wanted.filter((model) => !hasOllamaModel(installed, model));
  if (missing.length > 0) {
    return {
      name,
      status: 'warn',
      detail: `reachable · recommended ${missing.join(', ')} not pulled`,
      hint: `ollama pull ${missing[0]}`,
    };
  }
  return {
    name,
    status: 'ok',
    detail: `reachable · ${count(installed.length, 'local model')} · recommended ${wanted.join(', ')} ✓`,
  };
}

/** The benchmark file lives in the Starling checkout, not the user's target repo. */
function readRecommendation(deps: DoctorDeps, totalGb: number): RecommendationPicks | undefined {
  const read = deps.readFileFn ?? readTextFile;
  const root = deps.rootDir ?? resolve(import.meta.dir, '../../..');
  const cwd = deps.cwd ?? process.cwd();
  const relative = 'tools/local-models/results/recommendation.json';
  const candidates = [resolve(cwd, relative), resolve(root, relative)];
  for (const path of candidates) {
    const text = read(path);
    if (text !== undefined) return parseRecommendation(text, profileForRam(totalGb));
  }
  return undefined;
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function checkRam(machine: { freeGb: number; totalGb: number; cpuCores: number }): DoctorCheck {
  const { freeGb, totalGb, cpuCores } = machine;
  const suggestion = suggestMaxParallel({ cpuCores, freeMemGb: freeGb });
  const detail = `${freeGb.toFixed(1)} GB available of ${totalGb.toFixed(0)} GB · room for ≈ ${suggestion} parallel agent${suggestion === 1 ? '' : 's'}`;
  if (freeGb < AGENT_MEMORY_GB) {
    return {
      name: 'ram',
      status: 'warn',
      detail: `${detail} — tight for a flock`,
      hint: 'close unused apps, or set maxParallel: 1',
    };
  }
  return { name: 'ram', status: 'ok', detail };
}

/** macOS `vm_stat` versus `os.freemem()` is decided in `doctor-probes.measureAvailableMemGb`. */
async function availableMemGb(deps: DoctorDeps, cwd: string): Promise<number> {
  return measureAvailableMemGb({
    execFn: deps.execFn,
    cwd,
    ...(deps.freeMemGb === undefined ? {} : { freeMemGb: deps.freeMemGb }),
    ...(deps.platform === undefined ? {} : { platform: deps.platform }),
  });
}

async function checkDisk(deps: DoctorDeps, cwd: string): Promise<DoctorCheck> {
  const result = await safeExec(deps, ['df', '-k', cwd], cwd);
  const freeGb = result.code === 0 ? parseDfAvailableGb(result.stdout) : undefined;
  if (freeGb === undefined) {
    return {
      name: 'disk',
      status: 'warn',
      detail: 'could not read free disk space',
      hint: 'df -h .',
    };
  }
  const detail = `${freeGb.toFixed(1)} GB free (each worktree is a full copy of the repo)`;
  if (freeGb < MIN_FREE_DISK_GB) {
    return {
      name: 'disk',
      status: 'warn',
      detail: `${detail} — under ${MIN_FREE_DISK_GB} GB`,
      hint: 'free some space; worktrees are copies of the repo',
    };
  }
  return { name: 'disk', status: 'ok', detail };
}

async function checkNetwork(deps: DoctorDeps, config: StarlingConfig): Promise<DoctorCheck> {
  const name = 'network';
  const ifaces = (deps.networkInterfacesFn ?? osNetworkInterfaces)();
  const lan = parseLanAddress(ifaces);
  const portFree = deps.portFree ?? defaultPortFree;
  const ports = [config.server.port, config.perch.port];
  const busy: number[] = [];
  for (const port of ports) {
    if (!(await portFree(port))) busy.push(port);
  }

  if (lan === undefined) {
    return {
      name,
      status: 'warn',
      detail: 'no LAN IPv4 address — flock stays on this machine',
      hint: 'join a network, or set flock.enabled: false',
    };
  }
  if (busy.length > 0) {
    return {
      name,
      status: 'warn',
      detail: `LAN ${lan} · port${busy.length === 1 ? '' : 's'} ${busy.join(', ')} already in use`,
      hint: `lsof -nP -iTCP:${busy[0]} -sTCP:LISTEN`,
    };
  }
  return {
    name,
    status: 'ok',
    detail: `LAN ${lan} · ports ${ports.join(' & ')} free`,
  };
}

async function checkUlimit(deps: DoctorDeps, cwd: string): Promise<DoctorCheck> {
  const result = await safeExec(deps, ['sh', '-c', 'ulimit -n'], cwd);
  const openFiles = result.code === 0 ? parseOpenFiles(result.stdout) : undefined;
  if (openFiles === undefined) {
    return {
      name: 'ulimit',
      status: 'warn',
      detail: 'could not read the open-file limit',
      hint: 'ulimit -n',
    };
  }
  if (openFiles < MIN_OPEN_FILES) {
    return {
      name: 'ulimit',
      status: 'warn',
      detail: `${openFiles} open files — too few for parallel agents`,
      hint: 'ulimit -n 10240 (add it to your shell profile)',
    };
  }
  return {
    name: 'ulimit',
    status: 'ok',
    detail: `${openFiles} open files (needs ≥ ${MIN_OPEN_FILES})`,
  };
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface DoctorHost {
  platform: string;
  arch: string;
  /** `null` when not running under Bun. */
  bun: string | null;
}

/** The actual operating system, used only for the doctor banner. */
export function hostIdentity(): DoctorHost {
  return { platform: osPlatform(), arch: osArch(), bun: process.versions.bun ?? null };
}

/**
 * `starling doctor --json`: one object on stdout, nothing else, so `jq` and CI can read it.
 * Deliberately timestamp-free so two runs on the same machine diff cleanly.
 */
export function doctorJson(result: DoctorResult, host: DoctorHost): string {
  return JSON.stringify(
    {
      ok: result.ok,
      host,
      counts: { ok: result.okCount, warn: result.warnCount, fail: result.failCount },
      suggestedMaxParallel: result.suggestedMaxParallel ?? null,
      checks: result.checks.map((check) => ({
        name: check.name,
        status: check.status,
        detail: check.detail,
        ...(check.hint === undefined ? {} : { hint: check.hint }),
      })),
    },
    null,
    2,
  );
}
