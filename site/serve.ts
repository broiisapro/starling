/**
 * Static preview server for `site/dist/` — the same bytes GitHub Pages will serve.
 *
 *   bun run --cwd site build && bun run --cwd site serve
 *
 * Deliberately tiny: no directory listing, no traversal, no cache surprises.
 */
import { join, normalize, sep } from 'node:path';

const root = join(import.meta.dir, 'dist');
const port = Number(process.env.PORT ?? 4173);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname);
    const path = normalize(requested === '/' ? 'index.html' : requested.replace(/^\/+/, ''));
    if (path.startsWith('..') || path.includes(`..${sep}`)) {
      return new Response('forbidden', { status: 403 });
    }
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) return new Response('not found', { status: 404 });
    const ext = path.slice(path.lastIndexOf('.'));
    return new Response(file, {
      headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' },
    });
  },
});

console.log(`Starling site on ${server.url}`);
