import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * `@starling/core/browser` must be safe to bundle for a browser (Epic 34 and Wave 2 will import it
 * from the web app). This test is the guard.
 *
 * Two layers, because Bun is deliberately forgiving with `target: 'browser'`: it stubs `node:fs` to
 * `(() => ({}))` instead of failing. So we (a) read the build's metafile and reject any unresolved
 * (`external`) import or any core module that is not on the allowed pure list, and (b) scan the
 * emitted text for `node:`, `Bun.` and `process.env`.
 */
const ENTRY = join(import.meta.dir, 'browser.ts');

/** The only core modules allowed in a browser bundle. */
const ALLOWED_SOURCES = [
  'src/browser.ts',
  'src/contracts.ts',
  'src/errors.ts',
  'src/glob.ts',
  'src/handshake.ts',
  'src/ids.ts',
  'src/metrics.ts',
];

describe('@starling/core/browser', () => {
  test('bundles for the browser with no node: imports or Bun globals', async () => {
    const result = await Bun.build({
      entrypoints: [ENTRY],
      target: 'browser',
      format: 'esm',
      minify: false,
      sourcemap: 'none',
      metafile: true,
      throw: false,
    });

    const logs = result.logs.map((log) => String(log.message ?? log)).join('\n');
    expect(result.success, `Bun.build failed for the browser: ${logs}`).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);

    const inputs = result.metafile?.inputs ?? {};
    const external: string[] = [];
    for (const [path, input] of Object.entries(inputs)) {
      for (const imported of input.imports) {
        if (imported.external === true) external.push(`${path} → ${imported.path}`);
      }
    }
    expect(external, 'browser bundle must not leave anything external (node:, bun:, …)').toEqual([]);

    const coreSources = Object.keys(inputs).filter((path) => path.startsWith('src/'));
    expect(coreSources.sort()).toEqual([...ALLOWED_SOURCES].sort());

    for (const output of result.outputs) {
      const text = await output.text();
      expect(text).not.toMatch(/\bfrom\s*['"]node:/);
      expect(text).not.toMatch(/\brequire\(\s*['"]node:/);
      expect(text).not.toMatch(/\bBun\./);
      // Node's `process` would also mean someone reached into a server-only module.
      expect(text).not.toMatch(/\bprocess\.(env|argv|platform)\b/);
    }
  });

  test('the entry only pulls in the pure core modules', async () => {
    const source = await readFile(ENTRY, 'utf8');
    for (const forbidden of ['exec', 'config', 'clock', 'events', 'ports']) {
      expect(source).not.toContain(`'./${forbidden}'`);
    }
    for (const included of [
      "'./contracts'",
      "'./errors'",
      "'./glob'",
      "'./handshake'",
      "'./ids'",
      "'./metrics'",
    ]) {
      expect(source).toContain(included);
    }
  });

  test('exports the pricing table and the schemas the UI needs', async () => {
    const browser = await import('./browser');
    expect(browser.PRICING['deepseek-v4.1-flash']?.outputPerM).toBeGreaterThan(0);
    expect(browser.RunSchema.parse).toBeFunction();
    expect(browser.StarlingEventSchema.parse).toBeFunction();
    expect(browser.matchesAny('src/ui/button.tsx', ['src/ui/**'])).toBe(true);
    expect(browser.newId()).toHaveLength(26);
    expect(browser.PACKAGE).toBe('@starling/core/browser');
  });
});
