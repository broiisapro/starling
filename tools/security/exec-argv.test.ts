/**
 * Probe: `exec` is argv-only everywhere (ARCHITECTURE L13: shell out to `git`/`gh`, never a shell
 * string). This is a static probe: it reads the production sources and fails if a shell appears.
 *
 * Two allowed `bash -c` sites exist by design — the auditor runs the repo's test/lint command and the
 * merger runs the regression suite. Those commands come from config or from the repo map, never from
 * an HTTP request, so the probe asserts *that* rather than banning the pattern outright.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const SOURCE_ROOTS = ['packages', 'apps'].map((dir) => join(ROOT, dir));

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) files.push(path);
  }
  return files;
}

const SOURCES = SOURCE_ROOTS.flatMap((dir) => walk(dir));

function rel(path: string): string {
  return path.slice(ROOT.length + 1);
}

describe('exec is argv-only', () => {
  test('the probe actually found the sources', () => {
    expect(SOURCES.length).toBeGreaterThan(200);
  });

  test('no shell: true, no Bun.$, no child_process, no execSync', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of [
        /\bshell\s*:\s*true/,
        /\bBun\.\$/,
        /from\s+['"]node:child_process['"]/,
        /\bexecSync\s*\(/,
      ]) {
        if (pattern.test(text)) offenders.push(`${rel(file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every bash -c command is config-derived, not request-derived', () => {
    const sites: Array<{ file: string; expression: string }> = [];
    const call = /\[\s*'(?:bash|sh)'\s*,\s*'-c'\s*,\s*([^\]]+?)\s*\]/g;
    for (const file of SOURCES) {
      if (file.endsWith('.test.ts') || file.includes('/test/')) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(call)) {
        sites.push({ file: rel(file), expression: match[1] ?? '' });
      }
    }
    // The auditor and the merger are the only two callers today. If a third appears, this surfaces it
    // for review rather than silently blessing a shell.
    expect(sites.map((site) => site.file).sort()).toEqual([
      'packages/auditor/src/commands.ts',
      'packages/merger/src/merge.ts',
    ]);
    for (const site of sites) {
      expect({ file: site.file, expression: site.expression }).not.toMatchObject({
        expression: expect.stringMatching(/req\.|request\.|body\.|query\.|params\.|headers\./i),
      });
      expect(site.expression).not.toContain('`');
    }
  });

  test('git is always invoked as an argv array', () => {
    // A `git ...` string handed to exec() would be the classic injection; there is none today.
    const offenders: string[] = [];
    for (const file of SOURCES) {
      if (file.endsWith('.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      if (/exec\(\s*['"`]git\s/.test(text)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });
});
