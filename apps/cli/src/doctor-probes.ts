/**
 * Pure parsers and OS-level probes behind `starling doctor`.
 *
 * Split from `doctor.ts` so the check orchestration stays readable: everything here either turns a
 * string into a value (testable with a literal) or talks to the machine (overridable through the
 * injected dependencies in `DoctorDeps`). Nothing in this file imports `doctor.ts`, which keeps the
 * dependency direction one-way.
 */

import { freemem } from 'node:os';

const FLASH_ID = /deepseek[\w.-]*v4[.-]?1[\w.-]*flash/i;

/** A child process, narrowed to what the opencode-server probe needs. */
export interface DoctorProc {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

export type DoctorSpawn = (
  cmd: string[],
  opts: { cwd: string; env?: Record<string, string | undefined> },
) => DoctorProc;

/** `Bun.spawn` with the pipes the probe reads. Throws `EXEC_FAILED`-style errors on a missing binary. */
export const defaultDoctorSpawn: DoctorSpawn = (cmd, opts) => {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    // Merge, never replace: the child still needs PATH and HOME to find its own config.
    ...(opts.env === undefined ? {} : { env: { ...process.env, ...opts.env } }),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    kill: (signal) => {
      proc.kill(signal);
    },
  };
};

/** Every model id in `opencode models` that is a DeepSeek V4.1 Flash, provider prefix kept. */
export function parseFlashModelIds(stdout: string): string[] {
  const ids = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && FLASH_ID.test(line));
  return [...new Set(ids)];
}

export type NetworkInterfaces = Record<
  string,
  Array<{ address: string; family: string | number; internal: boolean }> | undefined
>;

const LAN_IFACE_ORDER = ['en0', 'eth0', 'en1', 'wlan0'];

function lanRank(name: string): number {
  const index = LAN_IFACE_ORDER.indexOf(name);
  if (index >= 0) return index;
  return name.startsWith('wlp') ? LAN_IFACE_ORDER.length : LAN_IFACE_ORDER.length + 1;
}

/**
 * The IPv4 address another laptop can dial. `en0`/`eth0` win over bridges and VPN tunnels; loopback
 * and IPv6 are ignored because a `starling perch --hub` URL is written by hand.
 */
export function parseLanAddress(ifaces: NetworkInterfaces): string | undefined {
  const isV4 = (entry: { address: string; family: string | number }) =>
    entry.family === 'IPv4' || entry.family === 4;
  const usable = Object.entries(ifaces)
    .flatMap(([name, list]) => (list ?? []).map((entry) => ({ name, entry })))
    .filter(({ entry }) => isV4(entry) && !entry.internal && !entry.address.startsWith('127.'))
    .sort((a, b) => lanRank(a.name) - lanRank(b.name));
  return usable[0]?.entry.address;
}

/** `df -k` output → free gigabytes. Columns are 1024-byte blocks on macOS and Linux alike. */
export function parseDfAvailableGb(stdout: string): number | undefined {
  const rows = stdout.trim().split('\n').slice(1);
  const row = rows.at(-1)?.trim();
  if (row === undefined || row.length === 0) return undefined;
  const columns = row.split(/\s+/);
  const availableKb = Number(columns[3]);
  if (!Number.isFinite(availableKb) || availableKb < 0) return undefined;
  return availableKb / 1024 ** 2;
}

/** What `measureAvailableMemGb` needs from an exec helper (structurally, `ExecResult` from core). */
export type MemExec = (
  cmd: string[],
  opts: { cwd: string; timeoutMs?: number },
) => Promise<{ code: number; stdout: string }>;

/**
 * Usable RAM in gigabytes.
 *
 * On macOS `os.freemem()` reports almost nothing, so `vm_stat`'s free+inactive+speculative is used
 * instead; anything unreadable falls back to `os.freemem()`. Both `doctor` and `init` call this, so
 * the suggestion they print cannot disagree.
 */
export async function measureAvailableMemGb(options: {
  execFn?: MemExec;
  cwd: string;
  platform?: string;
  freeMemGb?: () => number;
}): Promise<number> {
  if (options.freeMemGb !== undefined) return options.freeMemGb();
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin' && options.execFn !== undefined) {
    try {
      const result = await options.execFn(['vm_stat'], { cwd: options.cwd, timeoutMs: 2000 });
      const available = result.code === 0 ? parseVmStatAvailableGb(result.stdout) : undefined;
      if (available !== undefined) return available;
    } catch {
      // Fall through to the coarse counter.
    }
  }
  return freemem() / 1024 ** 3;
}

/** `ulimit -n` output → the soft open-file limit. Not every shell prints just the number. */
export function parseOpenFiles(stdout: string): number | undefined {
  const match = /(?:^|\s)(\d+)(?:\s|$)/.exec(stdout.trim());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * macOS `vm_stat` → usable gigabytes.
 *
 * `os.freemem()` on macOS only counts "Pages free", which is tiny even on a healthy machine because
 * the kernel parks file cache in "Pages inactive". Summing free + inactive + speculative is the
 * usual approximation of what a new process can actually get, and it keeps `doctor` from advising
 * `maxParallel: 1` on a perfectly idle 32 GB laptop.
 */
export function parseVmStatAvailableGb(stdout: string): number | undefined {
  const pageSize = /page size of (\d+) bytes/.exec(stdout)?.[1];
  if (pageSize === undefined) return undefined;
  const pages = (label: string): number => {
    const match = new RegExp(`${label}:\\s+(\\d+)\\.`).exec(stdout);
    return match?.[1] === undefined ? 0 : Number(match[1]);
  };
  const free = pages('Pages free');
  const inactive = pages('Pages inactive');
  const speculative = pages('Pages speculative');
  if (free === 0 && inactive === 0) return undefined;
  return ((free + inactive + speculative) * Number(pageSize)) / 1024 ** 3;
}

export type BenchProfile = 'mbp' | 'air';

export interface RecommendationPicks {
  auditor: string;
  summarizer: string;
}

/** The 32 GB machines get the `mbp` bench budget, everything smaller the `air` one. */
export function profileForRam(totalGb: number): BenchProfile {
  return totalGb >= 24 ? 'mbp' : 'air';
}

/**
 * Read one profile out of `tools/local-models/results/recommendation.json`.
 * Any shape surprise returns `undefined` — a broken benchmark file must never fail `doctor`.
 */
export function parseRecommendation(text: string, profile: BenchProfile): RecommendationPicks | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const entry = (parsed as Record<string, unknown>)[profile];
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { auditor, summarizer } = entry as Record<string, unknown>;
  if (typeof auditor !== 'string' || typeof summarizer !== 'string') return undefined;
  return { auditor, summarizer };
}

/** Model names Ollama reports in `GET /api/tags`. */
export function parseOllamaModelNames(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) =>
      typeof entry === 'object' && entry !== null ? (entry as { name?: unknown }).name : undefined,
    )
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/** `true` when Ollama has the model, tolerating a missing `:latest` tag on either side. */
export function hasOllamaModel(installed: string[], wanted: string): boolean {
  const normalise = (value: string) => (value.includes(':') ? value : `${value}:latest`);
  const target = normalise(wanted);
  return installed.some((name) => normalise(name) === target);
}

/** A loopback port that nothing is listening on right now (reserve, close, hand the number over). */
export function freeLoopbackPort(): number {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
  const port = server.port ?? 0;
  server.stop(true);
  return port;
}

/**
 * Is `port` bindable? The check binds loopback rather than `0.0.0.0` on purpose: a `doctor` run
 * must never trigger a macOS "accept incoming connections?" firewall dialog. Starling's own server
 * and perch bind these ports, so a squatter on loopback is exactly the case worth reporting.
 */
export async function defaultPortFree(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('') });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}
