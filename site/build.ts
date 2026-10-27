/**
 * Build the landing page into `site/dist/`.
 *
 * One HTML entrypoint: Bun's bundler follows the `<link>` and `<script type="module">` tags,
 * minifies the CSS and TS, and rewrites the HTML to hashed asset names. Everything is copied
 * locally — the page has no CDN, font or network dependency at all, so it works from a USB stick.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = import.meta.dir;
const outdir = join(root, 'dist');

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, 'index.html')],
  outdir,
  target: 'browser',
  minify: true,
  sourcemap: 'none',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('site build failed');
}

// The stats file is read at runtime (so Epic 68's collector can regenerate it without a rebuild)
// and shipped next to the HTML as a plain static asset.
await mkdir(join(outdir, 'data'), { recursive: true });
await cp(join(root, 'data', 'stats.json'), join(outdir, 'data', 'stats.json'));

const files = [...result.outputs.map((output) => output.path), join(outdir, 'data', 'stats.json')];
let total = 0;
console.log('site/dist');
for (const path of files.sort()) {
  const { size } = await stat(path);
  total += size;
  console.log(`  ${(size / 1024).toFixed(1).padStart(6)} KB  ${path.slice(outdir.length + 1)}`);
}
console.log(`  ${(total / 1024).toFixed(1).padStart(6)} KB  total`);
if (total > 300 * 1024) {
  throw new Error(`site is over budget: ${(total / 1024).toFixed(1)} KB > 300 KB`);
}
