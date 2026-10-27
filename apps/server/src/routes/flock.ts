/**
 * Flock routes (`/api/nodes`, `/api/flock/*`) — ARCHITECTURE §6.
 *
 * The hub↔perch channel is LAN-only and authenticated by one shared join code in `x-flock-token`.
 * `GET /api/flock/join` is deliberately open: it is what a perch (or the dashboard QR code) reads
 * *before* it has a token. Everything else that touches the flock requires the token, verified by the
 * injected `FlockHub` so the server never owns the secret.
 */
import type { NodeInfo } from '@starling/core';
import { NodeInfoSchema } from '@starling/core';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { FlockHub } from '../handshake';
import { fail, parseJsonBody } from '../http';

export const FLOCK_TOKEN_HEADER = 'x-flock-token';

export const RegisterBodySchema = z.object({
  url: z.string().min(1, 'url is required'),
  info: NodeInfoSchema,
});

export const HeartbeatBodySchema = z.object({
  nodeId: z.string().min(1, 'nodeId is required'),
  info: NodeInfoSchema,
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type HeartbeatBody = z.infer<typeof HeartbeatBodySchema>;

export interface FlockRouteDeps {
  flock?: FlockHub;
}

/** Hub first, then remote perches by name — the order the dashboard renders. */
export function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

type FlockGuard = { flock: FlockHub } | { response: Response };

function requireFlock(c: Context, flock: FlockHub | undefined): FlockGuard {
  if (flock === undefined) {
    return {
      response: fail(c, 503, 'FLOCK_DISABLED', 'This server has no flock hub configured (single-node mode).'),
    };
  }
  return { flock };
}

function requireToken(c: Context, flock: FlockHub | undefined): FlockGuard {
  const guarded = requireFlock(c, flock);
  if ('response' in guarded) return guarded;
  if (!guarded.flock.verifyToken(c.req.header(FLOCK_TOKEN_HEADER))) {
    return { response: fail(c, 401, 'UNAUTHORIZED', `Missing or invalid ${FLOCK_TOKEN_HEADER}`) };
  }
  return guarded;
}

export function mountFlock(app: Hono, deps: FlockRouteDeps): void {
  // Not a flock-only route: with no flock hub the hub is simply the only node, so an empty list is
  // the honest answer and keeps the dashboard from showing an error before a perch ever joins.
  app.get('/api/nodes', (c) => c.json(sortNodes(deps.flock?.registry.list() ?? [])));

  app.get('/api/flock/join', (c) => {
    const guarded = requireFlock(c, deps.flock);
    if ('response' in guarded) return guarded.response;
    return c.json(guarded.flock.joinInfo());
  });

  app.post('/api/flock/register', async (c) => {
    const guarded = requireToken(c, deps.flock);
    if ('response' in guarded) return guarded.response;

    const body = await parseJsonBody(c, RegisterBodySchema);
    if (!body.ok) return body.response;

    const { nodeId } = await guarded.flock.register({ url: body.value.url, info: body.value.info });
    return c.json({ nodeId }, 201);
  });

  app.post('/api/flock/heartbeat', async (c) => {
    const guarded = requireToken(c, deps.flock);
    if ('response' in guarded) return guarded.response;

    const body = await parseJsonBody(c, HeartbeatBodySchema);
    if (!body.ok) return body.response;

    guarded.flock.heartbeat({ nodeId: body.value.nodeId, info: body.value.info });
    return c.json({ ok: true });
  });

  app.get('/api/flock/bundle', async (c) => {
    const guarded = requireToken(c, deps.flock);
    if ('response' in guarded) return guarded.response;

    const ref = c.req.query('ref')?.trim() ?? '';
    if (ref.length === 0) {
      return fail(c, 400, 'INVALID_QUERY', 'ref is required, e.g. /api/flock/bundle?ref=main');
    }

    const { path } = await guarded.flock.bundle(ref);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return fail(c, 404, 'NOT_FOUND', `The hub produced no bundle for ${ref}`);
    }
    return new Response(file, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(file.size),
        'content-disposition': `attachment; filename="${ref.replace(/[^A-Za-z0-9._-]+/g, '-')}.bundle"`,
      },
    });
  });
}
