/**
 * Static hosting for the built dashboard (`apps/web/dist`), with an SPA fallback.
 *
 * The server is the only thing on the LAN, so this intentionally does not use `hono/bun`'s
 * `serveStatic`: a tiny `node:fs` reader keeps the handler testable through `app.request` and makes
 * the traversal check explicit. `/api/*` is never served from here — the API routes are mounted first
 * and this handler calls `next()` for API paths, so an unknown endpoint still gets a JSON 404.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Context } from 'hono';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function readFileIfPresent(path: string): Buffer | undefined {
  if (!existsSync(path)) return undefined;
  const stat = statSync(path);
  if (!stat.isFile()) return undefined;
  return readFileSync(path);
}

/** Resolve a URL pathname to a file inside `webDist`, or `undefined` when it would escape the root. */
export function resolveStaticPath(webDist: string, pathname: string): string | undefined {
  const root = resolve(webDist);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const relative = decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relative === '' ? 'index.html' : relative);
  return isInside(root, candidate) ? candidate : undefined;
}

function send(c: Context, path: string, body: Buffer): Response {
  const headers: Record<string, string> = {
    'content-type': contentTypeFor(path),
    // Vite emits content-hashed assets under /assets/, so those are safe to cache forever.
    'cache-control': path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(new Uint8Array(body), { status: 200, headers });
}

/**
 * Serve `webDist`. Files are served as-is; any other GET falls back to `index.html` so the React
 * router owns client-side routes. A missing `index.html` means this is not a web build: 404.
 */
export function serveWebDist(c: Context, webDist: string): Response {
  const target = resolveStaticPath(webDist, new URL(c.req.url).pathname);
  if (target !== undefined) {
    const body = readFileIfPresent(target);
    if (body !== undefined) return send(c, target, body);
  }
  const index = resolve(webDist, 'index.html');
  const html = readFileIfPresent(index);
  if (html === undefined) return c.text('Not found', 404);
  return send(c, index, html);
}
