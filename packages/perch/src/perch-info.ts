import { cpus, arch as osArch, hostname as osHostname, platform as osPlatform, totalmem } from 'node:os';
import {
  type Clock,
  exec as coreExec,
  type ExecOptions,
  type ExecResult,
  type ExecutionNode,
  type NodeInfo,
  systemClock,
} from '@starling/core';

/** Injectable `exec` so tests never shell out (ARCHITECTURE L13). */
export type ExecFn = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

/** The OS facts a perch reports to the hub. Probed once, injected wholesale in tests. */
export interface OsFacts {
  hostname: string;
  computerName?: string;
  platform: string;
  arch: string;
  cpuCores: number;
  memGb: number;
}

export type OsProbe = () => Promise<OsFacts>;

export interface ProbeOsOptions {
  exec?: ExecFn;
  /** Override `process.platform` (tests exercise the macOS branch everywhere). */
  platform?: string;
  /** Override `os.hostname()` for deterministic tests. */
  hostname?: string;
}

/**
 * Read the machine's identity.
 *
 * macOS exposes a friendly `ComputerName` ("Moksh's MacBook Air") that `os.hostname()` does not, so
 * we ask `scutil` when available and fall back to the hostname. CPU count and memory are real OS
 * values; `memGb` is rounded to one decimal (32 GB Macs report ~32.0, not 34.4 GiB).
 */
export async function probeOs(opts: ProbeOsOptions = {}): Promise<OsFacts> {
  const execFn = opts.exec ?? coreExec;
  const platform = opts.platform ?? osPlatform();
  const host = opts.hostname ?? osHostname();
  let computerName: string | undefined;

  if (platform === 'darwin') {
    try {
      const res = await execFn(['scutil', '--get', 'ComputerName'], {
        cwd: process.cwd(),
        timeoutMs: 1000,
      });
      const value = res.stdout.trim();
      if (res.code === 0 && value.length > 0) computerName = value;
    } catch {
      // scutil is a nicety, not a requirement: a sandboxed or headless Mac still has a hostname.
    }
  }

  return {
    hostname: host,
    computerName,
    platform,
    arch: osArch(),
    cpuCores: cpus().length,
    memGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
  };
}

export interface ListLocalModelsOptions {
  fetch?: typeof fetch;
  /** Ollama's root URL. Defaults to the locked local endpoint (ARCHITECTURE L15). */
  ollamaUrl?: string;
  /** Give up after this long; a perch must never wait on a sleeping Ollama. */
  timeoutMs?: number;
}

/**
 * Ask Ollama which models it already has.
 *
 * Only `GET /api/tags` is called — the list endpoint, which reads metadata and does **not** load a
 * model into memory (ARCHITECTURE L23: no local inference during build waves). Any failure (not
 * installed, not running, slow) means "this perch lends no models", never an error.
 */
export async function listLocalModels(opts: ListLocalModelsOptions = {}): Promise<string[]> {
  const doFetch = opts.fetch ?? fetch;
  const base = (opts.ollamaUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 750);
  timeout.unref?.();

  try {
    const res = await doFetch(`${base}/api/tags`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return parseModelNames(await res.json());
  } catch {
    // Best-effort probe: an offline Ollama is the normal case on most laptops.
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parseModelNames(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];

  const names: string[] = [];
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { name?: unknown; model?: unknown };
    const name = typeof record.name === 'string' ? record.name : record.model;
    if (typeof name === 'string' && name.length > 0 && !names.includes(name)) names.push(name);
  }
  return names;
}

export interface LocalModelsProbeOptions extends ListLocalModelsOptions {
  clock?: Clock;
  /** How long a successful or failed probe is reused. Default 30 s (heartbeats are every 3 s). */
  ttlMs?: number;
}

/**
 * A memoised `listLocalModels` for the daemon's heartbeat loop.
 *
 * Heartbeats repeat every 3 s; asking Ollama 20 times a minute for a list that changes hourly is
 * waste. Failures are cached too, so a laptop without Ollama does not pay a 750 ms timeout on every
 * heartbeat. Concurrent callers share one in-flight probe.
 */
export function createLocalModelsProbe(opts: LocalModelsProbeOptions = {}): () => Promise<string[]> {
  const clock = opts.clock ?? systemClock;
  const ttlMs = opts.ttlMs ?? 30_000;
  let cached: { at: number; models: string[] } | undefined;
  let inflight: Promise<string[]> | undefined;

  return async () => {
    if (cached !== undefined && clock.now() - cached.at < ttlMs) return cached.models;
    if (inflight !== undefined) return inflight;

    inflight = listLocalModels(opts)
      .then((models) => {
        cached = { at: clock.now(), models };
        return models;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
}

export interface PerchInfoOptions {
  node: ExecutionNode;
  /** Human name. `'auto'`/undefined means ComputerName, then hostname. */
  name?: string;
  maxSessions?: number;
  /** When false, Ollama is never contacted and `localModels` is empty. Default true. */
  lendModels?: boolean;
  /** LAN URL, once the HTTP server knows its port. */
  url?: string;
  /** Hub-assigned node id, once registered. Falls back to the local node's id. */
  id?: string;
  clock?: Clock;
  os?: OsProbe;
  exec?: ExecFn;
  /** Override the Ollama probe (the daemon passes a memoised one). */
  localModels?: () => Promise<string[]>;
  fetch?: typeof fetch;
  ollamaUrl?: string;
  ollamaTimeoutMs?: number;
}

/**
 * Build the `NodeInfo` a perch reports (ARCHITECTURE §6).
 *
 * A perch is always `kind: 'remote'` from the hub's point of view, even when it is this laptop's
 * own daemon. Capacity and activity come from the wrapped `ExecutionNode`; identity comes from the
 * OS (or the injected probe). `lastSeen` uses the injected clock so tests are deterministic.
 */
export async function perchInfo(opts: PerchInfoOptions): Promise<NodeInfo> {
  const clock = opts.clock ?? systemClock;
  const probe = opts.os ?? (() => probeOs({ exec: opts.exec }));
  const [nodeInfo, facts] = await Promise.all([opts.node.info(), probe()]);

  const localModels =
    opts.lendModels === false
      ? []
      : opts.localModels !== undefined
        ? await opts.localModels()
        : await listLocalModels({
            fetch: opts.fetch,
            ollamaUrl: opts.ollamaUrl,
            timeoutMs: opts.ollamaTimeoutMs,
          });

  const requestedName = opts.name?.trim();
  const name =
    requestedName !== undefined && requestedName.length > 0 && requestedName !== 'auto'
      ? requestedName
      : (facts.computerName ?? facts.hostname);

  const status = nodeInfo.status === 'offline' ? 'offline' : nodeInfo.activeSessions > 0 ? 'busy' : 'online';

  return {
    id: opts.id ?? nodeInfo.id,
    name,
    kind: 'remote',
    url: opts.url ?? nodeInfo.url,
    platform: facts.platform,
    arch: facts.arch,
    cpuCores: facts.cpuCores,
    memGb: facts.memGb,
    maxSessions: opts.maxSessions ?? nodeInfo.maxSessions,
    activeSessions: nodeInfo.activeSessions,
    localModels,
    status,
    lastSeen: clock.now(),
  };
}
