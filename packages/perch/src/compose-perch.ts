import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentRunner, BundleOps, Clock, EventBus, Workspace } from '@starling/core';
import { createLocalNode, type LocalNode } from '@starling/flock';
import { createOpencodeRunner } from '@starling/runner';
import { createWorkspace } from '@starling/workspace';
import type { MdnsAdvertiser } from './handshake';
import { type ExecFn, type OsProbe, probeOs } from './perch-info';
import { type PerchHandle, startPerch } from './perch-daemon';

export interface ComposePerchOptions {
  /** Hub base URL, e.g. `http://192.168.1.20:7777`. Omit for mDNS-only discovery. */
  hub?: string;
  /** The flock join code (`XXXX-XXXX`). */
  code?: string;
  /** Perch API port. Default 7778. `0` binds an ephemeral port. */
  port?: number;
  /** Session slots to lend. Default 5. */
  maxSessions?: number;
  /** Name shown in the flock. Defaults to the machine's ComputerName. */
  name?: string;
  /** Perch state root. `<cacheDir>/<name>` holds worktrees and bundle caches. */
  cacheDir?: string;
  /** Home directory used to expand a leading `~`. Injected by tests. */
  home?: string;
  /** Override the local workspace (tests pass a mock; production gets real git worktrees). */
  workspace?: Workspace & Partial<BundleOps>;
  /** Override the agent runner (tests pass a mock; production spawns `opencode serve`). */
  runner?: AgentRunner;
  /** mDNS advertiser, or `false` to stay silent on the LAN (tests, tight firewalls). */
  mdns?: MdnsAdvertiser | false;
  lendModels?: boolean;
  fetch?: typeof fetch;
  clock?: Clock;
  os?: OsProbe;
  exec?: ExecFn;
  bus?: EventBus;
  heartbeatMs?: number;
  /** Host the hub should dial. Tests pass `127.0.0.1`; production uses the LAN address. */
  publicHost?: string;
  /** Executable used for `opencode serve`. Default `opencode`. */
  opencodeCommand?: string;
}

/** A fully composed perch: everything still running, plus the one-line status the CLI prints. */
export interface RealPerch {
  node: LocalNode;
  handle: PerchHandle;
  root: string;
  name: string;
  maxSessions: number;
  hub?: string;
  /** 🪺 roosting on MacBook Pro · 2/5 sessions */
  statusLine(): string;
  /** Stop the daemon, abort sessions, close the runner. Idempotent. */
  stop(): Promise<void>;
}

/** Filesystem-safe, stable node id for a display name. `MacBook Pro` → `perch-macbook-pro`. */
export function perchNodeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `perch-${slug === '' ? 'local' : slug}`;
}

/** `~/.starling/perch` → `/Users/you/.starling/perch`, without pulling a config library into tests. */
export function expandHome(path: string, home = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

export interface PerchStatusInput {
  name: string;
  activeSessions: number;
  maxSessions: number;
  hub?: string;
}

/** The one line the perch prints: "🪺 roosting on MacBook Pro · 2/5 sessions". */
export function perchStatusLine(input: PerchStatusInput): string {
  const base = `🪺 roosting on ${input.name} · ${input.activeSessions}/${input.maxSessions} sessions`;
  return input.hub === undefined ? `${base} · waiting for a hub` : base;
}

/**
 * Build the daemon behind `starling perch`.
 *
 * The composition is deliberately small and lives here (not in `apps/cli`) so it can be unit-tested
 * with injected workspace/runner/fetch fakes and never spawns `opencode` in a test run:
 *
 * 1. a per-perch state root, `<cacheDir>/<name>`, so two perches on one laptop cannot share worktrees;
 * 2. the real git `Workspace` (worktrees + bundles) and a spawned `opencode serve` runner;
 * 3. a `LocalNode` exposing them to the hub;
 * 4. `startPerch`, which serves the Perch API, advertises mDNS, registers and heartbeats.
 */
export async function composePerch(options: ComposePerchOptions = {}): Promise<RealPerch> {
  const home = options.home ?? homedir();
  const maxSessions = options.maxSessions ?? 5;
  const requestedName = options.name?.trim();
  const osFacts = await (options.os ?? (() => probeOs({ exec: options.exec })))();
  const resolvedName =
    requestedName !== undefined && requestedName.length > 0 && requestedName !== 'auto'
      ? requestedName
      : (osFacts.computerName ?? osFacts.hostname);
  const name = resolvedName;

  const root = join(expandHome(options.cacheDir ?? join(home, '.starling', 'perch'), home), perchNodeId(name));
  const worktreeRoot = join(root, 'worktrees');
  await mkdir(worktreeRoot, { recursive: true });

  const workspace = options.workspace ?? createWorkspace({ worktreeRoot });
  const runner =
    options.runner ??
    createOpencodeRunner({
      mode: 'spawn',
      ...(options.opencodeCommand === undefined ? {} : { command: options.opencodeCommand }),
    });

  const node = createLocalNode({
    id: perchNodeId(name),
    name,
    workspace,
    runner,
    maxSessions,
    worktreeRoot,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  const handle = await startPerch({
    node,
    name,
    maxSessions,
    ...(options.hub === undefined ? {} : { hub: options.hub }),
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.lendModels === undefined ? {} : { lendModels: options.lendModels }),
    ...(options.mdns === undefined || options.mdns === false ? {} : { mdns: options.mdns }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.os === undefined ? {} : { os: options.os }),
    ...(options.exec === undefined ? {} : { exec: options.exec }),
    ...(options.bus === undefined ? {} : { bus: options.bus }),
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
    ...(options.publicHost === undefined ? {} : { publicHost: options.publicHost }),
  });

  let stopped = false;

  return {
    node,
    handle,
    root,
    name,
    maxSessions,
    ...(options.hub === undefined ? {} : { hub: options.hub }),
    statusLine: () =>
      perchStatusLine({
        name,
        activeSessions: node.activeSessions(),
        maxSessions,
        ...(options.hub === undefined ? {} : { hub: options.hub }),
      }),
    async stop() {
      if (stopped) return;
      stopped = true;
      await handle.stop();
      await node.close();
      await runner.close();
    },
  };
}
