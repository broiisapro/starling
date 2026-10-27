import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type exec, FakeClock, isStarlingError, type LLM } from '@starling/core';
import { MockLLM } from '@starling/core/testing';
import { importGraphOf, relatedFiles } from './imports';
import { createRepoMapper } from './mapper';
import { makeRepo, makeTempDir, removeDir, writeFiles } from './test-helpers';

const BINARY_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

describe('createRepoMapper', () => {
  test('maps a polyglot repo: languages, symbols, tree and commands', async () => {
    const root = await makeRepo({
      'package.json': JSON.stringify({ scripts: { test: 'bun test' } }),
      'bun.lock': '{}',
      'README.md': '# Demo\n\n## Usage\n',
      'src/main.ts': 'export function main() {}\nexport const app = 1\n',
      'src/lib/util.ts': 'export interface Util { a: number }\nexport type Mode = "a"\n',
      'src/ui/styles.css': '.app { color: red }\n.card:hover { color: blue }\n',
      'scripts/tool.py': 'def build():\n    pass\nclass Tool:\n    pass\n',
      'server/main.go': 'package main\nfunc main() {}\ntype Server struct{}\n',
      'native/lib.rs': 'pub fn run() {}\npub struct State;\n',
      'assets/logo.png': BINARY_PNG,
    });
    try {
      const map = await createRepoMapper().map(root);

      expect(map.root).toBe(root);
      expect(map.languages).toMatchObject({
        typescript: 2,
        css: 1,
        python: 1,
        go: 1,
        rust: 1,
        markdown: 1,
        json: 1,
      });
      expect(map.files.some((file) => file.path === 'assets/logo.png')).toBe(false);
      expect(map.files.find((file) => file.path === 'src/main.ts')?.symbols).toEqual(['main', 'app']);
      expect(map.files.find((file) => file.path === 'scripts/tool.py')?.symbols).toEqual(['build', 'Tool']);
      expect(map.files.find((file) => file.path === 'src/ui/styles.css')?.symbols).toEqual(['app', 'card']);
      expect(map.tree).toContain('src/');
      expect(map.tree).toContain('util.ts');
      expect(map.testCommand).toBe('bun run test');
      expect(map.tokenEstimate).toBeGreaterThan(0);
      expect(map.createdAt).toBeGreaterThan(0);
    } finally {
      await removeDir(root);
    }
  });

  test('skips files over the 256 KB cap', async () => {
    const root = await makeRepo({
      'small.ts': 'export const small = 1\n',
      'big.ts': `export const big = "${'x'.repeat(257 * 1024)}"\n`,
    });
    try {
      const map = await createRepoMapper().map(root);
      expect(map.files.map((file) => file.path)).toEqual(['small.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('skips lockfiles and vendored/build directories even when committed', async () => {
    const root = await makeRepo({
      'src/a.ts': 'export const a = 1\n',
      'bun.lock': '{}',
      'node_modules/dep/index.js': 'module.exports = 1\n',
      'dist/bundle.js': 'console.log(1)\n',
    });
    try {
      const map = await createRepoMapper().map(root);
      expect(map.files.map((file) => file.path)).toEqual(['src/a.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('includes untracked-but-not-ignored files and excludes ignored ones', async () => {
    const root = await makeRepo({
      '.gitignore': 'ignored.ts\n',
      'tracked.ts': 'export const tracked = 1\n',
    });
    try {
      await writeFiles(root, {
        'untracked.ts': 'export const untracked = 1\n',
        'ignored.ts': 'export const ignored = 1\n',
      });
      const map = await createRepoMapper().map(root);
      const paths = map.files.map((file) => file.path);
      expect(paths).toContain('tracked.ts');
      expect(paths).toContain('untracked.ts');
      expect(paths).not.toContain('ignored.ts');
    } finally {
      await removeDir(root);
    }
  });

  test('honours maxFiles after filtering and samples the whole tree instead of the alphabet', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i += 1) files[`file-${i}.ts`] = `export const n${i} = ${i}\n`;
    files['bun.lock'] = '{}';
    const root = await makeRepo(files);
    try {
      const map = await createRepoMapper().map(root, { maxFiles: 3 });
      // Ten paths, a stride of four: three files spread across the list, not the first three.
      expect(map.files.map((file) => file.path)).toEqual(['file-0.ts', 'file-4.ts', 'file-8.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('skips vendored, third-party and generated trees and files', async () => {
    const root = await makeRepo({
      'src/app.ts': 'export const app = 1\n',
      'vendor/dep/lib.go': 'package dep\nfunc Dep() {}\n',
      'third_party/thing/index.ts': 'export const third = 1\n',
      'packages/ui/src/__generated__/types.ts': 'export type A = 1\n',
      'src/schema.generated.ts': 'export type B = 2\n',
      'src/service.pb.ts': 'export type C = 3\n',
      'web/app.min.js': 'var a=1\n',
      'web/app.js.map': '{}',
      'locale/fr/LC_MESSAGES/django.po': 'msgid "x"\n',
      'locale/fr/LC_MESSAGES/django.mo': 'binary-ish',
    });
    try {
      const map = await createRepoMapper().map(root);
      expect(map.files.map((file) => file.path)).toEqual(['src/app.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('skips binary extensions before reading, even when the bytes are text', async () => {
    const root = await makeRepo({
      'src/app.ts': 'export const app = 1\n',
      'assets/logo.png': 'this file is not really a png\n',
      'docs/manual.pdf': 'nor a pdf\n',
    });
    try {
      const map = await createRepoMapper().map(root);
      expect(map.files.map((file) => file.path)).toEqual(['src/app.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('does not read the body of files that cannot carry symbols', async () => {
    // A JSON file with a NUL byte would be dropped as binary if it were read; a text one is kept
    // with its stat size and no symbols. Both prove the head-only path.
    const root = await makeRepo({
      'data/table.json': '{"rows": 1}\n',
      'src/app.ts': 'export function app() {}\n',
    });
    try {
      const map = await createRepoMapper().map(root);
      const json = map.files.find((file) => file.path === 'data/table.json');
      expect(json?.lang).toBe('json');
      expect(json?.bytes).toBe(12);
      expect(json?.symbols).toEqual([]);
    } finally {
      await removeDir(root);
    }
  });

  test('attaches the relative-import graph to the returned map', async () => {
    const root = await makeRepo({
      'src/a.ts': 'import { helper } from "./lib/b"\nexport const a = helper\n',
      'src/lib/b.ts': 'export const helper = 1\n',
      'src/lib/c.ts': 'export const c = 1\n',
    });
    try {
      const map = await createRepoMapper().map(root);
      expect(importGraphOf(map)?.importers.get('src/lib/b.ts')).toEqual(['src/a.ts']);
      expect(relatedFiles(map, ['src/a.ts'])).toEqual(['src/lib/b.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('throws REPOMAP_ERROR for a missing path', async () => {
    const root = await makeTempDir();
    const missing = join(root, 'nope');
    try {
      const error = await createRepoMapper()
        .map(missing)
        .catch((err: unknown) => err);
      expect(isStarlingError(error, 'REPOMAP_ERROR')).toBe(true);
    } finally {
      await removeDir(root);
    }
  });

  test('throws REPOMAP_ERROR when git cannot list files', async () => {
    const root = await makeTempDir();
    const fakeExec: typeof exec = async () => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
      durationMs: 2,
    });
    try {
      const error = await createRepoMapper({ exec: fakeExec })
        .map(root)
        .catch((err: unknown) => err);
      expect(isStarlingError(error, 'REPOMAP_ERROR')).toBe(true);
    } finally {
      await removeDir(root);
    }
  });

  test('sends the documented ls-files argv to the injected exec', async () => {
    const root = await makeTempDir();
    const calls: Array<{ cmd: string[]; cwd: string }> = [];
    const fakeExec: typeof exec = async (cmd, opts) => {
      calls.push({ cmd, cwd: opts.cwd });
      return { code: 0, stdout: 'a.ts\0', stderr: '', durationMs: 1 };
    };
    try {
      await writeFiles(root, { 'a.ts': 'export const a = 1\n' });
      const map = await createRepoMapper({ exec: fakeExec }).map(root);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toEqual(['git', 'ls-files', '-co', '--exclude-standard', '-z']);
      expect(calls[0]?.cwd).toBe(root);
      expect(map.files.map((file) => file.path)).toEqual(['a.ts']);
    } finally {
      await removeDir(root);
    }
  });

  test('uses the injected clock for createdAt', async () => {
    const root = await makeRepo({ 'a.ts': 'export const a = 1\n' });
    try {
      const clock = new FakeClock(1_234_567);
      const map = await createRepoMapper({ clock }).map(root);
      expect(map.createdAt).toBe(1_234_567);
    } finally {
      await removeDir(root);
    }
  });
});

describe('summaries', () => {
  test('summarizes central files and serves unchanged content from cache', async () => {
    const root = await makeRepo({
      'src/a.ts': 'import { b } from "./b"\nexport function a() { return b }\n',
      'src/b.ts': 'export function b() { return 2 }\nexport const B = 2\n',
      'src/c.ts': 'export function c() { return 3 }\n',
    });
    const cacheRoot = await makeTempDir('starling-repomap-cache-');
    try {
      const llm = new MockLLM({
        responses: [
          { text: 'Shared arithmetic helper used by the entry module.' },
          { text: 'Entry module that wires the helper.' },
          { text: 'Standalone utility module.' },
        ],
      });
      const first = await createRepoMapper({ llm, cacheDir: cacheRoot }).map(root, {
        summarize: true,
      });
      const summaries = first.files
        .filter((file) => file.summary !== undefined)
        .map((file) => file.path)
        .sort();
      expect(summaries).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
      expect(llm.calls).toHaveLength(3);
      expect(llm.calls.every((call) => call.role === 'summarizer')).toBe(true);

      const secondLlm = new MockLLM();
      const second = await createRepoMapper({ llm: secondLlm, cacheDir: cacheRoot }).map(root, {
        summarize: true,
      });
      expect(secondLlm.calls).toHaveLength(0);
      expect(second.files.find((file) => file.path === 'src/b.ts')?.summary).toBe(
        first.files.find((file) => file.path === 'src/b.ts')?.summary,
      );
    } finally {
      await removeDir(root);
      await removeDir(cacheRoot);
    }
  });

  test('missing LLM means no summaries and no error', async () => {
    const root = await makeRepo({ 'src/a.ts': 'export const a = 1\n' });
    try {
      const map = await createRepoMapper().map(root, { summarize: true });
      expect(map.files.every((file) => file.summary === undefined)).toBe(true);
    } finally {
      await removeDir(root);
    }
  });

  test('a failing LLM is tolerated and leaves the file without a summary', async () => {
    const root = await makeRepo({ 'src/a.ts': 'export const a = 1\n' });
    const cacheRoot = await makeTempDir('starling-repomap-cache-');
    const broken: LLM = {
      complete: async () => {
        throw new Error('model is napping');
      },
      completeJson: async () => {
        throw new Error('model is napping');
      },
    };
    try {
      const map = await createRepoMapper({ llm: broken, cacheDir: cacheRoot }).map(root, {
        summarize: true,
      });
      expect(map.files).toHaveLength(1);
      expect(map.files[0]?.summary).toBeUndefined();
    } finally {
      await removeDir(root);
      await removeDir(cacheRoot);
    }
  });
});
