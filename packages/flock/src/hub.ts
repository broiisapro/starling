import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock, ExecutionNode, NodeInfo } from '@starling/core';
import { exec as coreExec, NodeInfoSchema, newId, StarlingError } from '@starling/core';
import type { BundleOps } from './bundle-ops';
import type { FlockHub as HandshakeFlockHub, JoinInfo } from './handshake';
import { requestJson } from './http';
import { formatJoinCode, generateJoinCode, normalizeJoinCode, verifyJoinCode } from './join-code';
import type { DiscoveredPerch, MdnsBrowser } from './mdns';
import { perchUrl } from './mdns';
import type { FlockRegistry } from './registry';
import { createRemoteNode } from './remote-node';

export interface FlockHubOptions {
  /** The roster. It should already contain the hub's own `LocalNode` with id `'hub'`. */
  registry: FlockRegistry;
  /** Base URL perches use to reach this hub, e.g. `http://192.168.1.10:7777`. */
  hubUrl: string;
  /** Fixed join code (tests, or a user who wants a memorable one). Defaults to a random one. */
  code?: string;
  exec?: typeof coreExec;
  /** Directory for bundled refs served to perches. */
  bundleDir: string;
  clock: Clock;
  /** Optional mDNS browser. When present, perches are discovered and auto-registered. */
  mdns?: MdnsBrowser;
  fetch?: typeof fetch;
  /** Per-request deadline for perch discovery and registration. */
  timeoutMs?: number;
  /** SSE reconnect delay for remote nodes this hub creates. */
  reconnectMs?: number;
  /** Bundle helpers for importing a perch's result. Without them the bundle is downloaded only. */
  bundleOps?: Partial<BundleOps>;
  bundleTimeoutMs?: number;
}

/** The hub side of Flock mode: join codes, registration, heartbeats, discovery and repo bundles. */
export interface FlockHub extends HandshakeFlockHub {
  readonly code: string;
  readonly registry: FlockRegistry;
  /**
   * Try a discovered perch: ask `/perch/info` with the join code and register it when it answers.
   * Returns the node id, or `undefined` when it is not ours (wrong code, unreachable, or stale ad).
   */
  discover(perch: DiscoveredPerch): Promise<string | undefined>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    // A missing bundle is the cache miss we want; real failures surface from `git bundle create`.
    return false;
  }
}

/**
 * `FlockHub` (ARCHITECTURE §8) on top of the registry.
 *
 * The join code is the only credential: it is printed as `starling perch --hub <url> --code <code>` and
 * travels as `x-flock-token` on every hub↔perch call. Verification is constant-time, and a wrong code
 * is answered with 401 by the server, which keeps the LAN demo honest without pretending to be TLS.
 *
 * Repo transfer is bundle-only (L18): `bundle(ref)` resolves `ref` to a sha, writes
 * `<bundleDir>/<sha>.bundle` once and serves that file to every perch that asks for the same ref.
 */
export function createFlockHub(options: FlockHubOptions): FlockHub {
  const run = options.exec ?? coreExec;
  const fetchFn = options.fetch ?? fetch;
  const code = options.code === undefined ? generateJoinCode() : normalizeJoinCode(options.code);
  const displayCode = formatJoinCode(code);
  const remoteNodes = new Map<string, ExecutionNode>();
  let activeRepo: string | undefined;
  let stopBrowse: (() => void) | undefined;
  /** Bundles being written right now, so two perches asking for the same ref share one `git bundle`. */
  const inFlight = new Map<string, Promise<string>>();

  const bundlePathFor = async (ref: string): Promise<string> => {
    if (activeRepo === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'No active repo: call setActiveRepo before bundle()');
    }
    const resolved = await run(['git', 'rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: activeRepo,
      timeoutMs: 15_000,
    });
    if (resolved.code !== 0) {
      throw new StarlingError('EXEC_FAILED', `git rev-parse ${ref} failed: ${resolved.stderr.trim()}`, {
        details: { repo: activeRepo, ref },
      });
    }
    const sha = resolved.stdout.trim();
    const repo = activeRepo;
    const path = join(options.bundleDir, `${sha}.bundle`);
    if (await exists(path)) return path;

    const alreadyRunning = inFlight.get(path);
    if (alreadyRunning !== undefined) return alreadyRunning;

    const write = (async (): Promise<string> => {
      await mkdir(options.bundleDir, { recursive: true });
      // Write to a sibling temp file and rename, so a crashed bundle never becomes a cached, corrupt
      // file that perches keep downloading until someone clears the cache by hand.
      const temp = `${path}.${newId()}.partial`;
      const created = await run(['git', 'bundle', 'create', temp, ref], {
        cwd: repo,
        timeoutMs: options.bundleTimeoutMs ?? 120_000,
      });
      if (created.code !== 0) {
        await rm(temp, { force: true });
        throw new StarlingError('EXEC_FAILED', `git bundle create ${ref} failed: ${created.stderr.trim()}`, {
          details: { repo, ref, path },
        });
      }
      await rename(temp, path);
      return path;
    })();

    inFlight.set(path, write);
    try {
      return await write;
    } finally {
      inFlight.delete(path);
    }
  };

  const hub: FlockHub = {
    registry: options.registry,
    code,

    joinInfo(): JoinInfo {
      return {
        code: displayCode,
        hubUrl: options.hubUrl,
        command: `starling perch --hub ${options.hubUrl} --code ${displayCode}`,
      };
    },

    verifyToken(token) {
      return verifyJoinCode(code, token);
    },

    async register(input) {
      const nodeId = input.info.id;
      const stored = options.registry.list().find((candidate) => candidate.id === nodeId);
      if (stored !== undefined && stored.url === input.url) {
        options.registry.touch(nodeId, { ...input.info, url: input.url, lastSeen: options.clock.now() });
        return { nodeId };
      }
      if (stored !== undefined) {
        // Same perch, new address (a restart bound a different port): the old RemoteNode points at a
        // dead URL, so replace it instead of touching it.
        options.registry.remove(nodeId, 're-registered at a new url');
        const previous = remoteNodes.get(nodeId);
        if (previous !== undefined && 'close' in previous && typeof previous.close === 'function') {
          previous.close();
        }
        remoteNodes.delete(nodeId);
      }

      const node = createRemoteNode({
        url: input.url,
        token: code,
        info: { ...input.info, url: input.url },
        fetch: fetchFn,
        clock: options.clock,
        bundleOps: options.bundleOps,
        bundleDir: join(options.bundleDir, 'incoming'),
        timeoutMs: options.timeoutMs,
        reconnectMs: options.reconnectMs,
      });
      remoteNodes.set(nodeId, node);
      options.registry.add(node, {
        ...input.info,
        kind: 'remote',
        url: input.url,
        status: input.info.status === 'busy' ? 'busy' : 'online',
        activeSessions: Math.max(0, input.info.activeSessions),
        lastSeen: options.clock.now(),
      });
      return { nodeId };
    },

    heartbeat(input) {
      const stored = options.registry.list().find((candidate) => candidate.id === input.nodeId);

      if (input.info.status === 'offline') {
        // Graceful stop: `starling perch` sends one last heartbeat with `status: 'offline'` because the
        // locked Perch API has no deregister route. Treat it as an immediate leave instead of waiting
        // up to `offlineAfterMs` for the sweep — the engine can reschedule the perch's tasks now.
        if (stored === undefined) return;
        options.registry.remove(input.nodeId, 'perch-stopped');
        const node = remoteNodes.get(input.nodeId);
        if (node !== undefined && 'close' in node && typeof node.close === 'function') {
          (node as ExecutionNode & { close(): void }).close();
        }
        remoteNodes.delete(input.nodeId);
        return;
      }

      const known = options.registry.touch(input.nodeId, {
        ...input.info,
        url: input.info.url ?? stored?.url,
        lastSeen: options.clock.now(),
      });
      if (known !== undefined) return;

      // Unknown id: the perch restarted (or we restarted). Re-register when it told us where it lives.
      // `heartbeat` is synchronous by contract, so the retry is fire-and-forget; the perch heartbeats
      // again in 3 s and will be picked up then if this attempt loses a race.
      const url = input.info.url;
      if (url === undefined) return;
      void hub.register({ url, info: input.info }).catch(() => undefined);
    },

    async bundle(ref) {
      return { path: await bundlePathFor(ref) };
    },

    setActiveRepo(repoPath) {
      activeRepo = repoPath;
    },

    async discover(perch) {
      const url = perchUrl(perch);
      let info: NodeInfo;
      try {
        info = await requestJson(`${url}/perch/info`, { method: 'GET' }, NodeInfoSchema, {
          fetch: fetchFn,
          token: code,
          timeoutMs: options.timeoutMs,
        });
      } catch {
        // Wrong code (401), unreachable host, or a non-Starling ad: not a perch of ours. The ad may
        // reappear next time the Air's lid opens, so there is nothing to remember or report.
        return undefined;
      }
      const { nodeId } = await hub.register({ url, info: { ...info, url } });
      return nodeId;
    },

    async close() {
      stopBrowse?.();
      stopBrowse = undefined;
      options.mdns?.close();
      for (const node of remoteNodes.values()) {
        if ('close' in node && typeof node.close === 'function') {
          (node as ExecutionNode & { close(): void }).close();
        }
      }
      remoteNodes.clear();
    },
  };

  if (options.mdns !== undefined) {
    stopBrowse = options.mdns.browse((perch) => {
      // Discovery is opportunistic: a perch that belongs to another hub (or just closed its lid) is
      // simply not registered next time. `discover` records nothing on failure by design.
      void hub.discover(perch).catch(() => undefined);
    });
  }

  return hub;
}
