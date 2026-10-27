/**
 * A minimal hub for the Flock loopback E2E (`tools/flock/loopback.ts`).
 *
 * `apps/server` owns the real HTTP routes; this tool serves only the four hub routes a perch calls,
 * wired to the *real* `createFlockHub` + `createRegistry` + `createLocalNode` from `@starling/flock`.
 * That is deliberate: the loopback has to exercise the hub logic (register, heartbeat, graceful
 * leave, bundles) without needing the server epic's composition on this branch, and without the mock
 * engine that Wave 1 used.
 *
 * Two behaviours the real server should copy (filed as a FIX REQUEST in the Epic 42 handback):
 * - a heartbeat for an unknown node id answers **404**, so the perch re-registers;
 * - a heartbeat with `status: 'offline'` is forwarded, and `createFlockHub` turns it into an
 *   immediate `left` with reason `perch-stopped` (no 15 s wait).
 *
 * Imports reach the workspace packages by relative path because `tools/` is not a Bun workspace, so
 * package specifiers do not resolve from here. They still go through each package's public index.
 */
import { join } from 'node:path';
import {
  type AgentRunner,
  exec as coreExec,
  type NodeInfo,
  NodeInfoSchema,
  StarlingError,
  systemClock,
} from '../../packages/core/src/index.ts';
import {
  createBundleOps,
  createFlockHub,
  createLocalNode,
  createRegistry,
  type FlockHub,
  type FlockRegistry,
  type LocalNode,
} from '../../packages/flock/src/index.ts';
import { createWorkspace } from '../../packages/workspace/src/index.ts';

export interface LoopbackHubOptions {
  /** The git repo perches clone from and push bundles back into. */
  repoPath: string;
  /** Where the hub's own worktrees, bundle cache and incoming bundles live. */
  root: string;
  /** Bind port. Default 0 (ephemeral) so a developer's real hub on 7777 is never disturbed. */
  port?: number;
  /** Fixed join code, so the printed command is copy-pastable between runs. Default `LOOP-BACK`. */
  code?: string;
  /** Default 800 ms: long enough to be realistic, short enough for a fast crash-simulation test. */
  offlineAfterMs?: number;
  sweepMs?: number;
  /** The hub's own session slots. The loopback defaults to 0 so every task must run on a perch. */
  maxSessions?: number;
  name?: string;
}

export interface LoopbackHub {
  url: string;
  code: string;
  registry: FlockRegistry;
  flock: FlockHub;
  node: LocalNode;
  close(): Promise<void>;
}

const TOKEN_HEADER = 'x-flock-token';

/** A runner that refuses to start: the hub node exists only to prove a local node with 0 slots. */
const idleRunner: AgentRunner = {
  async start() {
    throw new StarlingError('INVALID_ARGUMENT', 'the loopback hub node runs no agents');
  },
  async send() {},
  async abort() {},
  onEvent() {
    return () => {};
  },
  async close() {},
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

async function readBody<T>(
  req: Request,
  parse: (input: unknown) => T,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: json(errorBody('invalid-json', 'body must be JSON'), 400) };
  }
  try {
    return { ok: true, value: parse(raw) };
  } catch (err) {
    return {
      ok: false,
      response: json(errorBody('invalid-body', err instanceof Error ? err.message : String(err)), 400),
    };
  }
}

function parseRegister(raw: unknown): { url: string; info: NodeInfo } {
  if (typeof raw !== 'object' || raw === null) throw new Error('body must be an object');
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== 'string' || value.url.length === 0) throw new Error('url is required');
  return { url: value.url, info: NodeInfoSchema.parse(value.info) };
}

function parseHeartbeat(raw: unknown): { nodeId: string; info: NodeInfo } {
  if (typeof raw !== 'object' || raw === null) throw new Error('body must be an object');
  const value = raw as Record<string, unknown>;
  if (typeof value.nodeId !== 'string' || value.nodeId.length === 0) {
    throw new Error('nodeId is required');
  }
  return { nodeId: value.nodeId, info: NodeInfoSchema.parse(value.info) };
}

/**
 * Start a real hub: registry + local node + `FlockHub` + the four HTTP routes perches need.
 *
 * The bundle route serves `flock.bundle(ref)`, which is the same deduplicated, atomically-written
 * bundle cache the real server mounts under `GET /api/flock/bundle`.
 */
export async function startLoopbackHub(options: LoopbackHubOptions): Promise<LoopbackHub> {
  const code = options.code ?? 'LOOP-BACK';
  const registry = createRegistry({
    clock: systemClock,
    offlineAfterMs: options.offlineAfterMs ?? 800,
    tickMs: options.sweepMs ?? 100,
  });

  const hubRoot = join(options.root, 'hub');
  const node = createLocalNode({
    id: 'hub',
    name: options.name ?? 'Loopback Hub',
    workspace: createWorkspace({ worktreeRoot: join(hubRoot, 'worktrees') }),
    runner: idleRunner,
    maxSessions: options.maxSessions ?? 0,
    worktreeRoot: join(hubRoot, 'worktrees'),
    bundleDir: join(hubRoot, 'bundles'),
    repoCacheDir: join(hubRoot, 'repos'),
  });
  registry.add(node, await node.info());

  let flock: FlockHub | undefined;

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: '127.0.0.1',
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (flock === undefined) return json(errorBody('not-ready', 'hub is still starting'), 503);

      if (req.method === 'GET' && path === '/api/nodes') return json(registry.list());
      if (req.method === 'GET' && path === '/api/flock/join') return json(flock.joinInfo());

      if (!flock.verifyToken(req.headers.get(TOKEN_HEADER) ?? undefined)) {
        return json(errorBody('unauthorized', `missing or invalid ${TOKEN_HEADER}`), 401);
      }

      if (req.method === 'POST' && path === '/api/flock/register') {
        const body = await readBody(req, parseRegister);
        if (!body.ok) return body.response;
        const { nodeId } = await flock.register(body.value);
        return json({ nodeId }, 201);
      }

      if (req.method === 'POST' && path === '/api/flock/heartbeat') {
        const body = await readBody(req, parseHeartbeat);
        if (!body.ok) return body.response;
        // Unknown ids get a 404: the perch drops its id and registers again. The hub *also*
        // re-registers fire-and-forget when the info carries a URL, so either side can be first.
        if (registry.get(body.value.nodeId) === undefined) {
          return json(errorBody('unknown-node', 're-register with /api/flock/register'), 404);
        }
        flock.heartbeat(body.value);
        return json({ ok: true });
      }

      if (req.method === 'GET' && path === '/api/flock/bundle') {
        const ref = url.searchParams.get('ref')?.trim() ?? '';
        if (ref.length === 0) return json(errorBody('invalid-query', 'ref is required'), 400);
        const { path: bundlePath } = await flock.bundle(ref);
        const file = Bun.file(bundlePath);
        if (!(await file.exists())) return json(errorBody('not-found', ref), 404);
        return new Response(file, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(file.size),
          },
        });
      }

      return json(errorBody('not-found', `${req.method} ${path}`), 404);
    },
  });

  const actualPort = server.port;
  if (actualPort === undefined) {
    server.stop(true);
    throw new StarlingError('UNKNOWN', 'loopback hub could not bind a port');
  }
  const hubUrl = `http://127.0.0.1:${actualPort}`;

  flock = createFlockHub({
    registry,
    hubUrl,
    code,
    clock: systemClock,
    exec: coreExec,
    bundleDir: join(hubRoot, 'served-bundles'),
    bundleOps: createBundleOps(),
  });
  flock.setActiveRepo(options.repoPath);

  return {
    url: hubUrl,
    code: flock.code,
    registry,
    flock,
    node,
    async close() {
      await flock?.close();
      registry.close();
      server.stop(true);
    },
  };
}
