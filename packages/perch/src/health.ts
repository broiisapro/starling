import { constants } from 'node:fs';
import { access, statfs } from 'node:fs/promises';
import { type ExecutionNode, exec as coreExec } from '@starling/core';
import type { ExecFn } from './perch-info';

/**
 * `GET /perch/health` — the deep health check a presenter glances at on demo day.
 *
 * The value of a health endpoint is that it fails for the reasons a human cares about *before* the
 * hub notices: git is missing, the agent runner never came up, the worktree root is read-only, the
 * disk is full, every session slot is gone, the hub has not acknowledged a heartbeat in 3 intervals.
 *
 * Every probe is injected (file system, disk, git, clock, node), so the tests never touch the real
 * machine and a broken laptop still produces a deterministic report.
 */

/** Below this much free disk space the perch reports `degraded`. */
export const PERCH_MIN_FREE_BYTES = 2 * 1024 ** 3;

/** A heartbeat older than this many intervals is stale. */
export const PERCH_HEARTBEAT_STALE_FACTOR = 3;

export type PerchHealthCheckName = 'git' | 'runner' | 'worktreeRoot' | 'disk' | 'sessions' | 'hub';

export interface PerchHealthCheck {
  name: PerchHealthCheckName;
  ok: boolean;
  detail: string;
}

export type PerchHealthStatus = 'ok' | 'degraded' | 'draining';

export interface PerchHealth {
  ok: boolean;
  status: PerchHealthStatus;
  checks: PerchHealthCheck[];
}

/** What a single probe reports. `detail` is human-readable and safe to print on stage. */
export interface PerchProbeResult {
  ok: boolean;
  detail: string;
}

export interface PerchSessionCount {
  active: number;
  max: number;
}

export interface PerchHubProbe {
  /** False when the perch runs mDNS-only (no `--hub`): nothing to be stale about. */
  configured: boolean;
  heartbeatMs: number;
  /** Injected-clock timestamp of the last successful register/heartbeat, if there was one. */
  lastOkAt?: number;
}

export interface PerchHealthProbes {
  draining: () => boolean;
  now: () => number;
  git: () => Promise<PerchProbeResult> | PerchProbeResult;
  runner: () => Promise<PerchProbeResult> | PerchProbeResult;
  worktreeRoot: () => Promise<PerchProbeResult> | PerchProbeResult;
  /** Bytes free on the filesystem that holds the worktree root. */
  freeBytes: () => Promise<number> | number;
  sessions: () => Promise<PerchSessionCount> | PerchSessionCount;
  hub: () => PerchHubProbe;
}

/** `1.5 GiB` / `512 MiB` / `900 B`. Health output is read by a human, not parsed. */
export function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${Math.round(value)} B`;
}

/**
 * Run every probe and fold the answers into one report.
 *
 * A throwing probe is a failed check, never a failed health request: "the disk probe exploded" is
 * exactly what a presenter needs to see. `status` is `draining` when the perch is winding down
 * (even if every check passes) and `degraded` when any check fails.
 */
export async function buildPerchHealth(probes: PerchHealthProbes): Promise<PerchHealth> {
  const check = async (
    name: PerchHealthCheckName,
    run: () => Promise<PerchProbeResult> | PerchProbeResult,
  ): Promise<PerchHealthCheck> => {
    try {
      const result = await run();
      return { name, ok: result.ok, detail: result.detail };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { name, ok: false, detail: `probe failed: ${detail}` };
    }
  };

  const checks: PerchHealthCheck[] = [
    await check('git', probes.git),
    await check('runner', probes.runner),
    await check('worktreeRoot', probes.worktreeRoot),
    await check('disk', async () => {
      const free = await probes.freeBytes();
      return {
        ok: free >= PERCH_MIN_FREE_BYTES,
        detail: `${formatBytes(free)} free (minimum ${formatBytes(PERCH_MIN_FREE_BYTES)})`,
      };
    }),
    await check('sessions', async () => {
      const sessions = await probes.sessions();
      return { ok: sessions.active <= sessions.max, detail: `${sessions.active}/${sessions.max} sessions` };
    }),
    await check('hub', () => probeHub(probes.hub(), probes.now())),
  ];

  const draining = probes.draining();
  const allOk = checks.every((entry) => entry.ok);
  return {
    ok: allOk && !draining,
    status: draining ? 'draining' : allOk ? 'ok' : 'degraded',
    checks,
  };
}

/** The `hub` check: has the hub acknowledged us recently enough? */
export function probeHub(hub: PerchHubProbe, now: number): PerchProbeResult {
  if (!hub.configured) return { ok: true, detail: 'no hub configured (mDNS only)' };
  if (hub.lastOkAt === undefined) return { ok: false, detail: 'no successful heartbeat yet' };
  const age = Math.max(0, now - hub.lastOkAt);
  const limit = hub.heartbeatMs * PERCH_HEARTBEAT_STALE_FACTOR;
  return {
    ok: age <= limit,
    detail: `last heartbeat ${age} ms ago (stale after ${limit} ms)`,
  };
}

export interface PerchHealthProbeOptions {
  node: ExecutionNode;
  /** The perch state root the workspace writes worktrees into. Omitted in a bare daemon. */
  worktreeRoot?: string;
  heartbeatMs: number;
  hubConfigured: boolean;
  lastHeartbeatOkAt: () => number | undefined;
  draining: () => boolean;
  now: () => number;
  exec?: ExecFn;
  /** Override the disk probe (`statfs`). Injected by tests; never called with a real path then. */
  freeBytes?: () => Promise<number>;
}

/**
 * Build the production probes for a running perch.
 *
 * `git` runs through the injected `exec` (L13: argv form, no shell) with a short timeout — a health
 * request must answer in well under a second even when the box is at load 90. `runner` asks the
 * wrapped `ExecutionNode`, so a session backend that died shows up here. The disk probe is `statfs`
 * on the worktree root, and only `bavail` counts (reserved blocks are not ours to use).
 */
export function createPerchHealthProbes(opts: PerchHealthProbeOptions): PerchHealthProbes {
  const execFn = opts.exec ?? coreExec;
  const hostPath = opts.worktreeRoot ?? process.cwd();
  const freeBytes =
    opts.freeBytes ??
    (async (): Promise<number> => {
      const stats = await statfs(hostPath);
      return stats.bavail * stats.bsize;
    });

  return {
    draining: opts.draining,
    now: opts.now,
    async git() {
      const res = await execFn(['git', '--version'], { cwd: hostPath, timeoutMs: 2000 });
      const version = res.stdout.trim();
      if (res.code !== 0) {
        return { ok: false, detail: res.stderr.trim() || `git --version exited ${res.code}` };
      }
      return { ok: true, detail: version.length > 0 ? version : 'git answered' };
    },
    async runner() {
      const info = await opts.node.info();
      return {
        ok: true,
        detail: `${info.id} · ${info.status} · ${info.activeSessions}/${info.maxSessions} sessions`,
      };
    },
    async worktreeRoot() {
      if (opts.worktreeRoot === undefined) {
        return { ok: true, detail: 'no worktree root configured (nothing to check)' };
      }
      await access(opts.worktreeRoot, constants.W_OK);
      return { ok: true, detail: `${opts.worktreeRoot} is writable` };
    },
    freeBytes,
    async sessions() {
      const info = await opts.node.info();
      return { active: info.activeSessions, max: info.maxSessions };
    },
    hub: () => ({
      configured: opts.hubConfigured,
      heartbeatMs: opts.heartbeatMs,
      lastOkAt: opts.lastHeartbeatOkAt(),
    }),
  };
}
